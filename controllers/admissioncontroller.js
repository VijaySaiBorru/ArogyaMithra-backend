exports.admitPatient = async (req, res, pool) => {
    const requester = req.user;

    // Ensure only admins or front desk staff can admit patients
    if (!["admin", "frontdesk"].includes(requester.role)) {
        return res.status(403).json({ error: "Only admins or frontdesk can admit patients." });
    }

    const { patient_name, room_id, total_fees, remaining_fees, fee_paid_details } = req.body;

    // Validate required fields
    if (!patient_name || !room_id || total_fees == null || remaining_fees == null || !fee_paid_details) {
        return res.status(400).json({ error: "Missing required admission details." });
    }

    const connection = await pool.promise().getConnection();
    try {
        await connection.beginTransaction();

        // 1. Check if room exists and fetch details
        const [roomRows] = await connection.query(`SELECT * FROM room WHERE room_id = ?`, [room_id]);
        if (roomRows.length === 0) {
            await connection.rollback();
            return res.status(400).json({ error: "Room does not exist." });
        }

        const room = roomRows[0];
        if (room.type !== "General" && room.status === "Occupied") {
            await connection.rollback();
            return res.status(400).json({ error: "Room is already occupied." });
        }

        // 2. Check if patient exists
        const [patientRows] = await connection.query(`SELECT * FROM patient WHERE username = ?`, [patient_name]);
        if (patientRows.length === 0) {
            await connection.rollback();
            return res.status(400).json({ error: "Patient does not exist." });
        }

        const patientId = patientRows[0].patient_id;

        // 3. Check if the patient is already admitted and not yet discharged
        const [admissionRows] = await connection.query(
            `SELECT * FROM admission WHERE patient_id = ? AND discharge_date IS NULL`, [patientId]
        );
        if (admissionRows.length > 0) {
            await connection.rollback();
            return res.status(400).json({ error: "Patient is already admitted and not yet discharged." });
        }

        // 4. Insert admission record with fee_paid_details
        await connection.query(
            `INSERT INTO admission (patient_id, room_id, admit_date, total_fees, fee_paid_details, remaining_fees)
             VALUES (?, ?, NOW(), ?, ?, ?)`,
            [patientId, room_id, total_fees, JSON.stringify(fee_paid_details), remaining_fees]
        );

        // 5. Update room status accordingly
        if (room.type === "General") {
            let newOccupied = (room.occupied_strength || 0) + 1;
            let newStatus = newOccupied >= room.capacity ? "Occupied" : "Partially Occupied";

            await connection.query(
                `UPDATE room SET occupied_strength = ?, status = ? WHERE room_id = ?`,
                [newOccupied, newStatus, room_id]
            );
        } else {
            // For Normal and ICU
            await connection.query(
                `UPDATE room SET status = 'Occupied' WHERE room_id = ?`,
                [room_id]
            );
        }

        await connection.commit();
        res.status(201).json({ message: "Patient admitted successfully." });

    } catch (err) {
        await connection.rollback();
        console.error("Admission error:", err);
        res.status(500).json({ error: "Internal server error." });
    } finally {
        connection.release();
    }
};


exports.updateFees = async (req, res, pool) => {
    const requester = req.user;
    if (requester.role !== "admin" && requester.role !== "frontdesk") {
        return res.status(403).json({ error: "Only admin or frontdesk can update fees." });
    }

    const { admission_id } = req.params;
    const { extra_amount, paid_amount, method, note } = req.body;
    if (extra_amount == null || paid_amount == null) {
        return res.status(400).json({ error: "Missing required fields." });
    }

    try {
        // Retrieve current total_fees and remaining_fees
        const [admissionRow] = await pool.promise().query(
            `SELECT total_fees, remaining_fees, fee_paid_details FROM admission WHERE admission_id = ?`,
            [admission_id]
        );

        if (admissionRow.length === 0) {
            return res.status(404).json({ error: "Admission record not found." });
        }

        const { total_fees, remaining_fees, fee_paid_details } = admissionRow[0];

        // Calculate the new total_fees and remaining_fees
        const newTotalFees = Math.round(parseInt(total_fees) + parseInt(extra_amount));
        const newRemainingFees = Math.round(parseInt(remaining_fees) + parseInt(extra_amount) - parseInt(paid_amount));
       
        // Create the fee paid entry
        const paymentEntry = {
            amount: paid_amount,
            method: method,
            note: note,
            paid: true,
            timestamp: new Date().toISOString()
        };

        // Append the payment entry to fee_paid_details
        const updatedFeePaidDetails = fee_paid_details ? JSON.parse(fee_paid_details) : [];
        updatedFeePaidDetails.push(paymentEntry);

        // Update the admission record with new fees and payment details
        await pool.promise().query(
            `UPDATE admission 
             SET total_fees = ?, remaining_fees = ?, fee_paid_details = ? 
             WHERE admission_id = ?`,
            [newTotalFees, newRemainingFees, JSON.stringify(updatedFeePaidDetails), admission_id]
        );

        // Return updated fees details in response
        res.json({
            message: "Fees updated successfully.",
            total_fees: newTotalFees,
            paid_amount: paid_amount,
            remaining_fees: newRemainingFees
        });
    } catch (err) {
        console.error("Update fees error:", err);
        res.status(500).json({ error: "Internal server error." });
    }
};

exports.dischargePatient = async (req, res, pool) => {
    const requester = req.user;
    if (requester.role !== "admin" && requester.role !== "frontdesk") {
        return res.status(403).json({ error: "Only admin or frontdesk can discharge patients." });
    }

    const { admission_id } = req.params;

    try {
        // 1. Get admission details
        const [rows] = await pool.promise().query(
            `SELECT room_id, total_fees, remaining_fees, discharge_date,fee_paid_details FROM admission WHERE admission_id = ?`,
            [admission_id]
        );

        if (rows.length === 0) {
            return res.status(404).json({ error: "Admission not found." });
        }

        const { room_id, total_fees, remaining_fees, discharge_date } = rows[0];

        // 2. Check if already discharged
        if (discharge_date !== null) {
            return res.status(400).json({ error: "Patient already discharged." });
        }

        // 3. Set discharge date to NOW()
        await pool.promise().query(
            `UPDATE admission SET discharge_date = NOW() WHERE admission_id = ?`,
            [admission_id]
        );

        // 4. Get room details to determine the status
        const [roomRows] = await pool.promise().query(
            `SELECT type, occupied_strength, capacity, status FROM room WHERE room_id = ?`,
            [room_id]
        );

        if (roomRows.length === 0) {
            return res.status(404).json({ error: "Room not found." });
        }

        const { type, occupied_strength, capacity, status } = roomRows[0];

        // 5. Decrease the occupied strength for the room
        const updatedOccupiedStrength = occupied_strength - 1;

        // 6. Update the room status based on the room type and occupied strength
        let newStatus = status; // Default status remains the same unless changed

        if (type === 'General') {
            if (updatedOccupiedStrength === 0) {
                newStatus = 'Available';  // Room is now completely empty
            } else if (updatedOccupiedStrength < capacity) {
                newStatus = 'Partially Occupied';  // Room is partially occupied
            }
        } else {
            // For Normal and ICU rooms, simply set the status to 'Available'
            newStatus = 'Available';
        }

        // 7. Update the room's occupied strength and status
        await pool.promise().query(
            `UPDATE room SET occupied_strength = ?, status = ? WHERE room_id = ?`,
            [updatedOccupiedStrength, newStatus, room_id]
        );

        const fee_paid = total_fees - remaining_fees;
        const [patient] = await pool.promise().query(
            `SELECT * FROM admission 
             JOIN patient ON admission.patient_id = patient.patient_id
             WHERE admission.admission_id = ?`,
            [admission_id]
          );
          

        if (patient.length === 0) {
            return res.status(404).json({ error: "Admission not found." });
        }
       
        res.json({
            message: "Patient discharged and room status updated.",
            billing: {
                total_fees,
                fee_paid,
                remaining_fees
            },
            patient
        });

    } catch (error) {
        console.error("Error discharging patient:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

// admissionController.js

// Function to get all admitted patients who are not yet discharged
exports.getAdmittedPatients = async (req, res, pool) => {
    try {
        // Query to fetch all admitted patients where discharge_date is NULL
        const [rows] = await pool.promise().query(
            `SELECT admission.admission_id, admission.patient_id, admission.room_id, admission.admit_date, 
                    admission.total_fees, admission.remaining_fees, admission.fee_paid_details, 
                    patient.username as patient_name, room.room_id, room.status as room_status
             FROM admission
             INNER JOIN patient ON admission.patient_id = patient.patient_id
             INNER JOIN room ON admission.room_id = room.room_id
             WHERE admission.discharge_date IS NULL`
        );

        // If no records found, return a message
        if (rows.length === 0) {
            return res.status(200).json({ message: "No admitted patients found." });
        }

        // Return the list of admitted patients
        res.json(rows);
    } catch (err) {
        console.error("Error fetching admitted patients:", err);
        res.status(500).json({ error: "Internal server error." });
    }
};

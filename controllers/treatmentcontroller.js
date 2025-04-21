exports.addTreatment = async (req, res, pool) => {
    const { appointment_id, diagnosis, treatment_plan, medications } = req.body;
    try {
        const [result] = await pool.promise().query(
            `INSERT INTO treatment (appointment_id, diagnosis, treatment_plan) VALUES (?, ?, ?)`,
            [appointment_id, diagnosis, treatment_plan]
        );

        const treatmentId = result.insertId;

        if (medications && Array.isArray(medications)) {
            for (const med of medications) {
                const { medicine_name, dosage, frequency, duration } = med;
                await pool.promise().query(
                    `INSERT INTO treatment_medication (treatment_id, medicine_name, dosage, frequency, duration) VALUES (?, ?, ?, ?, ?)`,
                    [treatmentId, medicine_name, dosage, frequency, duration]
                );
            }
        }

        res.status(201).json({ message: "Treatment added", treatment_id: treatmentId });
    } catch (err) {
        console.error("Add treatment error:", err);
        res.status(500).json({ error: "Failed to add treatment" });
    }
};
exports.getTreatmentByAppointment = async (req, res, pool) => {
    const { appointment_id } = req.params;
    try {
        const [[treatment]] = await pool.promise().query(
            `SELECT * FROM treatment WHERE appointment_id = ?`,
            [appointment_id]
        );
       
      
        if (!treatment) return res.status(404).json({ error: "Treatment not found" });

        const [medications] = await pool.promise().query(
            `SELECT t1.appointment_id,t1.diagnosis,t1.treatment_plan,t.treatment_medication_id,t.treatment_id,t.medicine_name,t.dosage,t.frequency,t.duration  FROM treatment_medication t join treatment t1 on t.treatment_id=t1.treatment_id join appointment a on t1.appointment_id=a.appointment_id WHERE a.appointment_id = ?`,
            [treatment.appointment_id]
        );
       
         console.log(medications);
        res.json({ ...treatment, medications });
    } catch (err) {
        console.error("Get treatment error:", err);
        res.status(500).json({ error: "Failed to fetch treatment" });
    }
};
exports.getTreatmentsForPatient = async (req, res, pool) => {
    const { patient_id } = req.params;
    try {
        const [rows] = await pool.promise().query(
            `SELECT 
                t.treatment_id,
                t.appointment_id,
                t.diagnosis,
                t.treatment_plan,
                t.treatment_date,
                tm.treatment_medication_id,
                tm.medicine_name,
                tm.dosage,
                tm.frequency,
                tm.duration
            FROM treatment t
            left JOIN appointment a ON t.appointment_id = a.appointment_id
            LEFT JOIN treatment_medication tm ON t.treatment_id = tm.treatment_id
            WHERE a.patient_id = ?`,
            [patient_id]
        );
        // Group results by treatment_id
        const grouped = {};
        for (const row of rows) {
            const {
                treatment_id,
                appointment_id,
                diagnosis,
                treatment_plan,
                treatment_date,
                treatment_medication_id,
                medicine_name,
                dosage,
                frequency,
                duration
            } = row;

            if (!grouped[treatment_id]) {
                grouped[treatment_id] = {
                    treatment_id,
                    appointment_id,
                    diagnosis,
                    treatment_plan,
                    treatment_date,
                    medications: []
                };
            }

            if (treatment_medication_id) {
                grouped[treatment_id].medications.push({
                    treatment_medication_id,
                    medicine_name,
                    dosage,
                    frequency,
                    duration
                });
            }
        }

        const treatments = Object.values(grouped);
        res.status(200).json(treatments);
    } catch (err) {
        console.error("Get treatments error:", err);
        res.status(500).json({ error: "Failed to fetch treatments" });
    }
};
exports.updateTreatmentDetails = async (req, res, pool) => {
    const { medications, diagnosis, treatment_plan } = req.body;  // New medications and treatment details are passed in the body
    const { appointment_id } = req.params;

    try {
        // Validate appointment existence
        const [[appointment]] = await pool.promise().query(
            `SELECT * FROM appointment WHERE appointment_id = ?`,
            [appointment_id]
        );
        if (!appointment) {
            return res.status(404).json({ error: "Appointment not found" });
        }

        // Get the treatment associated with the appointment
        const [[treatment]] = await pool.promise().query(
            `SELECT * FROM treatment WHERE appointment_id = ?`,
            [appointment_id]
        );
        if (!treatment) {
            return res.status(404).json({ error: "Treatment not found for this appointment" });
        }

        // **Update the treatment details** (diagnosis and treatment plan)
        if (diagnosis || treatment_plan) {
            await pool.promise().query(
                `UPDATE treatment SET 
                    diagnosis = COALESCE(?, diagnosis),
                    treatment_plan = COALESCE(?, treatment_plan)
                 WHERE treatment_id = ?`,
                [diagnosis, treatment_plan, treatment.treatment_id]
            );
        }

        // **Delete existing medications** for the treatment
        await pool.promise().query(
            `DELETE FROM treatment_medication WHERE treatment_id = ?`,
            [treatment.treatment_id]
        );

        // **Add new medications** to the treatment_medication table
        if (medications && medications.length > 0) {
            const insertMedicines = medications.map(medicine => [
                treatment.treatment_id, 
                medicine.medicine_name, 
                medicine.dosage, 
                medicine.frequency, 
                medicine.duration
            ]);
            await pool.promise().query(
                `INSERT INTO treatment_medication (treatment_id, medicine_name, dosage, frequency, duration) 
                 VALUES ?`,
                [insertMedicines]
            );
        }

        res.status(200).json({ message: "Treatment and medications updated successfully" });
    } catch (err) {
        console.error("Error updating treatment details:", err);
        res.status(500).json({ error: "Failed to update treatment details" });
    }
};

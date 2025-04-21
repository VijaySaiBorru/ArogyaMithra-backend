const sendEmergencyAlertEmail = require('../jobs/EmergencyAlert');

exports.addSlot = async (req, res, pool) => {
  const { hcp_id, slot_date, start_time, end_time } = req.body;
  console.log(req.body)

  try {
    const [[hcp]] = await pool.promise().query(
      "SELECT designation FROM health_care_professional WHERE hcp_id = ?",
      [hcp_id]
    );

    if (!hcp || hcp.designation !== 'Doctor') {
      return res.status(403).json({ error: "Only doctors can have appointment slots or accept appointments." });
    }

    // 🛑 Check for overlapping slots
    const [conflictingSlots] = await pool.promise().query(
      `SELECT start_time, end_time FROM doctor_available_slots
             WHERE hcp_id = ? AND slot_date = ? AND (
                 (start_time < ? AND end_time > ?) OR
                 (start_time < ? AND end_time > ?) OR
                 (start_time >= ? AND end_time <= ?)
             )`,
      [hcp_id, slot_date, end_time, end_time, start_time, start_time, start_time, end_time]
    );
    if (conflictingSlots.length > 0) {
      return res.status(409).json({
        error: "Slot timing overlaps with an existing slot.",
        conflict: conflictingSlots.map(slot => ({
          slot_date: slot.slot_date?.toISOString().split('T')[0],
          start_time: slot.start_time,
          end_time: slot.end_time
        }))
      });
    }


    // ✅ Insert slot
    const formattedDate = new Date(slot_date).toISOString().split("T")[0];
    await pool.promise().query(
      `INSERT INTO doctor_available_slots (hcp_id, slot_date, start_time, end_time, is_available)
            VALUES (?, ?, ?, ?, 1)`,
      [hcp_id, formattedDate, start_time, end_time]
    );
    res.status(201).json({ message: "Slot added successfully" });
  } catch (err) {
    console.error("Slot add error:", err);
    res.status(500).json({ error: "Failed to add slot" });
  }
};
exports.getSlots = async (req, res, pool) => {
  const { hcp_id, day } = req.params; // Get hcp_id and full datetime from params
  try {
    // Parse the full datetime string from the frontend (assumed ISO 8601 format)
    const inputDate = new Date(day); // Directly parse the full datetime string
    // Check if the date is valid
    if (isNaN(inputDate.getTime())) {
      return res.status(400).json({ error: "Invalid date format provided." });
    }

    // Convert the input date to UTC
    const utcDate = new Date(inputDate.getTime()); // Convert to UTC from IST
    const queryDate = utcDate.toISOString().split("T")[0]; // Extract just the date part (YYYY-MM-DD)
    // Get all available slots for the given doctor on the given date (in UTC)
    const [slots] = await pool.promise().query(
      `SELECT * FROM doctor_available_slots 
             WHERE hcp_id = ? AND slot_date = ? AND is_available = 1`,
      [hcp_id, queryDate]
    );

    if (!slots.length) {
      return res.status(200).json({ error: "No available slots found for this doctor on the given date." });
    }

    // Get the slot_ids that are already booked on this date
    const [booked] = await pool.promise().query(
      `SELECT slot_id FROM booked_slots WHERE date = ?`,
      [queryDate]
    );

    const bookedSlotIds = booked.map(b => b.slot_id);

    // Filter out the booked slots
    const availableSlots = slots.filter(slot => !bookedSlotIds.includes(slot.slot_id));

    if (!availableSlots.length) {
      return res.status(404).json({ error: "No available slots for the selected date." });
    }

    // Convert slot_date from UTC to IST before sending to frontend
    const istSlots = availableSlots.map(slot => {
      const utcSlotDate = new Date(slot.slot_date);
      const istSlotDate = new Date(utcSlotDate.getTime() + (5.5 * 60 * 60 * 1000)); // Convert UTC to IST

      return {
        ...slot,
        slot_date: istSlotDate.toISOString()  // Return the full datetime string
      };
    });

    return res.json(istSlots);

  } catch (err) {
    console.error("Error fetching slots:", err);
    return res.status(500).json({ error: "Failed to fetch slots" });
  }
};
exports.bookAppointment = async (req, res, pool) => {
  const { slot_id, date, patient_id, priority, notes, doctor_id } = req.body;

  try {
    // Handle emergency/urgent cases
    if (['emergency'].includes((priority || '').toLowerCase())) {
      const now = new Date();
      const datePart = now.toISOString().split('T')[0];
      const timePart = now.toTimeString().split(' ')[0];
      const finalDateTime = `${datePart} ${timePart}`;

      const [result] = await pool.promise().query(
        `INSERT INTO appointment (date_time, priority, patient_id, hcp_id, notes)
         VALUES (?, ?, ?, ?, ?)`,
        [finalDateTime, priority || 'Normal', patient_id, doctor_id, notes || null]
      );

      if (priority.toLowerCase() === 'emergency') {
        await sendEmergencyAlertEmail(pool, result.insertId);
      }

      return res.status(201).json({ 
        message: "Emergency appointment booked immediately",
        appointment_id: result.insertId 
      });
    }

    // Normal booking flow
    const [[slot]] = await pool.promise().query(
      `SELECT * FROM doctor_available_slots WHERE slot_id = ? AND is_available = 1`,
      [slot_id]
    );
    if (!slot) return res.status(404).json({ error: "Slot not available" });

    const [booked] = await pool.promise().query(
      `SELECT * FROM booked_slots WHERE slot_id = ? AND date = ?`,
      [slot_id, date.split('T')[0]]
    );
    if (booked.length > 0) return res.status(409).json({ error: "Slot already booked" });

    const dateObj = new Date(date);
    const datePart = dateObj.toISOString().split('T')[0];
    const finalDateTime = `${datePart} ${slot.start_time}`;

    const [result] = await pool.promise().query(
      `INSERT INTO appointment (date_time, priority, patient_id, hcp_id, notes)
       VALUES (?, ?, ?, ?, ?)`,
      [finalDateTime, priority || 'Normal', patient_id, slot.hcp_id, notes || null]
    );

    await pool.promise().query(
      `INSERT INTO booked_slots (slot_id, date, appointment_id) VALUES (?, ?, ?)`,
      [slot_id, datePart, result.insertId]
    );
    await pool.promise().query(
      `UPDATE doctor_available_slots SET is_available = 0 WHERE slot_id = ?`,
      [slot_id]
    );

    res.status(201).json({ 
      message: "Appointment booked", 
      appointment_id: result.insertId 
    });
  } catch (err) {
    console.error("Booking error:", err);
    res.status(500).json({ error: "Failed to book appointment" });
  }
};

exports.getUpcomingSlots = async (req, res, pool) => {
  const { hcp_id } = req.params;

  try {
    // Get today's date in UTC and format to YYYY-MM-DD
    const now = new Date();
    const todayUTC = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate()
    ));
    const todayStr = todayUTC.toISOString().split("T")[0];

    // Get all available future slots for the doctor (after today)
    const [slots] = await pool.promise().query(
      `SELECT * FROM doctor_available_slots 
             WHERE hcp_id = ? AND slot_date > ? AND is_available = 1 
             ORDER BY slot_date ASC`,
      [hcp_id, todayStr]
    );

    if (!slots.length) {
      return res.status(200).json({ error: "No upcoming available slots found for this doctor." });
    }

    // Get booked slot IDs after today
    const [booked] = await pool.promise().query(
      `SELECT slot_id FROM booked_slots WHERE date > ?`,
      [todayStr]
    );
    const bookedSlotIds = booked.map(b => b.slot_id);

    // Filter out booked slots
    const availableSlots = slots.filter(slot => !bookedSlotIds.includes(slot.slot_id));

    if (!availableSlots.length) {
      return res.status(404).json({ error: "All upcoming slots are booked." });
    }

    // Convert UTC to IST for each slot
    const istSlots = availableSlots.map(slot => {
      const utcSlotDate = new Date(slot.slot_date);
      const istSlotDate = new Date(utcSlotDate.getTime() + (5.5 * 60 * 60 * 1000));
      return {
        ...slot,
        slot_date: istSlotDate.toISOString()
      };
    });

    return res.json(istSlots);

  } catch (err) {
    console.error("Error fetching upcoming slots:", err);
    return res.status(500).json({ error: "Failed to fetch upcoming slots" });
  }
};
exports.getAppointmentsForDoctor = async (req, res, pool) => {
  const { hcp_id } = req.params;
  try {
    const [[hcp]] = await pool.promise().query(
      `SELECT designation FROM health_care_professional WHERE hcp_id = ?`,
      [hcp_id]
    );

    if (!hcp || hcp.designation !== 'Doctor') {
      return res.status(403).json({ error: "Only doctors can have appointment slots or accept appointments." });
    }

    const [appointments] = await pool.promise().query(
      `SELECT * FROM appointment WHERE hcp_id = ? ORDER BY date_time DESC`,
      [hcp_id]
    );

    res.json(appointments);
  } catch (err) {
    console.error("Fetch appointments error:", err);
    res.status(500).json({ error: "Failed to fetch appointments" });
  }
};
exports.getAppointmentsForPatient = async (req, res, pool) => {
  const { patient_id } = req.params;
  try {
    const [appointments] = await pool.promise().query(
      `SELECT 
            u.name,a.date_time,a.notes,a.appointment_id
           FROM appointment a
           JOIN health_care_professional d ON a.hcp_id = d.hcp_id
           JOIN users u ON u.user_id = d.user_id
           WHERE a.status = 'Scheduled' AND a.patient_id = ? ORDER BY date_time DESC`,
      [patient_id]
    );
    res.json(appointments);
  } catch (err) {
    console.error("Fetch appointments error:", err);
    res.status(500).json({ error: "Failed to fetch appointments" });
  }
};
exports.updateAppointmentStatus = async (req, res, pool) => {
  const { appointment_id } = req.params;
  const { status } = req.body;

  try {
    // Fetch the slot_id for the appointment
    const [rows] = await pool.promise().query(
      `SELECT slot_id FROM booked_slots WHERE appointment_id = ?`,
      [appointment_id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Appointment not found" });
    }

    const slot_id = rows[0].slot_id;

    // Update appointment status
    await pool.promise().query(
      `UPDATE appointment SET status = ? WHERE appointment_id = ?`,
      [status, appointment_id]
    );

    // Mark slot as available again
    await pool.promise().query(
      `UPDATE doctor_available_slots SET is_available = 1 WHERE slot_id = ?`,
      [slot_id]
    );

    // If status is cancelled, remove from booked_slots
    if (status === 'Cancelled') {
      await pool.promise().query(
        `DELETE FROM booked_slots WHERE appointment_id = ?`,
        [appointment_id]
      );
    }

    res.json({ message: "Appointment status updated" });
  } catch (err) {
    console.error("Update status error:", err);
    res.status(500).json({ error: "Failed to update appointment status" });
  }
};

exports.deleteSlot = async (req, res, pool) => {
  const { slot_id } = req.params;
  try {
    // Check if slot exists
    const [[slot]] = await pool.promise().query(
      `SELECT * FROM doctor_available_slots WHERE slot_id = ?`,
      [slot_id]
    );

    if (!slot) {
      return res.status(404).json({ error: "Slot not found." });
    }

    // Prevent deletion if slot is already booked
    const [booked] = await pool.promise().query(
      `SELECT * FROM booked_slots WHERE slot_id = ?`,
      [slot_id]
    );

    if (booked.length > 0) {
      return res.status(409).json({ error: "Cannot delete a booked slot." });
    }

    // Delete the slot
    await pool.promise().query(
      `DELETE FROM doctor_available_slots WHERE slot_id = ?`,
      [slot_id]
    );

    res.json({ message: "Slot deleted successfully." });
  } catch (err) {
    console.error("Delete slot error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};
exports.generateWeeklySlots = async (req, res, pool) => {
  const { hcp_id, day_of_week, start_time, end_time, repeat_until, start_date } = req.body;

  if (!hcp_id || !day_of_week || !start_time || !end_time || !repeat_until || !start_date) {
    return res.status(400).json({ error: "All fields are required." });
  }

  try {
    const [[hcp]] = await pool.promise().query(
      `SELECT designation FROM health_care_professional WHERE hcp_id = ?`,
      [hcp_id]
    );

    if (!hcp || hcp.designation !== 'Doctor') {
      return res.status(403).json({ error: "Only doctors can generate recurring slots." });
    }

    const repeatDate = new Date(repeat_until);
    const startDate = new Date(start_date);
    const dayOfWeekInt = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].indexOf(day_of_week);

    if (dayOfWeekInt === -1) {
      return res.status(400).json({ error: "Invalid day_of_week." });
    }

    const datesToInsert = [];
    let current = new Date(startDate);
    current.setHours(0, 0, 0, 0);

    const currentDay = current.getDay();
    const offset = (dayOfWeekInt - currentDay + 7) % 7;
    if (offset !== 0) {
      current.setDate(current.getDate() + offset);
    }

    while (current <= repeatDate) {
      let insertDate = new Date(current);
      insertDate.setDate(insertDate.getDate() + 1); // Add one day here
      const slot_date = insertDate.toISOString().split('T')[0];
      datesToInsert.push(slot_date);
      current.setDate(current.getDate() + 7);
    }


    for (const slot_date of datesToInsert) {
      const [existingSlots] = await pool.promise().query(
        `SELECT * FROM doctor_available_slots 
         WHERE hcp_id = ? AND slot_date = ? 
         AND NOT (end_time <= ? OR start_time >= ?)`,
        [hcp_id, slot_date, start_time, end_time]
      );

      if (existingSlots.length > 0) {
        return res.status(409).json({ error: `Slot on ${slot_date} overlaps with an existing slot.` });
      }
    }

    const insertPromises = datesToInsert.map(slot_date =>
      pool.promise().query(
        `INSERT IGNORE INTO doctor_available_slots (hcp_id, slot_date, start_time, end_time, is_available)
         VALUES (?, ?, ?, ?, 1)`,
        [hcp_id, slot_date, start_time, end_time]
      )
    );

    await Promise.all(insertPromises);

    res.status(201).json({ message: `${datesToInsert.length} weekly slots generated.` });
  } catch (err) {
    console.error("Recurring slot generation error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};




exports.getAppointmentDetails = async (req, res, pool) => {
  const { appointment_id } = req.params;

  try {
    const [appointment] = await pool.promise().query(
      `SELECT 
          u.name, a.date_time, a.notes, d.hcp_id, d.specialization
         FROM appointment a
         JOIN health_care_professional d ON a.hcp_id = d.hcp_id
         JOIN users u ON u.user_id = d.user_id
         WHERE a.appointment_id = ?`,
      [appointment_id]
    );

    const [patient] = await pool.promise().query(
      `SELECT 
           p.name, p.gender, p.dob, 
           TIMESTAMPDIFF(YEAR, p.dob, CURDATE()) AS age
         FROM patient p 
         JOIN appointment a ON p.patient_id = a.patient_id 
         WHERE a.appointment_id = ?`,
      [appointment_id]
    );

    if (appointment.length === 0 || patient.length === 0) {
      return res.status(404).json({ error: "Appointment or patient not found" });
    }

    const fullDetails = {
      ...appointment[0],
      patient: patient[0]
    };

    res.json(fullDetails);
  } catch (err) {
    console.error("Fetch appointment error:", err);
    res.status(500).json({ error: "Failed to fetch appointment" });
  }
};

exports.getPatientRecord = async (req, res, pool) => {
  const { patient_id } = req.params;

  try {
    const [appointments] = await pool.promise().query(
      `SELECT a.appointment_id, a.date_time, a.status, a.priority, a.notes, 
                t.treatment_id, t.diagnosis, t.treatment_plan, t.treatment_date,
                h.designation, h.specialization
         FROM appointment a
         LEFT JOIN treatment t ON a.appointment_id = t.appointment_id
         LEFT JOIN health_care_professional h ON a.hcp_id = h.hcp_id
         WHERE a.patient_id = ? AND a.status = 'Completed'
         ORDER BY a.date_time DESC`,
      [patient_id]
    );

    const [prescribedTests] = await pool.promise().query(
      `SELECT pt.prescribed_test_id, pt.appointment_id, t.test_id, t.test_name, t.description, t.fee
         FROM prescribed_test pt
         JOIN test t ON pt.test_id = t.test_id
         WHERE pt.appointment_id IN (
           SELECT appointment_id FROM appointment WHERE patient_id = ? AND status = 'Completed'
         )`,
      [patient_id]
    );

    const [medications] = await pool.promise().query(
      `SELECT tm.treatment_id, tm.medicine_name, tm.dosage, tm.frequency, tm.duration
         FROM treatment_medication tm
         WHERE tm.treatment_id IN (
           SELECT treatment_id FROM treatment WHERE appointment_id IN (
             SELECT appointment_id FROM appointment WHERE patient_id = ? AND status = 'Completed'
           )
         )`,
      [patient_id]
    );

    const patientRecord = appointments.map((appt) => ({
      ...appt,
      prescribed_tests: prescribedTests.filter((pt) => pt.appointment_id === appt.appointment_id),
      medications: medications.filter((med) => med.treatment_id === appt.treatment_id),
    }));

    res.status(200).json(patientRecord);
  } catch (err) {
    console.error('Fetch patient record error:', err);
    res.status(500).json({ error: 'Failed to fetch patient record' });
  }
};


exports.getAllPatientRecords = async (req, res, pool) => {
  const { hcp_id } = req.params;

  try {
    // 1. Get all completed appointments + treatment
    const [appointments] = await pool.promise().query(
      `SELECT a.appointment_id, a.patient_id, a.date_time, a.status, a.priority, a.notes,
                t.treatment_id, t.diagnosis, t.treatment_plan, t.treatment_date,
                h.designation, h.specialization
         FROM appointment a
         LEFT JOIN treatment t ON a.appointment_id = t.appointment_id
         LEFT JOIN health_care_professional h ON a.hcp_id = h.hcp_id
         WHERE a.status = 'Completed' AND a.hcp_id = ?
         ORDER BY a.date_time DESC`,
      [hcp_id]
    );



    // 2. Get prescribed tests linked to this doctor's completed appointments
    const [prescribedTests] = await pool.promise().query(
      `SELECT 
      pt.prescribed_test_id,
      pt.appointment_id,
      t.test_id,
      t.test_name,
      t.description,
      p.result,
      p.file
      FROM prescribed_test pt
      LEFT JOIN test t ON pt.test_id = t.test_id
      LEFT JOIN patient_test p ON p.prescribed_test_id = pt.prescribed_test_id 
      WHERE pt.appointment_id IN (
            SELECT appointment_id FROM appointment WHERE status = 'Completed' AND hcp_id = ?
           )
        `,
      [hcp_id]
    );



    // 3. Get medications ONLY for this doctor’s completed appointments
    const [medications] = await pool.promise().query(
      `SELECT tm.treatment_id, tm.medicine_name, tm.dosage, tm.frequency, tm.duration, t.appointment_id
         FROM treatment_medication tm
         JOIN treatment t ON tm.treatment_id = t.treatment_id
         WHERE t.appointment_id IN (
           SELECT appointment_id FROM appointment WHERE status = 'Completed' AND hcp_id = ?
         )`,
      [hcp_id]
    );



    // 4. Deduplicate appointments
    const uniqueAppointments = new Map();
    appointments.forEach((appt) => {
      if (!uniqueAppointments.has(appt.appointment_id)) {
        uniqueAppointments.set(appt.appointment_id, {
          ...appt,
          prescribed_tests: [],
          medications: [],
        });
      }
    });

    // 5. Attach tests & meds to corresponding appointments
    const patientRecords = Array.from(uniqueAppointments.values()).map((appt) => ({
      ...appt,
      prescribed_tests: prescribedTests.filter(
        (pt) => pt.appointment_id === appt.appointment_id
      ),
      medications: medications.filter(
        (med) =>
          //   med.treatment_id === appt.treatment_id &&
          med.appointment_id === appt.appointment_id
      )
    }));


    res.status(200).json(patientRecords);
  } catch (err) {
    console.error("Fetch all patient records error:", err);
    res.status(500).json({ error: "Failed to fetch patient records" });
  }
};

exports.getAllAppointments = async (req, res, pool) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;

    // Query appointments with doctor and appointment_id
    const [appointments] = await pool.promise().query(
      `SELECT 
         a.appointment_id, a.date_time, a.notes,a.status,
         u.name AS doctor_name, 
         d.hcp_id, d.specialization
       FROM appointment a
       JOIN health_care_professional d ON a.hcp_id = d.hcp_id
       JOIN users u ON u.user_id = d.user_id
       LIMIT ? OFFSET ?`,
      [parseInt(limit), parseInt(offset)]
    );

    if (appointments.length === 0) {
      return res.status(200).json({ appointments: [], totalAppointments: 0 });
    }

    // Get all patients mapped to these appointments only
    const appointmentIds = appointments.map(a => a.appointment_id);
    const [patients] = await pool.promise().query(
      `SELECT 
         p.name AS patient_name, p.gender, p.dob, 
         TIMESTAMPDIFF(YEAR, p.dob, CURDATE()) AS age, 
         a.appointment_id
       FROM patient p
       JOIN appointment a ON p.patient_id = a.patient_id
       WHERE a.appointment_id IN (${appointmentIds.map(() => '?').join(',')})`,
      appointmentIds
    );

    // Merge patient data with appointment
    const fullDetails = appointments.map(appointment => {
      const patient = patients.find(p => p.appointment_id === appointment.appointment_id);
      return {
        ...appointment,
        patient: patient || null
      };
    });

    const [[{ totalAppointments }]] = await pool.promise().query(
      `SELECT COUNT(*) AS totalAppointments FROM appointment`
    );

    res.json({
      appointments: fullDetails,
      totalAppointments,
      totalPages: Math.ceil(totalAppointments / limit),
      currentPage: parseInt(page)
    });

  } catch (err) {
    console.error("Fetch appointment error:", err);
    res.status(500).json({ error: "Failed to fetch appointments" });
  }
};

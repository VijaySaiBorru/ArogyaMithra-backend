const bcrypt = require("bcrypt"); 
const jwt = require("jsonwebtoken"); 
const fetch =require("node-fetch");
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const SENDER_EMAIL = process.env.SENDER_EMAIL;
const sendWelcomeEmail = async (email, name, otp) => {
    const payload = {
        sender: { name: "ArogyaMithra", email: SENDER_EMAIL },
        to: [{ email }],
        subject: "Welcome to ArogyaMithra – Your Trusted Health Care Partner",
        htmlContent: `
            <div style="font-family: Arial, sans-serif; color: #333;">
                <h2>Welcome to ArogyaMithra, ${name}!</h2>
                <p>We’re excited to have you on board.</p>
                <p><strong>Your One-Time Password (OTP) is:</strong></p>
                <h3 style="color: #2E86C1;">${otp}</h3>
                <p>This OTP is valid for <strong>5 minutes</strong>.</p>
                <p>Thank you for choosing <strong>ArogyaMithra</strong>, your trusted health care partner.</p>
                <p>Stay healthy,<br>The ArogyaMithra Team</p>
            </div>
        `
    };
    console.log(payload);

    try {
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
            "api-key": BREVO_API_KEY,
            "Content-Type": "application/json",
            "Accept": "application/json"
        },
        body: JSON.stringify(payload)
    });

    const result = await response.json();

    if (response.ok) {
        console.log("✅ Email sent successfully!");
        console.log(result); // contains messageId and other info
    } else {
        console.error("❌ Failed to send email:", result);
    }

} catch (error) {
    console.error("❌ Error while sending email:", error);
}

};
// In-memory store for OTPs (temporary storage until verification)
const otpStore = {}; // Format: { [email]: { otp, expiresAt, userData } }
// // Register patient with OTP validation
exports.registerPatient = async (req, res, pool) => {
    const {
        name,
        dob,
        gender,
        contact,
        address,
        email,
        username,
        password,
        blood_group, // Added bloodgroup field
        insurance_id,
        medical_history
    } = req.body;

    // Check if required fields are present
    if (!name || !dob || !gender || !contact || !address || !email || !username || !password || !blood_group) {
        return res.status(400).json({ error: "All fields except insurance_id are required." });
    }

    try {
        // Check if the email or username already exists in the database
        const [existing] = await pool.promise().query(
            "SELECT * FROM patient WHERE email = ? OR username = ?",
            [email, username]
        );

        if (existing.length > 0) {
            return res.status(409).json({ error: "Email or username already exists." });
        }

        // Generate OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = Date.now() + 5 * 60 * 1000; // OTP expires in 5 minutes

        // Store OTP and user data temporarily
        otpStore[email] = { otp, expiresAt, userData: { name, dob, gender, contact, address, email, username, password, blood_group, insurance_id,medical_history } };  

        // Send OTP to email
        console.log(email,name,otp);
        await sendWelcomeEmail(email,name, otp);

        // Respond with a message asking to verify OTP
        res.status(200).json({ message: "OTP sent successfully. Please verify to complete registration." });

    } catch (err) {
        console.error("Error during registration:", err);
        res.status(500).json({ error: "Server error during registration." });
    }
};

// Function to verify OTP and complete registration
exports.verifyOTPAndRegister = async (req, res, pool) => {
    const { email, otp } = req.body;

    if (!email || !otp) {
        return res.status(400).json({ error: "Email and OTP are required." });
    }

    // Check if the OTP exists for the email
    const otpRecord = otpStore[email];

    if (!otpRecord) {
        return res.status(400).json({ error: "No OTP found for this email." });
    }

    if (Date.now() > otpRecord.expiresAt) {
        delete otpStore[email]; // Remove expired OTP
        return res.status(400).json({ error: "OTP expired." });
    }

    if (otp !== otpRecord.otp) {
        return res.status(400).json({ error: "Invalid OTP." });
    }

    // OTP is valid, proceed to register the patient
    const { name, dob, gender, contact, address, username, password, blood_group,insurance_id,medical_history } = otpRecord.userData;

    try {
        // Hash the password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Insert the patient data into the database
        await pool.promise().query(
            `INSERT INTO patient (name, dob, gender, contact, address, email, username, password, bloodgroup,insurance_id,medical_history)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?,?,?)`,
            [name, dob, gender, contact, address, email, username, hashedPassword, blood_group,insurance_id,medical_history]
        );

        // Clear OTP after successful registration
        delete otpStore[email];

        // Respond with success
        res.status(201).json({ message: "Patient registered successfully." });

    } catch (err) {
        console.error("Error during patient registration:", err);
        res.status(500).json({ error: "Server error during registration." });
    }
};

exports.registerFrontDeskPatient = async (req, res, pool) => {
    const {
        name,
        dob,
        gender,
        contact,
        address,
        email,
        username,
        password,
        insurance_id,
        blood_group,
        medical_history  
    } = req.body;

    // Check if required fields are present
    if (!name || !dob || !gender || !contact || !address || !email || !username || !password || !blood_group) {
        return res.status(400).json({ error: "All fields except insurance_id and medical_history are required." });
    }

    try {
        // Check if the email or username already exists
        const [existing] = await pool.promise().query(
            "SELECT * FROM patient WHERE email = ? OR username = ?",
            [email, username]
        );

        if (existing.length > 0) {
            return res.status(409).json({ error: "Email or username already exists." });
        }
        

      //  await sendWelcomeEmail(email, name);

        // Hash the password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Insert the patient data into the database, including the bloodgroup
        await pool.promise().query(
            `INSERT INTO patient (name, dob, gender, contact, address, email, username, password, insurance_id, bloodgroup,medical_history)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?,?)`,
            [name, dob, gender, contact, address, email, username, hashedPassword, insurance_id || null, blood_group,medical_history || null]
        );

        // Respond with success
        res.status(201).json({ message: "Patient registered successfully." });
    } catch (err) {
        console.error("Registration error:", err);
        res.status(500).json({ error: "Server error during registration." });
    }
};

exports.loginPatient = async (req, res, pool) => {
    const { usernameOrEmail, password } = req.body;
    if (!usernameOrEmail || !password) {
        return res.status(400).json({ error: "Please provide both username/email and password." });
    }

    try {
        // Modify the query to check either username or email
        const [results] = await pool.promise().query(
            "SELECT * FROM patient WHERE username = ? OR email = ?",
            [usernameOrEmail, usernameOrEmail]
        );

        if (results.length === 0) {
            return res.status(401).json({ error: "Invalid username/email or password." });
        }

        const patient = results[0];
        const isMatch = await bcrypt.compare(password, patient.password);

        if (!isMatch) {
            return res.status(401).json({ error: "Invalid username/email or password." });
        }

        const token = jwt.sign(
            { patient_id: patient.patient_id, username: patient.username },
            process.env.JWT_SECRET_KEY,
            { expiresIn: "1d" }
        );

        // Remove password from patient data before returning it
        const { password: _, ...patientData } = patient; 

        res.status(200).json({
            message: "Login successful.",
            token,
            patient: patientData
        });
    } catch (err) {
        console.error("Login error:", err);
        res.status(500).json({ error: "Server error during login." });
    }
};

exports.getPatientAppointments = async (req, res, pool) => {
    const patientId = req.user.patient_id; 
    try {
        const [appointments] = await pool.promise().query(
            `SELECT 
                a.appointment_id,
                a.date_time,
                a.status,
                a.priority,
                h.name AS doctor_name,
                h.specialization
             FROM appointment a
             JOIN health_care_professional h ON a.hcp_id = h.hcp_id
             WHERE a.patient_id = ?`,
            [patientId]
        );
        res.status(200).json({
            message: "Appointments fetched successfully",
            appointments
        });

    } catch (err) {
        console.error("Error fetching appointments:", err);
        res.status(500).json({ error: "Error fetching appointments" });
    }
};
exports.bookAppointment = async (req, res, pool) => {
    const { hcp_id, date_time, priority } = req.body;
    const patient_id = req.user.patient_id;
    if (!hcp_id || !date_time) {
        return res.status(400).json({ error: "Please provide hcp_id and date_time." });
    }
    try {
        const [result] = await pool.promise().query(
            `INSERT INTO appointment (date_time, status, priority, patient_id, hcp_id)
             VALUES (?, 'Scheduled', ?, ?, ?)`,
            [date_time, priority || 'Normal', patient_id, hcp_id]
        );
        res.status(201).json({
            message: "Appointment booked successfully.",
            appointment_id: result.insertId
        });
    } catch (err) {
        console.error("Error booking appointment:", err);
        res.status(500).json({ error: "Failed to book appointment." });
    }
};
exports.getAllPatients = (req, res, pool) => {
    pool.query("SELECT * FROM patient", (err, results) => {
        if (err) {
            console.error("Error fetching patients:", err);
            return res.status(500).json({ error: "Database error" });
        }
        const sanitizedResults = results.map(({ password, ...patient }) => patient);
        res.json(sanitizedResults);
    });
};
exports.getPatientById = (req, res, pool) => {
    const { id } = req.params; // Get the patient ID from the request parameters

    pool.query("SELECT * FROM patient WHERE id = ?", [id], (err, results) => {
        if (err) {
            console.error("Error fetching patient:", err);
            return res.status(500).json({ error: "Database error" });
        }

        // If no patient is found with the provided ID
        if (results.rows.length === 0) {
            return res.status(404).json({ error: "Patient not found" });
        }

        // Sanitize the results (remove password field)
        const patient = { ...results.rows[0] };
        delete patient.password;

        res.json(patient); // Send back the patient data
    });
};

exports.updatePatient = async (req, res, pool) => {
    // Determine who is updating: patient or admin
    // console.log(req);
    const isAdmin = req.user.role === 'admin'; // assuming `role` is attached to `req.user`
    const patient_id = isAdmin ? req.body.patient_id : req.user.patient_id;
     console.log(patient_id);
    if (!patient_id) {
        return res.status(400).json({ error: "Patient ID is required." });
    }

    const {
        name,
        dob,
        gender,
        contact,
        address,
        email,
        username,
        password,
        insurance_id,
        bloodgroup,
        medical_history
    } = req.body.data;
    console.log(req.body);
    try {
        // If admin, check if the email and username are unique
        if (isAdmin) {
            // Admin checks for unique email and username across all patients
            if (email) {
                const [emailExists] = await pool.promise().query(
                    "SELECT * FROM patient WHERE email = ? AND patient_id != ?",
                    [email, patient_id]
                );
                if (emailExists.length > 0) {
                    return res.status(409).json({ error: "Email already exists." });
                }
            }

            if (username) {
                const [usernameExists] = await pool.promise().query(
                    "SELECT * FROM patient WHERE username = ? AND patient_id != ?",
                    [username, patient_id]
                );
                if (usernameExists.length > 0) {
                    return res.status(409).json({ error: "Username already exists." });
                }
            }
        } else {
            // For patients, only check if their own email and username are unique (already implied by patient_id)
            if (email) {
                const [emailExists] = await pool.promise().query(
                    "SELECT * FROM patient WHERE email = ? AND patient_id != ?",
                    [email, patient_id]
                );
                if (emailExists.length > 0) {
                    return res.status(409).json({ error: "Email already exists." });
                }
            }

            if (username) {
                const [usernameExists] = await pool.promise().query(
                    "SELECT * FROM patient WHERE username = ? AND patient_id != ?",
                    [username, patient_id]
                );
                if (usernameExists.length > 0) {
                    return res.status(409).json({ error: "Username already exists." });
                }
            }
        }

        // Hash password if provided
        let hashedPassword = null;
        if (password) {
            const bcrypt = require("bcrypt");
            hashedPassword = await bcrypt.hash(password, 10);
        }

        const updateFields = [];
        const values = [];

        // Collect fields to update
        if (name) updateFields.push("name = ?"), values.push(name);
        if (dob) updateFields.push("dob = ?"), values.push(dob);
        if (gender) updateFields.push("gender = ?"), values.push(gender);
        if (contact) updateFields.push("contact = ?"), values.push(contact);
        if (address) updateFields.push("address = ?"), values.push(address);
        if (email) updateFields.push("email = ?"), values.push(email);
        if (username) updateFields.push("username = ?"), values.push(username);
        if (hashedPassword) updateFields.push("password = ?"), values.push(hashedPassword);
        if (insurance_id !== undefined) updateFields.push("insurance_id = ?"), values.push(insurance_id);
        if (bloodgroup) updateFields.push("bloodgroup = ?"), values.push(bloodgroup);
        if (medical_history) updateFields.push("medical_history = ?"), values.push(medical_history);

        if (updateFields.length === 0) {
            return res.status(400).json({ error: "No fields provided to update." });
        }

        values.push(patient_id);

        const query = `UPDATE patient SET ${updateFields.join(", ")} WHERE patient_id = ?`;
        await pool.promise().query(query, values);

        const [results] = await pool.promise().query(
            "SELECT * FROM patient WHERE patient_id = ?",
            [patient_id]
        );

        if (results.length === 0) {
            return res.status(404).json({ error: "Patient not found after update." });
        }

        const patient = results[0];
        const { password: _, ...patientData } = patient;

        res.status(200).json({
            message: isAdmin ? "Patient details updated by admin successfully." : "Patient profile updated successfully.",
            patient: patientData
        });

    } catch (err) {
        console.error("Error updating patient:", err);
        res.status(500).json({ error: "Failed to update patient details." });
    }
};




exports.deletePatient = async (req, res, pool) => {
    const isAdmin = req.user && req.user.role === "admin";
    const patient_id = isAdmin ? req.params.patient_id : req.user.patient_id;

    if (!patient_id) {
        return res.status(400).json({ error: "Patient ID not provided." });
    }

    const connection = await pool.promise().getConnection();

    try {
        await connection.beginTransaction();

        // Check if patient exists
        const [existingPatient] = await connection.query(
            "SELECT * FROM patient WHERE patient_id = ?",
            [patient_id]
        );

        if (existingPatient.length === 0) {
            await connection.release();
            return res.status(404).json({ error: "Patient not found." });
        }

        // 1. Get appointment IDs linked to this patient
        const [appointments] = await connection.query(
            "SELECT appointment_id FROM appointment WHERE patient_id = ?",
            [patient_id]
        );

        const appointmentIds = appointments.map((row) => row.appointment_id);

        if (appointmentIds.length > 0) {
            // 2. Get prescribed_test_ids
            const [prescribedTests] = await connection.query(
                "SELECT prescribed_test_id FROM prescribed_test WHERE appointment_id IN (?)",
                [appointmentIds]
            );

            const prescribedTestIds = prescribedTests.map((row) => row.prescribed_test_id);

            // 3. Delete patient_test entries
            if (prescribedTestIds.length > 0) {
                await connection.query(
                    "DELETE FROM patient_test WHERE prescribed_test_id IN (?)",
                    [prescribedTestIds]
                );
            }

            // 4. Delete prescribed_test entries
            if (prescribedTestIds.length > 0) {
                await connection.query(
                    "DELETE FROM prescribed_test WHERE prescribed_test_id IN (?)",
                    [prescribedTestIds]
                );
            }

            // 5. Delete treatment_medication entries
            const [treatments] = await connection.query(
                "SELECT treatment_id FROM treatment WHERE appointment_id IN (?)",
                [appointmentIds]
            );
            const treatmentIds = treatments.map((row) => row.treatment_id);

            if (treatmentIds.length > 0) {
                await connection.query(
                    "DELETE FROM treatment_medication WHERE treatment_id IN (?)",
                    [treatmentIds]
                );
            }

            // 6. Delete treatments
            await connection.query(
                "DELETE FROM treatment WHERE appointment_id IN (?)",
                [appointmentIds]
            );

            // 7. Delete booked_slots
            await connection.query(
                "DELETE FROM booked_slots WHERE appointment_id IN (?)",
                [appointmentIds]
            );

            // 8. Delete appointments
            await connection.query(
                "DELETE FROM appointment WHERE appointment_id IN (?)",
                [appointmentIds]
            );
        }

        // 9. Delete admissions
        await connection.query(
            "DELETE FROM admission WHERE patient_id = ?",
            [patient_id]
        );

        // 10. Finally delete the patient
        await connection.query(
            "DELETE FROM patient WHERE patient_id = ?",
            [patient_id]
        );

        await connection.commit();
        res.status(200).json({ message: "Patient and all associated records deleted successfully." });
    } catch (err) {
        await connection.rollback();
        console.error("Error deleting patient:", err);
        res.status(500).json({ error: "Failed to delete patient." });
    } finally {
        connection.release();
    }
};


exports.getPatientsByPartialName = (req, res, pool) => {
    const { q } = req.query;

    // Validate input
    if (!q || q.trim() === "") {
        return res.status(400).json({ error: "Search query is required." });
    }

    const searchQuery = `%${q}%`;

    const sql = `
        SELECT patient_id, username, name 
        FROM patient 
        WHERE username LIKE ? OR name LIKE ? 
        LIMIT 10
    `;

    pool.query(sql, [searchQuery, searchQuery], (err, results) => {
        if (err) {
            console.error("Error fetching patients:", err);
            return res.status(500).json({ error: "Database error." });
        }

        if (!results || results.length === 0) {
            return res.status(200).json({ message: "No matching patients found." });
        }

        const suggestions = [];
        for (let i = 0; i < results.length; i++) {
            suggestions.push({
                patient_id: results[i].patient_id,
                username: results[i].username,
                name: results[i].name
            });
        }

        res.status(200).json(suggestions);
    });
};


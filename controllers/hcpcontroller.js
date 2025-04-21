const bcrypt = require("bcrypt");
// Register new HCP
exports.registerHCP = async (req, res, pool) => {
    const {
        username,
        email,
        password,
        name,
        designation,
        specialization,
        contact,
        image,
        about,
         hcp_code // Add secret code to request body
    } = req.body;

    if (!username || !email || !password || !name || !designation || !image || !specialization || !hcp_code) {
        return res.status(400).json({ error: "Required fields missing." });
    }

    // Check if the provided secret code matches the predefined one
    if (hcp_code !== process.env.HCP_SECRET_CODE) {
        return res.status(403).json({ error: "Invalid secret code." });
    }

    const connection = await pool.promise().getConnection();

    try {
        await connection.beginTransaction();

        // Check for existing user
        const [existing] = await connection.query(
            "SELECT * FROM users WHERE username = ? OR email = ?",
            [username, email]
        );
        if (existing.length > 0) {
            await connection.release();
            return res.status(409).json({ error: "Username or email already exists." });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Insert into users table
        const [userResult] = await connection.query(
            `INSERT INTO users (username, email, password, role, image, name)
             VALUES (?, ?, ?, 'hcp', ?, ?)`,
            [username, email, hashedPassword, image, name]
        );
        const user_id = userResult.insertId;

        // Insert into health_care_professional table
        await connection.query(
            `INSERT INTO health_care_professional 
             (user_id, designation, specialization, contact, about)
             VALUES (?, ?, ?, ?, ?)`,
            [user_id, designation, specialization, contact || null, about || null]
        );

        await connection.commit();
        connection.release();
        res.status(201).json({ message: "HCP registered successfully." });

    } catch (err) {
        await connection.rollback();
        connection.release();
        console.error("Error registering HCP:", err);
        res.status(500).json({ error: "Internal server error." });
    }
};


// Get all HCP users
exports.getAllHCPs = async (req, res, pool) => {
    try {
        const [results] = await pool.promise().query(`
            SELECT 
                hcp.hcp_id,
                hcp.user_id,
                u.username,
                u.email,
                hcp.name,
                hcp.designation,
                hcp.specialization,
                hcp.contact,
                hcp.about,
                u.salary
            FROM health_care_professional hcp
            JOIN users u ON hcp.user_id = u.user_id
        `);

        res.status(200).json(results);
    } catch (err) {
        console.error("Error fetching HCPs:", err);
        res.status(500).json({ error: "Internal server error." });
    }
};
exports.updateHCP = async (req, res, pool) => {
    const  {id}  = req.params; // hcp_id
    const {
        name,
        designation,
        specialization,
        contact,
        salary,
        username,
        email,
        password,
        about
    } = req.body.data;
    try {
        // Step 1: Fetch current HCP and user data
        const [hcpRows] = await pool.promise().query(
            `SELECT hcp.*, u.username, u.email, u.password AS userPassword, u.user_id 
             FROM health_care_professional hcp 
             JOIN users u ON hcp.user_id = u.user_id 
             WHERE u.user_id = ?`,
            [id]
        );

        if (hcpRows.length === 0) {
            return res.status(404).json({ error: "HCP not found." });
        }

        const existing = hcpRows[0];

        // Step 2: Prepare values to update (use existing if not provided)
        const updatedUsername = username || existing.username;
        const updatedEmail = email || existing.email;
        const updatedPassword = password
            ? await bcrypt.hash(password, 10)
            : existing.userPassword;

        const updatedName = name || existing.name;
        const updatedDesignation = designation || existing.designation;
        const updatedSpecialization = specialization || existing.specialization;
        const updatedContact = contact || existing.contact;
        const updatedSalary = salary || existing.salary;
        const updatedAbout = about || existing.about;

        // Step 3: Update `users` table
        await pool.promise().query(
            `UPDATE users SET name = ?, username = ?, email = ?, password = ?,salary=? WHERE user_id = ?`,
            [updatedName,updatedUsername, updatedEmail, updatedPassword, updatedSalary, existing.user_id]
        );

        // Step 4: Update `health_care_professional` table
        await pool.promise().query(
            `UPDATE health_care_professional 
             SET designation = ?, specialization = ?, contact = ?,about = ?
             WHERE hcp_id = ?`,
            [
                updatedDesignation,
                updatedSpecialization,
                updatedContact,
                updatedAbout,
                id
            ]
        );
        const [users] = await pool.promise().query(
            `SELECT * FROM users WHERE user_id = ?`,
            [id]
        );
        if (users.length === 0) {
            return res.status(404).json({ error: "User not found/Invalid user id." });
        }
        const user = users[0];
        const [hcpResult] = await pool.promise().query(
            `SELECT * FROM health_care_professional WHERE user_id = ?`,
            [user.user_id]
        );
        if (hcpResult.length > 0) {
            hcpData = hcpResult[0];
        } else {
            return res.status(404).json({ error: "No health care professional data found." });
        }

        res.json({ message: "HCP and user details updated successfully." ,
            user: {
                id: user.user_id,
                username: user.username,
                email: user.email,
                role: user.role,
                name: user.name,
                salary: user.salary,
                joined_date: user.joined_date,
                hcpData: hcpData || null
            },
        });

    } catch (err) {
        console.error("Error updating HCP and user:", err);
        res.status(500).json({ error: "Internal server error." });
    }
};
// Delete an HCP (also deletes user)
exports.deleteHCP = async (req, res, pool) => {
    const { id } = req.params; // hcp_id from URL

    try {
        // First, get the user_id from hcp
        const [rows] = await pool.promise().query(
            `SELECT user_id FROM health_care_professional WHERE hcp_id = ?`,
            [id]
        );

        if (rows.length === 0) {
            return res.status(404).json({ error: "HCP not found." });
        }

        const user_id = rows[0].user_id;

        // Delete from health_care_professional table
        await pool.promise().query(`DELETE FROM health_care_professional WHERE hcp_id = ?`, [id]);

        // Delete from users table
        await pool.promise().query(`DELETE FROM users WHERE user_id = ?`, [user_id]);

        res.json({ message: "HCP deleted successfully." });

    } catch (err) {
        console.error("Error deleting HCP:", err);
        res.status(500).json({ error: "Internal server error." });
    }
};


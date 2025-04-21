const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
exports.registerUser = async (req, res, pool) => {
    const { username, email, password, role, name, image, admin_secret, hcp_code, desk_code } = req.body;

    if (!username || !email || !password || !role || !name || !image) {
        return res.status(400).json({ error: "All fields are required." });
    }

    const validRoles = ['admin', 'hcp', 'frontdesk', 'dataentry'];
    if (!validRoles.includes(role)) {
        return res.status(400).json({ error: "Invalid role specified." });
    }

    try {
        // Check if username or email already exists
        const [existing] = await pool.promise().query(
            "SELECT * FROM users WHERE username = ? OR email = ?",
            [username, email]
        );

        if (existing.length > 0) {
            return res.status(409).json({ error: "Username or email already taken." });
        }

        // Admin role check
        if (role === 'admin') {
            if (!admin_secret) {
                return res.status(400).json({ error: "Company secret code is required for admin registration." });
            }
            if (admin_secret !== process.env.ADMIN_SECRET_CODE) {
                return res.status(400).json({ error: "Invalid company secret code." });
            }
        }

        // HCP professional role check
        if (role === 'hcp') {
            if (!hcp_code || hcp_code !== process.env.HCP_SECRET_CODE) {
                return res.status(400).json({ error: "Invalid HCP registration code." });
            }
        }

        // Frontdesk or Dataentry role check (using same desk_code for both, adjust if needed)
        if (role === 'frontdesk' || role === 'dataentry') {
            if (!desk_code || desk_code !== process.env.DESK_SECRET_CODE) {
                return res.status(400).json({ error: "Invalid frontdesk/dataentry registration code." });
            }
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        // Insert user
        const [result] = await pool.promise().query(
            "INSERT INTO users (username, email, password, role, name, image) VALUES (?, ?, ?, ?, ?, ?)",
            [username, email, hashedPassword, role, name, image]
        );

        const user_id = result.insertId;

        // Generate JWT token
        const token = jwt.sign(
            { user_id, username, role },
            process.env.JWT_SECRET_KEY,
            { expiresIn: process.env.JWT_EXPIRES_IN || "1d" }
        );

        res.status(201).json({
            message: "User registered successfully.",
            token,
            user: { user_id, username, email, role, name, image }
        });

    } catch (err) {
        console.error("Registration error:", err);
        res.status(500).json({ error: "Internal server error." });
    }
};
exports.loginUser = async (req, res, pool) => {
    const { usernameOrEmail, password } = req.body;
    if (!usernameOrEmail || !password) {
        return res.status(400).json({ error: "Username/email and password are required." });
    }
    try {
        // Find user by username or email
        const [users] = await pool.promise().query(
            `SELECT * FROM users WHERE username = ? OR email = ?`,
            [usernameOrEmail, usernameOrEmail]
        );
        if (users.length === 0) {
            return res.status(404).json({ error: "User not found/Invalid username/email or password." });
        }
        const user = users[0];
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ error: "Invalid credentials." });
        }
        // Check if role is 'hcp' and join with health_care_proffession table
        let hcpData = null;
        if (user.role === 'hcp') {
            const [hcpResult] = await pool.promise().query(
                `SELECT * FROM health_care_professional WHERE user_id = ?`,
                [user.user_id]
            );
           
            if (hcpResult.length > 0) {
                hcpData = hcpResult[0];
            } else {
                return res.status(404).json({ error: "No health care professional data found." });
            }
        }

        // Generate JWT (optional: include role)
        const token = jwt.sign(
            { user_id: user.user_id, role: user.role, name: user.name },
            process.env.JWT_SECRET_KEY,
            { expiresIn: "1d" }
        );

        // Send response including health care professional data if available
        res.json({
            message: "Login successful.",
            token,
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
             // Send health care professional data if available
        });
    } catch (err) {
        console.error("Login error:", err);
        res.status(500).json({ error: "Internal server error." });
    }
};
exports.updateUser = async (req, res, pool) => {
    const { user_id } = req.params;
    const { username, password, role, name, image, salary } = req.body.data;
    const requester = req.user;

    try {
        const fields = [];
        const values = [];

        const isSelf = parseInt(user_id) === requester.user_id;
        const isAdmin = requester.role === "admin";

        if (!isSelf && !isAdmin) {
            return res.status(403).json({ error: "You are not allowed to update other users." });
        }

        // Handle username
        if (username) {
            const [existingUser] = await pool.promise().query(
                "SELECT user_id FROM users WHERE username = ?",
                [username]
            );

            if (existingUser.length > 0) {
                const otherUser = existingUser[0];
                if (otherUser.user_id != user_id) {
                    return res.status(400).json({ error: "Username already exists. Please choose a different one." });
                }
            }

            fields.push("username = ?");
            values.push(username);
        }

        // Handle password
        if (password) {
            const hashedPassword = await bcrypt.hash(password, 10);
            fields.push("password = ?");
            values.push(hashedPassword);
        }

        // Handle role
        if (role) {
            const validRoles = ['admin', 'hcp', 'frontdesk', 'dataentry'];
            if (!validRoles.includes(role)) {
                return res.status(400).json({ error: "Invalid role specified." });
            }

            if (!isAdmin) {
                return res.status(403).json({ error: "Only admin can change roles." });
            }

            fields.push("role = ?");
            values.push(role);
        }

        // Handle name
        if (name) {
            fields.push("name = ?");
            values.push(name);
        }

        // Handle image
        if (image) {
            fields.push("image = ?");
            values.push(image);
        }

        // Handle salary
        if (salary !== undefined) {
            if (isNaN(salary) || salary < 0) {
                return res.status(400).json({ error: "Invalid salary value." });
            }

            fields.push("salary = ?");
            values.push(salary);
        }

        // If no fields are provided to update, return an error
        if (fields.length === 0) {
            return res.status(400).json({ error: "No valid fields to update." });
        }

        // Add user_id to the end of the values array
        values.push(user_id);

        // Execute the update query
        await pool.promise().query(
            `UPDATE users SET ${fields.join(", ")} WHERE user_id = ?`,
            values
        );

        // Fetch the updated user data
        const [updatedUser] = await pool.promise().query(
            "SELECT user_id as id, username, role, name, email, salary FROM users WHERE user_id = ?",
            [user_id]
        );

        if (updatedUser.length === 0) {
            return res.status(404).json({ error: "User not found after update." });
        }

        // Return the updated user data in the response
        res.json({ message: "User updated successfully.", user: updatedUser[0] });

    } catch (err) {
        console.error("Update user error:", err);
        res.status(500).json({ error: "Internal server error." });
    }
};

exports.deleteUser = async (req, res, pool) => {
    const { user_id } = req.params;
    const requester = req.user;

    try {
        const [users] = await pool.promise().query(
            "SELECT * FROM users WHERE user_id = ?",
            [user_id]
        );

        if (users.length === 0) {
            return res.status(404).json({ error: "User not found." });
        }

        const user = users[0];

        // Allow user to delete their own account
        const isSelfDelete = requester.user_id === parseInt(user_id);

        if (!isSelfDelete && requester.role !== "admin") {
            return res.status(403).json({ error: "Unauthorized to delete this user." });
        }

        if (user.role === "hcp") {
            // If HCP, delete from HCP table first
            const [hcpRows] = await pool.promise().query(
                "SELECT hcp_id FROM health_care_professional WHERE user_id = ?",
                [user_id]
            );

            if (hcpRows.length > 0) {
                const hcp_id = hcpRows[0].hcp_id;

                // Delete HCP record
                await pool.promise().query("DELETE FROM health_care_professional WHERE hcp_id = ?", [hcp_id]);
            }
        }

        // Delete user account
        await pool.promise().query("DELETE FROM users WHERE user_id = ?", [user_id]);

        res.json({ message: "User account deleted successfully." });

    } catch (err) {
        console.error("Delete user error:", err);
        res.status(500).json({ error: "Internal server error." });
    }
};
exports.getUserImage = async (req, res, pool) => {
    try {
        const userId = req.params.id;
        const sql = 'SELECT image FROM users WHERE user_id = ?';

        pool.query(sql, [userId], (err, results) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ error: 'Database error' });
            }

            if (results.length === 0) {
                console.error('User not found');
                return res.status(404).json({ error: 'User not found' });
            }

            const base64Image = results[0].image;
            if (!base64Image) {
                console.error('Image not found');
                return res.status(404).json({ error: 'Image not found' });
            }

            res.status(200).json({ base64: base64Image });
        });

    } catch (err) {
        console.error('Unexpected error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
};
exports.getAllDoctors = async (req, res, pool) => {
    try {
        // const [rows] = await pool.promise().query(
        //     `SELECT * FROM health_care_professional WHERE designation = 'Doctor'`
        // );
        const [rows] = await pool.promise().query(
            `SELECT 
                u.user_id,
                u.username,
                u.email,
                u.role,
                u.name,
                hcp.hcp_id,
                hcp.designation,
                hcp.specialization,
                hcp.contact,
                hcp.about,
                u.joined_date,
                u.image
            FROM 
                health_care_professional hcp
            JOIN 
                users u ON u.user_id = hcp.user_id 
            WHERE hcp.designation = 'Doctor'`
        );
        res.json(rows);
    } catch (err) {
        console.error("Error fetching doctors:", err);
        res.status(500).json({ error: 'Internal server error' });
    }
};
exports.getAllHCPUsers = async (req, res, pool) => {
    try {
        const [rows] = await pool.promise().query(
            `SELECT 
                u.user_id,
                u.username,
                u.email,
                u.role,
                u.name,
                hcp.hcp_id,
                hcp.designation,
                hcp.specialization,
                hcp.contact,
                u.salary,
                u.image
            FROM 
                health_care_professional hcp
            JOIN 
                users u ON u.user_id = hcp.user_id `
        );
        res.json(rows);
    } catch (err) {
        console.error("Error fetching HCP users:", err);
        res.status(500).json({ error: 'Internal server error' });
    }
};
exports.getAllUsers = async (req, res, pool) => {
    try {
        const [users] = await pool.promise().query(`SELECT user_id,username,name,role, email,joined_date,salary,image FROM users WHERE role != 'hcp' AND role != 'admin'`);
        res.json(users);
    } catch (err) {
      console.error("Error fetching users:", err);
      res.status(500).json({ error: "Internal server error." });
    }
};
exports.getFDOUsers = async (req, res, pool) => {
    try {
        const [users] = await pool.promise().query(`SELECT name,  role, email,image FROM users WHERE role == 'frontdesk'`);
        res.json(users);
    } catch (err) {
      console.error("Error fetching front desk operator users:", err);
      res.status(500).json({ error: "Internal server error." });
    }
};
exports.getDEOUsers = async (req, res, pool) => {
    try {
        const [users] = await pool.promise().query(`SELECT name,  role, email,image FROM users WHERE role == 'dataentry'`);
        res.json(users);
    } catch (err) {
      console.error("Error fetching data entry operator users:", err);
      res.status(500).json({ error: "Internal server error." });
    }
};
// exports.getStats = (req, res, pool) => {
//     const stats = {};
//     pool.query("SELECT COUNT(*) AS totalPatients FROM patient", (err, patientResults) => {
//         if (err) return res.status(500).json({ error: err.message });
//         stats.totalPatients = patientResults[0].totalPatients;

//         pool.query("SELECT COUNT(*) AS totalDoctors FROM health_care_professional", (err, doctorResults) => {
//             if (err) return res.status(500).json({ error: err.message });
//             stats.totalDoctors = doctorResults[0].totalDoctors;

//             pool.query("SELECT COUNT(*) AS totalAppointments FROM appointment", (err, apptResults) => {
//                 if (err) return res.status(500).json({ error: err.message });
//                 stats.totalAppointments = apptResults[0].totalAppointments;

//                 res.json(stats);
//             });
//         });
//     });
// };


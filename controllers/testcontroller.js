exports.addTest = async (req, res, pool) => {
    const requester = req.user;
    if (requester.role !== "admin") {
        return res.status(403).json({ error: "Only admins can add tests." });
    }

    const { test_name, description, fee } = req.body;

    if (!test_name || !fee) {
        return res.status(400).json({ error: "Test name and fee are required." });
    }

    try {
        await pool.promise().query(
            `INSERT INTO test (test_name, description, fee) VALUES (?, ?, ?)`,
            [test_name, description || null, fee]
        );
        res.status(201).json({ message: "Test added successfully." });
    } catch (err) {
        console.error("Add test error:", err);
        res.status(500).json({ error: "Internal server error." });
    }
};
exports.updateTest = async (req, res, pool) => {
    const requester = req.user;
    if (requester.role !== "admin") {
        return res.status(403).json({ error: "Only admins can update tests." });
    }

    const { test_id } = req.params;
    const { test_name, description, fee } = req.body;

    try {
        await pool.promise().query(
            `UPDATE test SET test_name = ?, description = ?, fee = ? WHERE test_id = ?`,
            [test_name, description || null, fee, test_id]
        );
        res.json({ message: "Test updated successfully." });
    } catch (err) {
        console.error("Update test error:", err);
        res.status(500).json({ error: "Internal server error." });
    }
};
exports.deleteTest = async (req, res, pool) => {
    const requester = req.user;
    if (requester.role !== "admin") {
        return res.status(403).json({ error: "Only admins can delete tests." });
    }

    const { test_id } = req.params;

    try {
        await pool.promise().query(`DELETE FROM test WHERE test_id = ?`, [test_id]);
        res.json({ message: "Test deleted successfully." });
    } catch (err) {
        console.error("Delete test error:", err);
        res.status(500).json({ error: "Internal server error." });
    }
};
exports.getAllTests = async (req, res, pool) => {
    try {
        const [rows] = await pool.promise().query(`SELECT * FROM test`);
        res.json(rows);
    } catch (err) {
        console.error("Fetch tests error:", err);
        res.status(500).json({ error: "Internal server error." });
    }
};
exports.prescribeTests = async (req, res, pool) => {
    const { appointment_id, test_ids } = req.body; // test_ids is an array

    try {
        const values = test_ids.map(test_id => [appointment_id, test_id]);
        await pool.promise().query(
            `INSERT INTO prescribed_test (appointment_id, test_id) VALUES ?`,
            [values]
        );
        res.status(201).json({ message: 'Tests prescribed successfully' });
    } catch (err) {
        console.error("Prescription error:", err);
        res.status(500).json({ error: 'Failed to prescribe tests' });
    }
};
exports.addTestResults = async (req, res, pool) => {
    const { prescribed_test_id, result, test_date,file } = req.body;

    try {
        await pool.promise().query(
            `INSERT INTO patient_test (prescribed_test_id, result, test_date,file)
             VALUES (?, ?, ?,?)`,
            [prescribed_test_id, result, test_date,file]
        );
        res.status(201).json({ message: 'Test result added' });
    } catch (err) {
        console.error("Result entry error:", err);
        res.status(500).json({ error: 'Failed to add test result' });
    }
};
exports.getPrescribedTests = async (req, res, pool) => {
    const { appointment_id } = req.params;

    try {
        const [tests] = await pool.promise().query(
            `SELECT pt.prescribed_test_id, t.test_name, t.description
             FROM prescribed_test pt
             JOIN test t ON pt.test_id = t.test_id
             WHERE pt.appointment_id = ?`,
            [appointment_id]
        );
        res.json(tests);
    } catch (err) {
        console.error("Fetch prescribed tests error:", err);
        res.status(500).json({ error: 'Failed to fetch prescribed tests' });
    }
};
exports.getTestResultsForPatient = async (req, res, pool) => {
    const { patient_id } = req.params;
    try {
        // Query to get all prescribed tests for the given patient
        const [prescribedTests] = await pool.promise().query(
            `SELECT pr.appointment_id, t.test_name, pt.result, pt.test_date,pt.file
             FROM prescribed_test pr
             JOIN test t ON pr.test_id = t.test_id
             LEFT JOIN patient_test pt ON pr.prescribed_test_id = pt.prescribed_test_id
             WHERE pr.appointment_id IN (
                 SELECT appointment_id FROM appointment WHERE patient_id = ?
             )`, 
            [patient_id]
        );
        if (prescribedTests.length === 0) {
            return res.status(200).json({ error: 'No prescribed tests found for this patient' });
        }

        // Format the result to distinguish between completed and not completed tests
        const formattedResults = prescribedTests.map(test => ({
            appointment_id: test.appointment_id,
            test_name: test.test_name,
            result: test.result ? test.result : 'Test not completed',
            test_date: test.test_date ? new Date(test.test_date).toLocaleString() : 'Not available',
            status: test.result ? 'Completed' : 'Pending',
            file: test.file ? test.file : "Not Completed yet"
        }));
        res.json(formattedResults);
    } catch (err) {
        console.error("Fetch test results error:", err);
        res.status(500).json({ error: 'Failed to fetch test results' });
    }
};
exports.getTestResults = async (req, res, pool) => {
    const { appointment_id } = req.params;

    try {
        const [results] = await pool.promise().query(
            `SELECT t.test_name, pt.result, pt.test_date
             FROM patient_test pt
             JOIN prescribed_test pr ON pt.prescribed_test_id = pr.prescribed_test_id
             JOIN test t ON pr.test_id = t.test_id
             WHERE pr.appointment_id = ?`,
            [appointment_id]
        );
        res.json(results);
    } catch (err) {
        console.error("Fetch test results error:", err);
        res.status(500).json({ error: 'Failed to fetch test results' });
    }
};
exports.getTestResultsForDoctor = async (req, res, pool) => {
    const { appointment_id } = req.params;
    const doctor_id = req.user.id; // assuming doctor ID is stored in token as `id`

    try {
        const [[appointment]] = await pool.promise().query(
            `SELECT hcp_id FROM appointment WHERE appointment_id = ?`,
            [appointment_id]
        );

        if (!appointment || appointment.hcp_id !== doctor_id) {
            return res.status(403).json({ error: "Not authorized to view this appointment's results" });
        }

        const [results] = await pool.promise().query(
            `SELECT t.test_name, pt.result, pt.test_date 
             FROM patient_test pt
             JOIN test t ON pt.test_id = t.test_id
             WHERE pt.appointment_id = ?`,
            [appointment_id]
        );

        res.json({ appointment_id, results });
    } catch (err) {
        console.error("Doctor view test results error:", err);
        res.status(500).json({ error: "Failed to fetch test results" });
    }
};
exports.getPendingPrescribedTests = async (req, res, pool) => {
    try {
        const [pendingTests] = await pool.promise().query(
            `SELECT pt.prescribed_test_id, pt.appointment_id, t.test_name
             FROM prescribed_test pt, test t
             WHERE pt.test_id = t.test_id
             AND pt.prescribed_test_id NOT IN (
                 SELECT prescribed_test_id FROM patient_test
             )`
        );

        if (pendingTests.length === 0) {
            return res.status(200).json({ message: 'No pending prescribed tests found' });
        }

        res.json(pendingTests);
    } catch (err) {
        console.error("Error fetching pending prescribed tests:", err);
        res.status(500).json({ error: 'Failed to fetch pending prescribed tests' });
    }
};
exports.getCompletedPrescribedTests = async (req, res, pool) => {
    const { limit = 10, page = 1 } = req.query; // Default to 10 items per page and page 1
    const offset = (page - 1) * limit;

    try {
        const [completedTests] = await pool.promise().query(
            `SELECT pt.prescribed_test_id, pt.appointment_id, t.test_name, p.result, p.test_date,p.file
             FROM prescribed_test pt JOIN test t ON pt.test_id = t.test_id
             JOIN patient_test p ON pt.prescribed_test_id = p.prescribed_test_id
             LIMIT ? OFFSET ?`,
            [parseInt(limit), offset]
        );

        if (completedTests.length === 0) {
            return res.status(200).json({ message: 'No completed prescribed tests found' });
        }

        res.json(completedTests);
    } catch (err) {
        console.error("Error fetching completed prescribed tests:", err);
        res.status(500).json({ error: 'Failed to fetch completed prescribed tests' });
    }
};
exports.getCompletedTestById = async (req, res, pool) => {
    const { id } = req.params;

    try {
        const [test] = await pool.promise().query(
            `SELECT pt.prescribed_test_id, pt.appointment_id, t.test_name, p.result, p.test_date, p.file
             FROM prescribed_test pt
             JOIN test t ON pt.test_id = t.test_id
             JOIN patient_test p ON pt.prescribed_test_id = p.prescribed_test_id
             WHERE pt.prescribed_test_id = ?`,
            [id]
        );

        if (test.length === 0) {
            return res.status(404).json({ message: 'Completed test not found for the given ID' });
        }

        res.json(test[0]);
    } catch (err) {
        console.error("Error fetching completed test by ID:", err);
        res.status(500).json({ error: 'Failed to fetch completed test' });
    }
};

exports.editTestResults = async (req, res, pool) => {
    const { prescribed_test_id } = req.params; // ID of the prescribed test to update
    const { result, test_date, file } = req.body; // Data to update (result, test_date, file)

    // Validation check for input fields
    if (!result || !test_date || !file) {
        return res.status(400).json({ error: 'All fields are required.' });
    }

    try {
        // Query to update the patient test result
        const [updateResult] = await pool.promise().query(
            `UPDATE patient_test
             SET result = ?, test_date = ?, file = ?
             WHERE prescribed_test_id = ?`,
            [result, test_date, file, prescribed_test_id]
        );

        // Check if any rows were affected (i.e., if the update was successful)
        if (updateResult.affectedRows === 0) {
            return res.status(404).json({ error: 'Prescribed test not found.' });
        }

        // Successfully updated
        res.json({ message: 'Test results updated successfully!' });
    } catch (err) {
        console.error("Error updating test result:", err);
        res.status(500).json({ error: 'Failed to update test results.' });
    }
};

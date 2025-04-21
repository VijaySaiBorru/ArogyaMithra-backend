// routes/testroutes.js
const express = require("express");
const {
    addTest,
    updateTest,
    deleteTest,
    getAllTests,
    prescribeTests,
    addTestResults,
    getPrescribedTests,
    getTestResults,
    getTestResultsForPatient,
    getPendingPrescribedTests,
    getCompletedPrescribedTests,
    getCompletedTestById,
    editTestResults
} = require("../controllers/testcontroller");

const { verifyToken, verifyDoctor, verifyDataEntry } = require("../middleware/auth");

module.exports = (pool) => {
    const router = express.Router();

    // Test master data (for admin or similar roles)
    router.post("/add", verifyToken, (req, res) => addTest(req, res, pool));
    router.put("/update/:test_id", verifyToken, (req, res) => updateTest(req, res, pool));
    router.delete("/delete/:test_id", verifyToken, (req, res) => deleteTest(req, res, pool));
    router.get("/all", (req, res) => getAllTests(req, res, pool));

    // Doctor prescribes tests
    router.post("/prescribe", verifyToken, verifyDoctor, (req, res) => prescribeTests(req, res, pool));

    // Data entry operator adds test results
    router.post("/results", verifyToken, verifyDataEntry, (req, res) => addTestResults(req, res, pool));

    // Get prescribed tests for an appointment
    router.get("/prescribed/:appointment_id", verifyToken, (req, res) => getPrescribedTests(req, res, pool));
    router.get('/testResultsForPatient/:patient_id',verifyToken,(req, res) => getTestResultsForPatient(req, res, pool));

    // Get test results for an appointment
    router.get("/results/:appointment_id", verifyToken, (req, res) => getTestResults(req, res, pool));
    router.get("/results/:appointment_id/doctor", verifyToken, verifyDoctor, (req, res) => getTestResultsForDoctor(req, res, pool));
    router.get('/prescribed-tests/pending', (req, res) => getPendingPrescribedTests(req, res, pool));
    router.get('/completed-tests',(req, res) => getCompletedPrescribedTests(req, res, pool) );
    router.get('/completed-tests/:id',(req, res) => getCompletedTestById(req, res, pool) );
    router.put('/edit-test/:prescribed_test_id',(req, res) => editTestResults(req, res, pool) );


    return router;
};

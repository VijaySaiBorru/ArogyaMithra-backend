const express = require("express");
const { addTreatment, getTreatmentByAppointment, getTreatmentsForPatient,updateTreatmentDetails } = require("../controllers/treatmentcontroller");
const { verifyToken, verifyDoctor } = require("../middleware/auth");

module.exports = (pool) => {
    const router = express.Router();

    router.post("/add", verifyToken, (req, res) => addTreatment(req, res, pool));
    router.get("/:appointment_id", verifyToken, (req, res) => getTreatmentByAppointment(req, res, pool));
    router.get('/treatments/:patient_id', (req, res) => {getTreatmentsForPatient(req, res, pool);});
    router.put('/appointment/:appointment_id/details', verifyToken, (req, res) => updateTreatmentDetails(req, res, pool));

    return router;
};

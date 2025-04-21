const express = require("express");
const { admitPatient,dischargePatient,updateFees, getAdmittedPatients } = require("../controllers/admissioncontroller");
const {verifyToken} = require("../middleware/auth");

module.exports = (pool) => {
    const router = express.Router();
    router.post("/admit", verifyToken, (req, res) => admitPatient(req, res, pool));
    router.put("/fees/:admission_id", verifyToken, (req, res) => updateFees(req, res, pool));
    router.put("/discharge/:admission_id", verifyToken, (req, res) => dischargePatient(req, res, pool));
    router.get('/admitted-patients', verifyToken, (req, res) => getAdmittedPatients(req, res, pool));
    return router;
};

const express = require("express");
const { registerPatient,registerFrontDeskPatient, getAllPatients,loginPatient,getPatientAppointments,bookAppointment,updatePatient, deletePatient, getPatientById, getPatientsByPartialName, verifyOTPAndRegister } = require("../controllers/patientcontroller");
const { verifyToken } = require("../middleware/auth");
module.exports = (pool) => {
    const router = express.Router();
    router.get("/", (req, res) => getAllPatients(req, res, pool));
    router.post("/register", (req, res) => registerPatient(req, res, pool));
    router.post("/frontdesk-register", (req, res) => registerFrontDeskPatient(req, res, pool));
    router.post("/verify-register",(req,res)=> verifyOTPAndRegister(req,res,pool));
    router.post("/login",(req,res)=>loginPatient(req, res, pool));
    router.get("/appointments", verifyToken, (req, res) => getPatientAppointments(req, res, pool));
    router.post("/book-appointment", verifyToken, (req, res) => bookAppointment(req, res, pool));
    router.put("/update", verifyToken, (req, res) => updatePatient(req, res, pool));
    router.delete('/delete/:patient_id', verifyToken, (req, res) => deletePatient(req, res, pool));
    router.get('/patients/search', (req, res) => getPatientsByPartialName(req, res, pool));
    router.get('/patients/:id', (req, res) => getPatientById(req, res, pool));
    
    return router;
};


const express = require('express');
const router = express.Router();
const { verifyToken, verifyDoctor } = require("../middleware/auth");
const {
    addSlot,
    getSlots,
    bookAppointment,
    getAppointmentsForDoctor,
    getAppointmentsForPatient,
    updateAppointmentStatus,
    deleteSlot,
    generateWeeklySlots,
    getAllAppointments,
    getAppointmentDetails,
    getAllPatientRecords,
    getUpcomingSlots
} = require("../controllers/appointmentcontroller");

module.exports = (pool) => {
    router.post('/slots', verifyToken, verifyDoctor, (req, res) => addSlot(req, res, pool));
    router.get('/appointments/admin',verifyToken, (req, res) => getAllAppointments(req, res, pool));
    router.get('/slots/:hcp_id/:day', (req, res) => getSlots(req, res, pool));
    router.post('/book', verifyToken, (req, res) => bookAppointment(req, res, pool));
    router.get('/appointments/:hcp_id', verifyToken, (req, res) => getAppointmentsForDoctor(req, res, pool));
    router.get('/appointments/patient/:patient_id', verifyToken, (req, res) => getAppointmentsForPatient(req, res, pool));
    router.get('/appointment/:appointment_id', verifyToken, (req, res) => getAppointmentDetails(req, res, pool));
    router.get('/upcomingslots/:hcp_id', verifyToken,verifyDoctor, (req, res) =>     getUpcomingSlots(req, res, pool));
    router.patch('/appointments/:appointment_id/status', verifyToken, (req, res) => updateAppointmentStatus(req, res, pool));
    router.delete('/slots/:slot_id', (req, res) => deleteSlot(req, res, pool));
    
    router.get('/patientrecords/:hcp_id', (req, res) => getAllPatientRecords(req, res, pool));
    router.post('/slots/recurring', (req, res) => generateWeeklySlots(req, res, pool));
    
    return router;
};

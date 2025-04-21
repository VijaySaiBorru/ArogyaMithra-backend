// routes/roomRoutes.js
const express = require("express");
const { addRoom, updateRoom,getAvailableRooms,getAllRooms,deleteRoom } = require("../controllers/roomcontroller");
const {verifyToken} = require("../middleware/auth");

module.exports = (pool) => {
    const router = express.Router();
    router.post("/add", verifyToken, (req, res) => addRoom(req, res, pool));
    router.put("/update/:room_id", verifyToken, (req, res) => updateRoom(req, res, pool));
    router.get("/available", verifyToken, (req, res) => getAvailableRooms(req, res, pool));
    router.get("/", verifyToken, (req, res) => getAllRooms(req, res, pool));
    router.delete('/room-delete/:room_id', verifyToken, (req, res) =>deleteRoom(req, res, pool));
    
    return router;
};


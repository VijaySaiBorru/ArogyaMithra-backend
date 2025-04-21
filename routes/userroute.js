const express = require("express");
const { registerUser, loginUser,updateUser,deleteUser,getAllUsers,getUserImage,getAllDoctors,getAllHCPUsers,getAllFDOUsers,getAllDEOUsers } = require("../controllers/usercontroller");
const {verifyToken} = require("../middleware/auth");
module.exports = (pool) => {
    const router = express.Router();

    router.post("/register", (req, res) => registerUser(req, res, pool));
    router.post("/login", (req, res) => loginUser(req, res, pool)); // optional
    router.put("/update/:user_id", verifyToken, (req, res) => updateUser(req, res, pool));
    router.delete("/delete/:user_id", verifyToken, (req, res) => deleteUser(req, res, pool));
    router.get('/doctors', (req, res) => getAllDoctors(req, res, pool));
    router.get('/image/:id', (req, res) => getUserImage(req, res, pool));
    router.get('/users', (req, res) => getAllUsers(req, res, pool));
    router.get('/hcpusers', (req, res) => getAllHCPUsers(req, res, pool));
    router.get('/fdousers', (req, res) => getAllFDOUsers(req, res, pool));
    router.get('/deousers', (req, res) => getAllDEOUsers(req, res, pool));
    
    return router;
};

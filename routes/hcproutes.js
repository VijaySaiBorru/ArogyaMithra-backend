const express = require("express");
const { registerHCP,getAllHCPs,updateHCP,deleteHCP } = require("../controllers/hcpcontroller");

module.exports = (pool) => {
    const router = express.Router();

    router.get("/", (req, res) => getAllHCPs(req, res, pool));
    router.post("/register", (req, res) => registerHCP(req, res, pool));
    router.put("/:id", (req, res) => updateHCP(req, res, pool));    
    router.delete("/:id", (req, res) => deleteHCP(req, res, pool));
    return router;
};

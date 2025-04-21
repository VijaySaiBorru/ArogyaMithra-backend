const jwt = require("jsonwebtoken");

exports.verifyToken = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ error: "Unauthorized" });
    }
    const token = authHeader.split(" ")[1];
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET_KEY);
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(403).json({ error: "Invalid or expired token" });
    }
};
exports.verifyDoctor=(req, res, next)=>{
    if (req.user.role !== 'hcp') {
        return res.status(403).json({ error: 'Access denied: Only doctors allowed' });
    }
    next();
};
exports.verifyDataEntry = (req, res, next) => {
    if (req.user.role !== 'dataentry') {
        return res.status(403).json({ error: 'Access denied: Only data entry operators allowed' });
    }
    next();
};

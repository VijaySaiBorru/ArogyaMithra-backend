const express = require("express");
const initDB = require("./db");
const app = express();
const cors = require("cors");
require('dotenv').config();
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
const port = process.env.PORT || 3000;
console.log("User:", process.env.MY_SQL_USER);
console.log("Password:", process.env.MY_SQL_PASSWORD ? "set" : "not set");
const patientRoutes = require("./routes/patientroute");
const userRoutes = require("./routes/userroute");
const hcpRoutes = require("./routes/hcproutes");
const roomRoutes = require("./routes/roomroutes");
const admissionRoutes = require("./routes/admissionroutes");
const testRoutes = require("./routes/testroutes");
const appointmentRoutes = require('./routes/appointmentroutes');
const treatmentRoutes = require("./routes/treatmentroutes");
const startReminderJob = require("./jobs/Reminder"); // 👈 add this line
const sendreportstodoctors=require("./jobs/SendReports");

app.use(cors({
    origin: ['http://localhost:5173','https://arogya-mithra-frontend.vercel.app/'], // or whatever port your frontend runs on
    methods: ['GET', 'POST', 'PUT', 'DELETE','PATCH'],
    credentials: true
}));

initDB((err, pool) => {
    if (err) {
        console.error("DB init failed:", err);
        return;
    }
    console.log("🔁 Running initDB...");

    // Step 4: Test pool connection
    
    pool.getConnection((err, connection) => {
         if (err) {
            console.error("Error getting connection from pool:", err);
            return;
        }
        
        console.log("Connected to MySQL database via pool!");
        connection.release();

        // Now safe to start app and routes
        startApp(pool);
    });
});
// Function to start Express app
function startApp(pool) {
    app.get('/', (req, res) => {
        res.send("🏥 Welcome to the Hospital Data Management System 🏥");
    });
    startReminderJob(pool);
    sendreportstodoctors(pool);
    app.use("/api/patient", patientRoutes(pool));
    app.use("/api/user", userRoutes(pool));
    app.use("/api/hcp", hcpRoutes(pool));
    app.use("/api/room", roomRoutes(pool));
    app.use("/api/admission", admissionRoutes(pool));
    app.use("/api/test", testRoutes(pool));
    app.use("/api/appointment", appointmentRoutes(pool));
    app.use("/api/treatment", treatmentRoutes(pool));
    app.listen(port, () => {
        console.log(`🚀 Server is running at http://localhost:${port}`);
    });
}

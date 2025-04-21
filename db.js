const mysql = require("mysql2");
require('dotenv').config();

const initConnection = mysql.createConnection({
    host: process.env.MY_SQL_HOST,
    user: process.env.MY_SQL_USER,
    password: process.env.MY_SQL_PASSWORD
});

const dbName = process.env.MY_SQL_DATABASE;

function initDB(callback) {
    initConnection.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\``, (err) => {
        if (err) return callback(err, null);
        console.log(`✅ Database '${dbName}' is ready.`);

        const pool = mysql.createPool({
            host: process.env.MY_SQL_HOST,
            user: process.env.MY_SQL_USER,
            password: process.env.MY_SQL_PASSWORD,
            database: dbName,
            waitForConnections: true,
            connectionLimit: 10,
            queueLimit: 0
        });

        const connection = pool.promise();

        const tableQueries = [
            `CREATE TABLE IF NOT EXISTS patient (
                patient_id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(100),
                dob DATE,
                gender CHAR(1),
                contact VARCHAR(15),
                address VARCHAR(255),
                email VARCHAR(255) UNIQUE,
                username VARCHAR(255) UNIQUE,
                password VARCHAR(255) NOT NULL,
                insurance_id INT,
                bloodgroup ENUM('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'Unknown'),
                joined_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                medical_history MEDIUMTEXT
            )`,
            `CREATE TABLE IF NOT EXISTS users (
                user_id INT AUTO_INCREMENT PRIMARY KEY,
                username VARCHAR(50) UNIQUE NOT NULL,
                email VARCHAR(255) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                role ENUM('admin', 'hcp', 'frontdesk', 'dataentry') NOT NULL,
                name VARCHAR(100),
                image MEDIUMTEXT,
                salary DECIMAL(10, 2) DEFAULT 0,
                joined_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`,
            `CREATE TABLE IF NOT EXISTS health_care_professional (
                hcp_id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT UNIQUE, 
                designation ENUM('Doctor', 'Nurse', 'Junior Doctor', 'Therapist') NOT NULL,
                specialization VARCHAR(100),
                contact VARCHAR(15),
                FOREIGN KEY (user_id) REFERENCES users(user_id),
                about MEDIUMTEXT
            )`,
            `CREATE TABLE IF NOT EXISTS room (
                room_id INT AUTO_INCREMENT PRIMARY KEY,
                room_number VARCHAR(10) UNIQUE,
                type ENUM('Normal', 'ICU', 'General') NOT NULL,
                status ENUM('Available', 'Occupied', 'Partially Occupied') DEFAULT 'Available',
                charges_per_day DECIMAL(10,2) NOT NULL,
                capacity INT DEFAULT NULL,
                occupied_strength INT DEFAULT NULL
            )`,
            `CREATE TABLE IF NOT EXISTS admission (
                admission_id INT AUTO_INCREMENT PRIMARY KEY,
                patient_id INT,
                room_id INT,
                admit_date DATETIME,
                discharge_date DATETIME,
                total_fees DECIMAL(10,2) NOT NULL,
                fee_paid_details MEDIUMTEXT,
                remaining_fees DECIMAL(10,2) NOT NULL,
                FOREIGN KEY (patient_id) REFERENCES patient(patient_id),
                FOREIGN KEY (room_id) REFERENCES room(room_id)
            )`,
            `CREATE TABLE IF NOT EXISTS doctor_available_slots (
                slot_id INT AUTO_INCREMENT PRIMARY KEY,
                hcp_id INT NOT NULL,
                slot_date DATE NOT NULL,
                start_time TIME NOT NULL,
                end_time TIME NOT NULL,
                is_available BOOLEAN DEFAULT TRUE,
                appointment_fee DECIMAL(10,2) DEFAULT 100,
                FOREIGN KEY (hcp_id) REFERENCES health_care_professional(hcp_id),
                UNIQUE (hcp_id, slot_date, start_time)
            )`,            
            `CREATE TABLE IF NOT EXISTS appointment (
                appointment_id INT AUTO_INCREMENT PRIMARY KEY,
                date_time DATETIME NOT NULL,
                status ENUM('Scheduled', 'Completed', 'Cancelled', 'No-show', 'Rescheduled', 'Pending') DEFAULT 'Scheduled',
                priority ENUM('Emergency', 'Normal') DEFAULT 'Normal',
                patient_id INT,
                hcp_id INT,
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (patient_id) REFERENCES patient(patient_id),
                FOREIGN KEY (hcp_id) REFERENCES health_care_professional(hcp_id)
            )`,
            `CREATE TABLE IF NOT EXISTS booked_slots (
                booked_id INT AUTO_INCREMENT PRIMARY KEY,
                slot_id INT NOT NULL,
                date DATE NOT NULL,
                appointment_id INT NOT NULL,
                FOREIGN KEY (slot_id) REFERENCES doctor_available_slots(slot_id),
                FOREIGN KEY (appointment_id) REFERENCES appointment(appointment_id),
                UNIQUE (slot_id, date)
            )`,
            `CREATE TABLE IF NOT EXISTS test (
                test_id INT AUTO_INCREMENT PRIMARY KEY,
                test_name VARCHAR(100) UNIQUE NOT NULL,
                description TEXT,
                fee DECIMAL(10, 2) NOT NULL CHECK (fee >= 0),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`,
            `CREATE TABLE IF NOT EXISTS prescribed_test (
                prescribed_test_id INT AUTO_INCREMENT PRIMARY KEY,
                appointment_id INT NOT NULL,
                test_id INT NOT NULL,
                FOREIGN KEY (appointment_id) REFERENCES appointment(appointment_id),
                FOREIGN KEY (test_id) REFERENCES test(test_id)
            )`,
            `CREATE TABLE IF NOT EXISTS patient_test (
                patient_test_id INT AUTO_INCREMENT PRIMARY KEY,
                prescribed_test_id INT NOT NULL,
                result TEXT,
                test_date DATETIME,
                FOREIGN KEY (prescribed_test_id) REFERENCES prescribed_test(prescribed_test_id),
                file MEDIUMTEXT
            )`,
            `CREATE TABLE IF NOT EXISTS treatment (
                treatment_id INT AUTO_INCREMENT PRIMARY KEY,
                appointment_id INT NOT NULL,
                diagnosis TEXT,
                treatment_plan TEXT,
                treatment_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (appointment_id) REFERENCES appointment(appointment_id)
            )`,
            `CREATE TABLE IF NOT EXISTS treatment_medication (
                treatment_medication_id INT AUTO_INCREMENT PRIMARY KEY,
                treatment_id INT NOT NULL,
                medicine_name VARCHAR(100) NOT NULL,
                dosage VARCHAR(50),
                frequency VARCHAR(100),
                duration VARCHAR(100),
                FOREIGN KEY (treatment_id) REFERENCES treatment(treatment_id)
            )`
        ];

        (async () => {
            try {
                for (const query of tableQueries) {
                    await connection.query(query);
                }
                console.log("✅ All tables created successfully.");
                callback(null, pool);
            } catch (err) {
                console.error("❌ Error creating tables:", err);
                callback(err, null);
            }
        })();
    });
}

module.exports = initDB;

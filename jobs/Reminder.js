const cron = require("node-cron");
const SibApiV3Sdk = require("sib-api-v3-sdk");

// Brevo API setup
const defaultClient = SibApiV3Sdk.ApiClient.instance;
const apiKey = defaultClient.authentications["api-key"];
apiKey.apiKey = process.env.BREVO_API_KEY;
const transacApi = new SibApiV3Sdk.TransactionalEmailsApi();

function startReminderJob(pool) {
  const promisePool = pool.promise();
  
  cron.schedule("*/1 * * * *", async () => {
   // Current time in IST (since your DB stores IST)
    const now = new Date();
    
    // Target reminder window (2 hours from now)
    const targetTime = new Date(now.getTime() + (2 * 60 * 60 * 1000));
    
    // Format for database comparison (matches your stored format)
    const targetDateStr = targetTime.getFullYear() + '-' + 
                         String(targetTime.getMonth() + 1).padStart(2, '0') + '-' + 
                         String(targetTime.getDate()).padStart(2, '0');
    const targetTimeStr = String(targetTime.getHours()).padStart(2, '0') + ':' + 
                         String(targetTime.getMinutes()).padStart(2, '0') + ':00';
    try {
      const [appointments] = await promisePool.query(`
        SELECT a.appointment_id, a.date_time, p.name, p.email 
        FROM appointment a 
        JOIN patient p ON a.patient_id = p.patient_id
        WHERE DATE(a.date_time) = ?
          AND TIME(a.date_time) = ?
          AND a.status = 'Scheduled'
      `, [targetDateStr, targetTimeStr]);
      if (appointments.length === 0) {
        return;
      }

      console.log(`⏰ Found ${appointments.length} appointments to remind`);

      for (const appt of appointments) {
        // Format time for email in IST
        const appointmentTime = new Date(appt.date_time);
        const formattedTime = appointmentTime.toLocaleString('en-IN', {
          timeZone: 'Asia/Kolkata',
          hour: '2-digit',
          minute: '2-digit',
          day: '2-digit',
          month: 'short',
          year: 'numeric'
        });

        const email = {
          sender: { name: "Hospital", email: process.env.SENDER_EMAIL || "saicharanreddy19042004@gmail.com" },
          to: [{ email: appt.email, name: appt.name }],
          subject: "ArogyaMithra 🩺 Appointment Reminder",
          htmlContent: `
            <p>Dear ${appt.name},</p>
            <p>This is a reminder that your appointment is scheduled on <strong>${formattedTime}</strong>.</p>
            <p>Please arrive 10 minutes early. If you have any questions, contact us.</p>
            <p>Regards,<br/>Hospital Admin</p>
          `
        };

        await transacApi.sendTransacEmail(email);
        console.log(`✅ Reminder sent to ${appt.email} for ${formattedTime}`);
      }
    } catch (err) {
      console.error("❌ Error sending reminders:", err);
    }
  });
}

module.exports = startReminderJob;
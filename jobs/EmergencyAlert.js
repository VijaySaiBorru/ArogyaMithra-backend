const SibApiV3Sdk = require('sib-api-v3-sdk');

const defaultClient = SibApiV3Sdk.ApiClient.instance;
const apiKey = defaultClient.authentications['api-key'];
apiKey.apiKey = process.env.BREVO_API_KEY;
const apiInstance = new SibApiV3Sdk.TransactionalEmailsApi();

async function sendEmergencyAlertEmail(pool, appointmentId) {
  try {
    const query = `
      SELECT a.appointment_id, a.date_time, a.priority,a.notes as note,
             p.name AS patient_name, p.email AS patient_email,
             u.name AS doctor_name, u.email AS doctor_email
      FROM appointment a
      JOIN patient p ON a.patient_id = p.patient_id
      JOIN health_care_professional hcp ON a.hcp_id = hcp.hcp_id
      JOIN users u ON hcp.user_id = u.user_id
      WHERE a.appointment_id = ?
    `;

    const [results] = await new Promise((resolve, reject) => {
      pool.query(query, [appointmentId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });

    if (!results) return;

    const emailData = {
      sender: {
        name: 'ArogyaMithra',
        email: 'saicharanreddy19042004@gmail.com'
      },
      to: [{
        email: results.doctor_email,
        name: results.doctor_name
      }],
      subject: `🚨 Doctor Emergency Appointment Alert: ${results.patient_name}`,
      htmlContent: `
        <p><strong>🚨 Emergency Appointment Alert</strong></p>
        <p><strong>Patient Name:</strong> ${results.patient_name}</p>
        <p><strong>Notes:</strong> ${results.note ? results.note : 'N/A'}</p>
        <p><strong>Appointment Time:</strong> ${new Date(results.date_time).toLocaleString('en-IN')}</p>
        <p style="color: red;"><strong>This is an emergency appointment. Please prioritize accordingly.</strong></p>
      `
    };

    await apiInstance.sendTransacEmail(emailData);
    console.log(`🚨 Emergency alert sent to Dr. ${results.doctor_name}`);
  } catch (err) {
    console.error('❌ Error sending emergency alert:', err.message);
  }
}

module.exports = sendEmergencyAlertEmail;

const SibApiV3Sdk = require('sib-api-v3-sdk');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

// Initialize Brevo API client
const defaultClient = SibApiV3Sdk.ApiClient.instance;
const apiKey = defaultClient.authentications['api-key'];
apiKey.apiKey = process.env.BREVO_API_KEY;
const apiInstance = new SibApiV3Sdk.TransactionalEmailsApi();

// Function to get doctors with appointments in the last week
async function getDoctorsWithAppointments(pool) {
  const query = `
    SELECT DISTINCT u.user_id, u.name AS full_name, u.email
    FROM appointment a
    JOIN health_care_professional hcp ON a.hcp_id = hcp.hcp_id
    JOIN users u ON hcp.user_id = u.user_id
    WHERE a.date_time >= NOW() - INTERVAL 1 WEEK
  `;

  return new Promise((resolve, reject) => {
    pool.query(query, (err, results) => {
      if (err) reject(err);
      else resolve(results);
    });
  });
}

// Function to get patient reports for a specific doctor
async function getPatientReportsForDoctor(pool, doctorId) {
  const query = `
    SELECT p.patient_id,p.name AS patient_name, a.date_time, t.diagnosis, 
           t.treatment_plan, ts.test_name, pt.result AS test_result,
           pt.file AS file_path
    FROM appointment a
    JOIN patient p ON a.patient_id = p.patient_id
    LEFT JOIN treatment t ON a.appointment_id = t.appointment_id
    LEFT JOIN prescribed_test prt ON a.appointment_id = prt.appointment_id
    LEFT JOIN test ts ON prt.test_id = ts.test_id
    LEFT JOIN patient_test pt ON prt.prescribed_test_id = pt.prescribed_test_id
    JOIN health_care_professional hcp ON a.hcp_id = hcp.hcp_id
    WHERE hcp.user_id = ? AND a.date_time >= NOW() - INTERVAL 1 WEEK
  `;

  return new Promise((resolve, reject) => {
    pool.query(query, [doctorId], (err, results) => {
      if (err) reject(err);
      else resolve(results);
    });
  });
}

// Function to send email with PDF attachment
async function sendEmailWithReports(doctor, reports) {
  const attachments = [];

  // ➕ Add individual test files (base64 attachments)
  reports.forEach((report, idx) => {
    if (report.file_path) {
      const base64Content = report.file_path.includes('base64,')
        ? report.file_path.split('base64,')[1]
        : report.file_path;

      attachments.push({
        content: base64Content,
        name: `Patient_${report.patient_id}_${report.test_name}.pdf`
      });
    }
  });

  // Group reports by patient_id
  const reportsByPatient = reports.reduce((acc, report) => {
    if (!acc[report.patient_id]) {
      acc[report.patient_id] = {
        name: report.patient_name,
        diagnosis: report.diagnosis || 'N/A',
        treatment_plan: report.treatment_plan || 'N/A',
        tests: []
      };
    }
    if (report.test_name && report.test_result) {
      acc[report.patient_id].tests.push({
        test_name: report.test_name,
        test_result: report.test_result
      });
    }
    return acc;
  }, {});

  // Generate sections per patient
  const htmlTable = Object.entries(reportsByPatient).map(([patientId, data]) => {
    const testRows = data.tests.map(test => `
    <tr>
      <td style="border: 1px solid #ccc; padding: 8px;">${test.test_name}</td>
      <td style="border: 1px solid #ccc; padding: 8px;">${test.test_result}</td>
    </tr>
  `).join('');

    return `
    <h4>Patient ID: ${patientId} - ${data.name}</h4>
    <p><strong>Diagnosis:</strong> ${data.diagnosis}</p>
    <p><strong>Treatment Plan:</strong> ${data.treatment_plan}</p>
    <table style="border-collapse: collapse; width: 100%; margin-bottom: 20px;">
      <thead>
        <tr>
          <th style="border: 1px solid #ccc; padding: 8px;">Test Name</th>
          <th style="border: 1px solid #ccc; padding: 8px;">Test Result</th>
        </tr>
      </thead>
      <tbody>
        ${testRows}
      </tbody>
    </table>
  `;
  }).join('');



  const emailData = {
    sender: {
      name: 'ArogyaMithra',
      email: 'saicharanreddy19042004@gmail.com'
    },
    to: [{
      email: doctor.email, // You can replace this with doctor.email
      name: doctor.full_name
    }],
    subject: `Weekly Patient Reports - ${new Date().toLocaleDateString('en-IN')}`,
    htmlContent: `
      <p>Hi Dr. ${doctor.full_name},</p>
      <p>Please find below your weekly test result summary for patients, and attached individual test reports (if available):</p>
      ${htmlTable}
    `,
    attachment: attachments
  };

  try {
    const response = await apiInstance.sendTransacEmail(emailData);
    console.log(`✅ Email sent to Dr. ${doctor.full_name} (${doctor.email})`);
    return response;
  } catch (error) {
    console.error(`❌ Failed to send email to Dr. ${doctor.full_name}:`, error.response?.body || error.message);
    throw error;
  }
}



// Main function to process and send all reports
async function sendWeeklyReports(pool) {
  try {
    console.log('⏳ Starting weekly report generation...');

    const doctors = await getDoctorsWithAppointments(pool);

    if (doctors.length === 0) {
      console.log('ℹ️ No doctors with appointments found for the past week');
      return;
    }

    console.log(`📋 Found ${doctors.length} doctors to send reports to`);

    for (const doctor of doctors) {
      try {
        const reports = await getPatientReportsForDoctor(pool, doctor.user_id);

        if (reports.length === 0) {
          console.log(`ℹ️ No reports found for Dr. ${doctor.full_name}`);
          continue;
        }

        console.log(`📄 Found ${reports.length} reports for Dr. ${doctor.full_name}`);

        await sendEmailWithReports(doctor, reports);
      } catch (error) {
        console.error(`⚠️ Error processing reports for Dr. ${doctor.full_name}:`, error.message);
      }
    }

    console.log('✅ Weekly report generation completed');
  } catch (error) {
    console.error('❌ Error in weekly report generation:', error.message);
  }
}

// Schedule the weekly reports
function scheduleWeeklyReports(pool) {
  // cron.schedule('*/1 * * * *', () => sendWeeklyReports(pool));

  // Production:
    cron.schedule('0 9 * * 1', () => sendWeeklyReports(pool), {
      scheduled: true,
      timezone: 'Asia/Kolkata'
    }
  );

  console.log('⏰ Scheduled weekly reports to run every Monday at 9 AM IST');
}

module.exports = scheduleWeeklyReports;

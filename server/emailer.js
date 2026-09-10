const { Resend } = require('resend');

// Reads config lazily so a missing API key only fails at send time, not at boot.
function getResendClient() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error('RESEND_API_KEY is not set. See server/.env.example for setup instructions.');
  }
  return new Resend(apiKey);
}

async function sendWaiverEmail({ name, pdfBuffer, signedAt }) {
  const resend = getResendClient();
  const fromEmail = process.env.FROM_EMAIL || 'waiver@northumberlandfitness.com';
  const toEmail = process.env.TO_EMAIL || 'contact@northumberlandfitness.com';

  const result = await resend.emails.send({
    from: `Northumberland Fitness Waiver <${fromEmail}>`,
    to: toEmail,
    subject: `Signed Waiver: ${name} (${signedAt})`,
    text: `A liability waiver was signed at the front desk kiosk.\n\nName: ${name}\nSigned: ${signedAt}\n\nSee attached PDF for the full signed waiver.`,
    attachments: [
      {
        filename: `Waiver - ${name} - ${signedAt}.pdf`,
        content: pdfBuffer
      }
    ]
  });

  if (result.error) {
    throw new Error(result.error.message || 'Resend failed to send the waiver email.');
  }

  return result;
}

module.exports = { sendWaiverEmail };

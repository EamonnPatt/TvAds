require('dotenv').config();
const path = require('path');
const express = require('express');
const { generateWaiverPdf } = require('./pdfGenerator');
const { sendWaiverEmail } = require('./emailer');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' })); // signature image is a base64 data URL
app.use(express.static(path.join(__dirname, '..', 'public'), { setHeaders: (res) => res.set('Cache-Control', 'no-store') }));

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

app.post('/api/submit-waiver', async (req, res) => {
  const { name, company, phone, email, signatureDataUrl } = req.body || {};

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Name is required.' });
  }
  if (!phone || !phone.trim()) {
    return res.status(400).json({ error: 'Phone is required.' });
  }
  if (!email || !email.trim()) {
    return res.status(400).json({ error: 'Email is required.' });
  }
  if (!signatureDataUrl) {
    return res.status(400).json({ error: 'Signature is required.' });
  }

  const signedAt = new Date().toLocaleString('en-CA', {
    dateStyle: 'long',
    timeStyle: 'short'
  });

  try {
    const pdfBuffer = await generateWaiverPdf({
      name: name.trim(),
      company: (company || '').trim(),
      phone: phone.trim(),
      email: email.trim(),
      signatureDataUrl,
      signedAt
    });

    await sendWaiverEmail({ name: name.trim(), pdfBuffer, signedAt });

    res.json({ success: true });
  } catch (err) {
    console.error('Failed to process waiver submission:', err);
    res.status(500).json({ error: err.message || 'Something went wrong sending the waiver.' });
  }
});

app.listen(PORT, () => {
  console.log(`Waiver kiosk server running at http://localhost:${PORT}`);
});

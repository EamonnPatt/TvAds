const PDFDocument = require('pdfkit');
const { BUSINESS_NAME, LOCATION, TITLE, SECTIONS } = require('./waiverContent');

// Renders a filled-in, signed copy of the waiver as a PDF buffer.
function generateWaiverPdf({ name, company, phone, email, signatureDataUrl, signedAt }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 54 });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.font('Helvetica-Bold').fontSize(16).text(TITLE, { align: 'left' });
    doc.moveDown(0.5);
    doc.font('Helvetica-Bold').fontSize(10).text(`Location: `, { continued: true })
      .font('Helvetica').text(LOCATION, { continued: true })
      .font('Helvetica-Bold').text('   Business: ', { continued: true })
      .font('Helvetica').text(BUSINESS_NAME);
    doc.moveDown(1);

    SECTIONS.forEach((section) => {
      doc.font('Helvetica-Bold').fontSize(11).text(section.heading);
      doc.font('Helvetica').fontSize(10).text(section.body, { align: 'justify' });
      doc.moveDown(0.75);
    });

    doc.moveDown(0.5);
    doc.font('Helvetica-Bold').fontSize(12).text('Signature Section');
    doc.moveDown(0.5);

    doc.font('Helvetica-Bold').fontSize(10).text('Name: ', { continued: true })
      .font('Helvetica').text(name || '');
    doc.font('Helvetica-Bold').text('Company (if applicable): ', { continued: true })
      .font('Helvetica').text(company || '—');
    doc.font('Helvetica-Bold').text('Phone: ', { continued: true })
      .font('Helvetica').text(phone || '');
    doc.font('Helvetica-Bold').text('Email: ', { continued: true })
      .font('Helvetica').text(email || '');
    doc.font('Helvetica-Bold').text('Date: ', { continued: true })
      .font('Helvetica').text(signedAt || '');

    doc.moveDown(1);
    doc.font('Helvetica-Bold').fontSize(10).text('Signature:');
    doc.moveDown(0.3);

    if (signatureDataUrl) {
      const base64 = signatureDataUrl.replace(/^data:image\/\w+;base64,/, '');
      const imgBuffer = Buffer.from(base64, 'base64');
      const imgWidth = 260;
      const imgHeight = 100;
      doc.rect(doc.x, doc.y, imgWidth, imgHeight).stroke('#cccccc');
      doc.image(imgBuffer, doc.x, doc.y, { fit: [imgWidth, imgHeight] });
      doc.moveDown(imgHeight / doc.currentLineHeight() + 1);
    }

    doc.moveDown(0.5);
    doc.font('Helvetica-Oblique').fontSize(8).fillColor('#666666')
      .text(`Signed electronically via Northumberland Fitness waiver kiosk on ${signedAt}.`);

    doc.end();
  });
}

module.exports = { generateWaiverPdf };

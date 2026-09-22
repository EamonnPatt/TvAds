require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const store = require('./store');

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

app.use(express.json({ limit: '1mb' }));
app.use(express.static(PUBLIC_DIR, { setHeaders: (res) => res.set('Cache-Control', 'no-store') }));
// Uploaded files get unique names and never change, so the TV can cache them hard.
app.use('/media', express.static(store.UPLOAD_DIR, { immutable: true, maxAge: '30d' }));

app.get('/admin', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin.html')));

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

// ---------- Auth ----------
// A single shared password (ADMIN_PASSWORD). The token is derived from it, so
// changing the password logs every browser out.
function adminToken() {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) return null;
  return crypto.createHmac('sha256', password).update('gym-ad-screen-admin').digest('hex');
}

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

const failedLogins = new Map(); // ip -> { count, until }

app.post('/api/login', (req, res) => {
  const expected = adminToken();
  if (!expected) {
    return res.status(503).json({ error: 'ADMIN_PASSWORD is not set on the server. Add it to server/.env (or Render env vars) and restart.' });
  }
  const ip = req.ip;
  const entry = failedLogins.get(ip);
  if (entry && entry.until > Date.now()) {
    return res.status(429).json({ error: 'Too many attempts. Try again in a minute.' });
  }
  if (!safeEqual(req.body?.password || '', process.env.ADMIN_PASSWORD)) {
    const count = (entry?.count || 0) + 1;
    failedLogins.set(ip, { count, until: count >= 5 ? Date.now() + 60_000 : 0 });
    return res.status(401).json({ error: 'Wrong password.' });
  }
  failedLogins.delete(ip);
  res.json({ token: expected });
});

function requireAdmin(req, res, next) {
  const expected = adminToken();
  const given = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!expected || !safeEqual(given, expected)) {
    return res.status(401).json({ error: 'Not logged in.' });
  }
  next();
}

// ---------- Uploads ----------
const upload = multer({
  storage: multer.diskStorage({
    destination: store.UPLOAD_DIR,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 8);
      cb(null, `${crypto.randomUUID()}${ext}`);
    }
  }),
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /^(image|video)\//.test(file.mimetype);
    cb(ok ? null : new Error('Only image and video files can be uploaded.'), ok);
  }
});

// Admin forms send multipart: a JSON "data" field plus an optional "file".
function parseAdRequest(req) {
  let fields = {};
  try {
    fields = JSON.parse(req.body?.data || '{}');
  } catch {
    throw Object.assign(new Error('Invalid ad data.'), { status: 400 });
  }
  if (req.file) {
    fields.type = req.file.mimetype.startsWith('video/') ? 'video' : 'image';
  }
  return { fields, src: req.file ? `/media/${req.file.filename}` : null };
}

// ---------- Display (TV) ----------
app.get('/api/playlist', (req, res) => {
  const { ads, settings, updatedAt } = store.snapshot();
  // Date windows are checked on the TV itself, in the gym's local timezone.
  const publicAds = ads.filter((a) => a.enabled).map(({ notes, ...ad }) => ad); // notes are admin-only
  res.json({ ads: publicAds, settings, updatedAt });
});

let displayStatus = null; // what the TV last reported it was showing

app.post('/api/heartbeat', (req, res) => {
  displayStatus = {
    adId: typeof req.body?.adId === 'string' ? req.body.adId : null,
    title: typeof req.body?.title === 'string' ? req.body.title.slice(0, 120) : null,
    seenAt: Date.now()
  };
  res.json({ ok: true });
});

// ---------- Admin ----------
app.get('/api/admin/state', requireAdmin, (req, res) => {
  res.json({ ...store.snapshot(), display: displayStatus });
});

app.post('/api/admin/ads', requireAdmin, upload.single('file'), (req, res) => {
  const { fields, src } = parseAdRequest(req);
  if ((fields.type === 'image' || fields.type === 'video') && !src) {
    return res.status(400).json({ error: 'Choose an image or video file to upload.' });
  }
  res.json(store.create(fields, src));
});

app.put('/api/admin/ads/:id', requireAdmin, upload.single('file'), (req, res) => {
  const { fields, src } = parseAdRequest(req);
  const existing = store.snapshot().ads.find((a) => a.id === req.params.id);
  if (existing && !src && fields.type && fields.type !== 'text' && fields.type !== existing.type) {
    return res.status(400).json({ error: `Upload a ${fields.type} file to switch this ad to ${fields.type}.` });
  }
  const ad = store.update(req.params.id, fields, src);
  if (!ad) return res.status(404).json({ error: 'Ad not found.' });
  res.json(ad);
});

app.delete('/api/admin/ads/:id', requireAdmin, (req, res) => {
  if (!store.remove(req.params.id)) return res.status(404).json({ error: 'Ad not found.' });
  res.json({ ok: true });
});

app.put('/api/admin/order', requireAdmin, (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((id) => typeof id === 'string') : [];
  res.json(store.reorder(ids));
});

app.put('/api/admin/settings', requireAdmin, (req, res) => {
  res.json(store.updateSettings(req.body || {}));
});

app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') err = Object.assign(new Error('File is too large (max 500 MB).'), { status: 413 });
  if (!err.status) console.error(err);
  res.status(err.status || 400).json({ error: err.message || 'Something went wrong.' });
});

app.listen(PORT, () => {
  console.log(`Ad screen running at http://localhost:${PORT}  (admin panel: /admin)`);
  if (!process.env.ADMIN_PASSWORD) console.warn('ADMIN_PASSWORD is not set, so the admin panel is locked until you add it to server/.env.');
});

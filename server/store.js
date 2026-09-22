const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Everything the admin panel changes lives under DATA_DIR: ads.json plus the uploaded media.
// On a host with an ephemeral filesystem, point DATA_DIR at a persistent disk.
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'ads.json');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const DEFAULT_SETTINGS = {
  transition: 'fade', // 'fade' | 'slide' | 'none'
  idleTitle: 'Northumberland Fitness',
  idleSubtitle: 'Advertise your business here: ask at the front desk'
};

function load() {
  try {
    const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    return {
      ads: Array.isArray(db.ads) ? db.ads : [],
      settings: { ...DEFAULT_SETTINGS, ...(db.settings || {}) },
      updatedAt: db.updatedAt || Date.now()
    };
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('Could not read ads.json, starting empty:', err);
    return { ads: [], settings: { ...DEFAULT_SETTINGS }, updatedAt: Date.now() };
  }
}

let db = load();

function save() {
  db.updatedAt = Date.now();
  // Write-then-rename so a crash mid-write never leaves a half-written ads.json.
  const tmp = `${DB_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

const clampInt = (v, min, max, fallback) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const str = (v, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const date = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '');
const color = (v, fallback) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : fallback);

// Whitelists and normalizes the editable fields so the stored data is always well-formed.
function sanitize(input, existing = {}) {
  const merged = { ...existing, ...input };
  return {
    id: existing.id,
    type: ['image', 'video', 'text'].includes(merged.type) ? merged.type : 'text',
    title: str(merged.title, 120) || 'Untitled ad',
    src: existing.src || '',
    duration: clampInt(merged.duration, 3, 600, 15),
    playFullVideo: Boolean(merged.playFullVideo),
    videoLength: Math.max(0, Math.min(3600, Number(merged.videoLength) || 0)), // seconds, measured by the admin page
    muted: merged.muted === undefined ? true : Boolean(merged.muted),
    fit: merged.fit === 'contain' ? 'contain' : 'cover',
    background: color(merged.background, '#000000'),
    enabled: merged.enabled === undefined ? true : Boolean(merged.enabled),
    startDate: date(merged.startDate),
    endDate: date(merged.endDate),
    playsPerLoop: clampInt(merged.playsPerLoop, 1, 5, 1),
    headline: str(merged.headline, 200),
    body: str(merged.body, 600),
    footer: str(merged.footer, 200),
    textColor: color(merged.textColor, '#ffffff'),
    accentColor: color(merged.accentColor, '#5fa82a'),
    notes: str(merged.notes, 1000),
    createdAt: existing.createdAt || Date.now()
  };
}

function removeMediaFile(src) {
  if (!src || !src.startsWith('/media/')) return;
  const file = path.join(UPLOAD_DIR, path.basename(src));
  fs.rm(file, { force: true }, () => {});
}

module.exports = {
  UPLOAD_DIR,

  snapshot() {
    return db;
  },

  create(fields, src) {
    const ad = sanitize(fields, { id: crypto.randomUUID(), src });
    db.ads.push(ad);
    save();
    return ad;
  },

  update(id, fields, newSrc) {
    const idx = db.ads.findIndex((a) => a.id === id);
    if (idx === -1) return null;
    const existing = db.ads[idx];
    if (newSrc) {
      removeMediaFile(existing.src);
      existing.src = newSrc;
    }
    db.ads[idx] = sanitize(fields, existing);
    save();
    return db.ads[idx];
  },

  remove(id) {
    const ad = db.ads.find((a) => a.id === id);
    if (!ad) return false;
    db.ads = db.ads.filter((a) => a.id !== id);
    removeMediaFile(ad.src);
    save();
    return true;
  },

  reorder(ids) {
    const byId = new Map(db.ads.map((a) => [a.id, a]));
    const ordered = ids.map((id) => byId.get(id)).filter(Boolean);
    // Anything not mentioned keeps its place at the end rather than being dropped.
    const rest = db.ads.filter((a) => !ids.includes(a.id));
    db.ads = [...ordered, ...rest];
    save();
    return db.ads;
  },

  updateSettings(input) {
    db.settings = {
      transition: ['fade', 'slide', 'none'].includes(input.transition) ? input.transition : db.settings.transition,
      idleTitle: input.idleTitle !== undefined ? str(input.idleTitle, 120) : db.settings.idleTitle,
      idleSubtitle: input.idleSubtitle !== undefined ? str(input.idleSubtitle, 200) : db.settings.idleSubtitle
    };
    save();
    return db.settings;
  }
};

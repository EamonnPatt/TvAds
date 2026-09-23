const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Everything the admin panel changes lives under DATA_DIR: ads.json plus the uploaded media.
// On a host with an ephemeral filesystem, point DATA_DIR at a persistent disk.
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'ads.json');
// Ads committed to the repo. They show up in the admin panel like uploaded ads,
// but their files can only be changed in the repo.
const LOCAL_DIR = path.join(__dirname, '..', 'ads');
const LOCAL_TYPES = {
  '.mp4': 'video', '.webm': 'video', '.mov': 'video',
  '.jpg': 'image', '.jpeg': 'image', '.png': 'image', '.webp': 'image', '.gif': 'image'
};

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const DEFAULT_SETTINGS = {
  transition: 'fade', // 'fade' | 'slide' | 'none'
  idleTitle: 'Northumberland Fitness',
  idleSubtitle: 'Advertise your business here: ask at the front desk',
  useLocalAds: true, // play the ads in the repo's ads/ folder
  musicEnabled: true, // play musicUrl behind the ads, with every ad muted
  musicUrl: 'https://media-ssl.musicradio.com/Heart80sMP3' // Heart 80s radio stream
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

// Works out what the TV plays for a music link: the video and/or playlist id of
// a YouTube link (watch, youtu.be, embed, shorts, playlist), or any other web
// address as a radio stream. Returns null if it's neither.
function parseMusicLink(link) {
  const text = str(link, 500);
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (!url.hostname.includes('.')) return null;
  const host = url.hostname.replace(/^(www|m|music)\./, '');
  const videoIdOf = (v) => (/^[\w-]{11}$/.test(v || '') ? v : null);
  let videoId = null;
  if (host === 'youtu.be') videoId = videoIdOf(url.pathname.slice(1));
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    videoId = videoIdOf(url.searchParams.get('v')) || videoIdOf(url.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)/)?.[1]);
  } else return { stream: url.href };
  const list = /^[\w-]{2,64}$/.test(url.searchParams.get('list') || '') ? url.searchParams.get('list') : null;
  return videoId || list ? { videoId, list } : null;
}

function musicLink(v) {
  const link = str(v, 500);
  if (!parseMusicLink(link)) {
    throw Object.assign(new Error('That doesn’t look like a radio stream or YouTube link.'), { status: 400 });
  }
  return link;
}

// Whitelists and normalizes the editable fields so the stored data is always well-formed.
function sanitize(input, existing = {}) {
  const merged = { ...existing, ...input };
  return {
    id: existing.id,
    ...(existing.local ? { local: true, file: existing.file, mtime: existing.mtime } : {}),
    // A folder ad's file (and so its type) can only be changed in the repo.
    type: existing.local ? existing.type : ['image', 'video', 'text'].includes(merged.type) ? merged.type : 'text',
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

function localSrc(file, mtime) {
  return `/ads/${encodeURIComponent(file)}?v=${Math.round(mtime)}`;
}

// Brings the list in line with the ads/ folder: new files are added at the end,
// replaced files get a fresh URL, and removed files drop out.
function syncLocal() {
  let files = [];
  try {
    files = fs
      .readdirSync(LOCAL_DIR)
      .filter((name) => LOCAL_TYPES[path.extname(name).toLowerCase()])
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('Could not read the ads folder:', err);
  }
  let changed = false;

  const before = db.ads.length;
  db.ads = db.ads.filter((a) => !a.local || files.includes(a.file));
  if (db.ads.length !== before) changed = true;

  for (const file of files) {
    const mtime = fs.statSync(path.join(LOCAL_DIR, file)).mtimeMs;
    const ad = db.ads.find((a) => a.local && a.file === file);
    if (!ad) {
      const type = LOCAL_TYPES[path.extname(file).toLowerCase()];
      db.ads.push(
        sanitize(
          { type, title: path.parse(file).name, duration: 10, playFullVideo: type === 'video' },
          { id: `local-${file}`, local: true, file, mtime, type, src: localSrc(file, mtime) }
        )
      );
      changed = true;
    } else if (ad.mtime !== mtime) {
      ad.mtime = mtime;
      ad.src = localSrc(file, mtime);
      ad.videoLength = 0; // new file, length unknown until the admin page measures it
      changed = true;
    }
  }
  if (changed) save();
}

syncLocal();

module.exports = {
  UPLOAD_DIR,
  LOCAL_DIR,
  syncLocal,
  parseMusicLink,

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
    if (newSrc && !existing.local) {
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
      idleSubtitle: input.idleSubtitle !== undefined ? str(input.idleSubtitle, 200) : db.settings.idleSubtitle,
      useLocalAds: input.useLocalAds !== undefined ? Boolean(input.useLocalAds) : db.settings.useLocalAds,
      musicEnabled: input.musicEnabled !== undefined ? Boolean(input.musicEnabled) : db.settings.musicEnabled,
      musicUrl: input.musicUrl !== undefined ? musicLink(input.musicUrl) : db.settings.musicUrl
    };
    save();
    return db.settings;
  }
};

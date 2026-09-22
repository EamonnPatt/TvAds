// TV ad player. Loops through the active ads, picks up changes from the admin
// panel on its own, and never goes black between ads: the current ad stays up
// until the next one has loaded.

const POLL_MS = 30_000;
const LOAD_TIMEOUT_MS = 20_000;
const MAX_VIDEO_MS = 15 * 60_000; // safety net for "play full video" ads
const RELOAD_AFTER_MS = 12 * 60 * 60_000; // periodic fresh start for long-running TVs

const stage = document.getElementById('stage');
const idle = document.getElementById('idle');
const hint = document.getElementById('hint');

let playlist = null; // latest { ads, settings, updatedAt } from the server
let lastFetchOk = false;
let currentAd = null;
let currentLayer = null;
let pendingLayer = null; // next ad, still loading off-screen
let generation = 0; // bumps on every advance so stale timers/callbacks do nothing
let advanceTimer = null;
const bootedAt = Date.now();

// ---------- Server sync ----------
async function fetchPlaylist() {
  try {
    const res = await fetch('/api/playlist', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const changed = !playlist || data.updatedAt !== playlist.updatedAt;
    playlist = data;
    lastFetchOk = true;
    applySettings();
    // Start right away if nothing is on screen, or if the ad showing was just
    // removed/paused in the admin panel; otherwise changes apply at the next ad.
    if (changed && (!currentAd || !activeAds().some((a) => a.id === currentAd.id))) advance();
  } catch (err) {
    lastFetchOk = false;
    console.warn('Could not reach server, continuing with the last playlist:', err);
  }
}

function heartbeat() {
  fetch('/api/heartbeat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ adId: currentAd?.id || null, title: currentAd?.title || null })
  }).catch(() => {});
}

function applySettings() {
  const s = playlist.settings || {};
  document.body.classList.remove('t-fade', 't-slide', 't-none');
  document.body.classList.add(`t-${s.transition || 'fade'}`);
  document.getElementById('idle-title').textContent = s.idleTitle || '';
  document.getElementById('idle-subtitle').textContent = s.idleSubtitle || '';
}

// ---------- Playlist ----------
function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function activeAds() {
  const today = localToday();
  return (playlist?.ads || []).filter(
    (ad) => ad.enabled && (!ad.startDate || ad.startDate <= today) && (!ad.endDate || ad.endDate >= today)
  );
}

// Smooth weighted round-robin: every ad earns credit by its "plays per loop"
// and the richest plays next, so A(2×), B, C airs A B A C A B A C… A back-to-back
// repeat is avoided whenever another ad has earned a turn. With commit=false it
// only peeks (used for preloading).
const credit = new Map(); // ad id -> credit

function pickNext(ads, commit = true) {
  if (!ads.length) return null;
  const c = commit ? credit : new Map(credit);
  const total = ads.reduce((sum, ad) => sum + (ad.playsPerLoop || 1), 0);
  for (const id of c.keys()) if (!ads.some((ad) => ad.id === id)) c.delete(id);
  ads.forEach((ad) => c.set(ad.id, (c.get(ad.id) || 0) + (ad.playsPerLoop || 1)));

  const richest = (list) => list.reduce((best, ad) => (c.get(ad.id) > c.get(best.id) ? ad : best));
  let next = richest(ads);
  if (next.id === currentAd?.id && ads.length > 1) {
    const alt = richest(ads.filter((ad) => ad.id !== next.id));
    if (c.get(alt.id) > 0) next = alt;
  }
  c.set(next.id, c.get(next.id) - total);
  return next;
}

// ---------- Playback ----------
function advance() {
  clearTimeout(advanceTimer);
  const gen = ++generation;
  discardPending();

  if (Date.now() - bootedAt > RELOAD_AFTER_MS && lastFetchOk) {
    location.reload();
    return;
  }

  const next = pickNext(activeAds());
  if (!next) {
    showIdle();
    return;
  }
  load(next, gen);
}

function load(ad, gen) {
  const layer = document.createElement('div');
  layer.className = `layer fit-${ad.fit || 'cover'}`;
  layer.style.background = ad.background || '#000';

  let media = null;
  let settled = false;
  const ready = () => {
    if (settled || gen !== generation) return;
    settled = true;
    clearTimeout(loadTimeout);
    pendingLayer = null;
    reveal(ad, layer, media, gen);
  };
  const failed = (why) => {
    if (settled || gen !== generation) return;
    settled = true;
    clearTimeout(loadTimeout);
    console.warn(`Skipping "${ad.title}": ${why}`);
    discardPending();
    // Short pause so a playlist full of broken ads can't spin in a tight loop.
    advanceTimer = setTimeout(advance, 1000);
  };
  const loadTimeout = setTimeout(() => failed('took too long to load'), LOAD_TIMEOUT_MS);

  if (ad.type === 'image') {
    media = new Image();
    media.alt = ad.title;
    media.onload = ready;
    media.onerror = () => failed('image failed to load');
    media.src = ad.src;
    layer.appendChild(media);
  } else if (ad.type === 'video') {
    media = document.createElement('video');
    media.muted = true; // start muted so autoplay is always allowed; sound is enabled on reveal
    media.playsInline = true;
    media.preload = 'auto';
    media.addEventListener('canplay', ready, { once: true });
    media.addEventListener('error', () => failed('video failed to load'), { once: true });
    media.src = ad.src;
    layer.appendChild(media);
  } else {
    renderTextSlide(ad, layer);
  }

  layer.style.visibility = 'hidden';
  pendingLayer = layer;
  stage.appendChild(layer);
  if (ad.type === 'text') ready();
}

function discardPending() {
  if (!pendingLayer) return;
  const video = pendingLayer.querySelector('video');
  if (video) video.removeAttribute('src'); // stop downloading
  pendingLayer.remove();
  pendingLayer = null;
}

function reveal(ad, layer, media, gen) {
  idle.hidden = true;
  const previous = currentLayer;
  currentLayer = layer;
  currentAd = ad;

  layer.style.visibility = '';
  void layer.offsetWidth; // commit the starting position so the transition runs
  layer.classList.add('in');

  if (previous) {
    previous.classList.remove('in');
    previous.classList.add('out');
    const ms = document.body.classList.contains('t-none') ? 0 : 1000;
    setTimeout(() => {
      previous.querySelector('video')?.pause();
      previous.remove();
    }, ms);
  }

  if (ad.type === 'video') {
    media.currentTime = 0;
    playVideo(media, !ad.muted);
    if (ad.playFullVideo) {
      media.addEventListener('ended', () => gen === generation && advance(), { once: true });
      const lengthMs = Number.isFinite(media.duration) ? media.duration * 1000 + 3000 : MAX_VIDEO_MS;
      advanceTimer = setTimeout(advance, Math.min(lengthMs, MAX_VIDEO_MS));
    } else {
      media.loop = true; // a short clip fills its slot instead of freezing on the last frame
      advanceTimer = setTimeout(advance, ad.duration * 1000);
    }
  } else {
    advanceTimer = setTimeout(advance, ad.duration * 1000);
  }

  heartbeat();
  preloadNext();
}

async function playVideo(video, withSound) {
  video.muted = !withSound;
  try {
    await video.play();
  } catch {
    // Browsers block sound until someone clicks the page once; fall back to muted.
    video.muted = true;
    video.play().catch(() => {});
  }
}

// Warm the browser cache for the next image so it appears instantly.
function preloadNext() {
  const next = pickNext(activeAds(), false);
  if (next?.type === 'image') new Image().src = next.src;
}

function showIdle() {
  currentAd = null;
  idle.hidden = false;
  if (currentLayer) {
    currentLayer.querySelector('video')?.pause();
    currentLayer.remove();
    currentLayer = null;
  }
  heartbeat();
  // Check again shortly in case a scheduled ad starts today.
  advanceTimer = setTimeout(advance, 60_000);
}

function tickClock() {
  document.getElementById('idle-clock').textContent = new Date().toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit'
  });
}

// ---------- Fullscreen, cursor, screen wake ----------
let hideCursorTimer = null;
function onPointerActivity() {
  document.body.classList.remove('cursor-hidden');
  if (!document.fullscreenElement) hint.classList.add('show');
  clearTimeout(hideCursorTimer);
  hideCursorTimer = setTimeout(() => {
    document.body.classList.add('cursor-hidden');
    hint.classList.remove('show');
  }, 3000);
}

document.addEventListener('mousemove', onPointerActivity);
document.addEventListener('click', () => {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen?.().catch(() => {});
  }
  hint.classList.remove('show');
  // The click also unlocks sound for the video that's playing now.
  const video = currentLayer?.querySelector('video');
  if (video && currentAd && !currentAd.muted) video.muted = false;
});

let wakeLock = null;
async function keepScreenOn() {
  try {
    if ('wakeLock' in navigator && document.visibilityState === 'visible' && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => (wakeLock = null));
    }
  } catch {
    // Not supported or not allowed (needs https or localhost); the TV's own settings apply.
  }
}
document.addEventListener('visibilitychange', keepScreenOn);

// ---------- Start ----------
onPointerActivity();
keepScreenOn();
tickClock();
setInterval(tickClock, 10_000);
fetchPlaylist().then(() => {
  if (!playlist) showIdle();
});
setInterval(() => {
  fetchPlaylist();
  heartbeat();
}, POLL_MS);

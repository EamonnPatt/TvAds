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
    const res = await fetch('api.php?action=playlist', { cache: 'no-store' });
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
  const music = musicReport();
  lastMusicReport = JSON.stringify(music);
  fetch('api.php?action=heartbeat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ adId: currentAd?.id || null, title: currentAd?.title || null, music })
  }).catch(() => {});
}

function applySettings() {
  const s = playlist.settings || {};
  document.body.classList.remove('t-fade', 't-slide', 't-none');
  document.body.classList.add(`t-${s.transition || 'fade'}`);
  document.getElementById('idle-title').textContent = s.idleTitle || '';
  document.getElementById('idle-subtitle').textContent = s.idleSubtitle || '';
  syncMusic();
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
    playVideo(media, !ad.muted && !musicOn());
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

// ---------- Background music ----------
// While music is on in the admin panel, every ad is muted and the link plays
// behind the ads: a radio stream through the Web Audio API, or a YouTube link
// through a hidden YouTube player. Samsung TVs play one video or audio element
// at a time, so a YouTube player or an <audio> element takes turns with the
// video ads there (silent video, then a black screen with music). Web Audio
// doesn't go through the TV's media player, so streams play that way.
const SILENT_WAV =
  'data:audio/wav;base64,UklGRnQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YVAAAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==';
const MPEG_DECODER_URL = 'https://cdn.jsdelivr.net/npm/mpg123-decoder@1.0.3/dist/mpg123-decoder.min.js';
const musicBox = document.getElementById('music');
let musicKey = ''; // the link loaded now ('' = none)
let musicStream = null; // radio stream: { url, waitingForClick, connection }
let musicPlayer = null; // YouTube player
let musicReady = false; // the YouTube player is ready for commands
let musicError = null; // shown in the admin panel: YouTube's error code, 'stream' or 'format'
let musicSkips = 0; // playlist videos skipped in a row because they wouldn't play
let musicBlocked = false; // the browser refused YouTube sound even after a click
let lastMusicReport = '';

function musicOn() {
  return Boolean(playlist?.music);
}

// Runs on every playlist fetch, but only acts when music was turned on or off
// or the link changed.
function syncMusic() {
  const music = playlist.music;
  const key = music ? JSON.stringify(music) : '';
  if (key === musicKey) return;
  stopMusic();
  musicKey = key;
  if (music) {
    const video = currentLayer?.querySelector('video');
    if (video) video.muted = true; // the ad on screen goes quiet too
    if (music.stream) startStream(music.stream);
    else {
      loadYouTubeApi().then(
        () => key === musicKey && startYouTube(music),
        (err) => {
          console.warn(`No music: ${err.message}. Trying again at the next check.`);
          if (key === musicKey) musicKey = '';
        }
      );
    }
  }
  reportMusic();
}

function stopMusic() {
  if (musicStream) closeConnection(musicStream);
  musicStream = null;
  musicPlayer?.destroy();
  musicPlayer = null;
  musicReady = false;
  musicError = null;
  musicSkips = 0;
  musicBlocked = false;
  musicBox.replaceChildren();
}

// Called on every click on the page, which is what lets browsers play sound.
function unmuteMusic() {
  if (musicStream?.waitingForClick) connectStream(musicStream);
  else if (musicReady) unmuteYouTube();
}

// Safety net for a TV that runs all day: restart the music if it stopped.
function keepMusicPlaying() {
  if (musicStream) {
    // Reconnect if the stream has gone quiet: a dropped connection, the station
    // hanging up, or a link that didn't work last time.
    const conn = musicStream.connection;
    if (!musicStream.waitingForClick && (!conn || Date.now() - conn.lastDataAt > 20_000)) connectStream(musicStream);
    return;
  }
  if (!musicReady || musicError != null) return;
  const s = musicPlayer.getPlayerState();
  if (s === YT.PlayerState.PAUSED || s === YT.PlayerState.ENDED || s === YT.PlayerState.CUED) musicPlayer.playVideo();
}

// What the admin panel shows about the music.
function musicReport() {
  if (!musicOn()) return { state: 'off' };
  if (musicError != null) return { state: 'error', error: musicError };
  if (musicStream) {
    if (musicStream.waitingForClick) return { state: 'muted' };
    return { state: musicStream.connection?.playing ? 'playing' : 'loading' };
  }
  if (!musicReady) return { state: 'loading' };
  const title = musicPlayer.getVideoData?.()?.title || null;
  if (musicPlayer.isMuted()) return { state: musicBlocked ? 'blocked' : 'muted', title };
  const s = musicPlayer.getPlayerState();
  return { state: s === YT.PlayerState.PLAYING || s === YT.PlayerState.BUFFERING ? 'playing' : 'loading', title };
}

function reportMusic() {
  if (JSON.stringify(musicReport()) !== lastMusicReport) heartbeat();
}

// ----- Radio stream -----
// The stream is fetched and decoded here (MP3, by a WebAssembly decoder in a
// worker), and the decoded pieces are queued back to back in Web Audio. The
// station has to allow other sites to fetch it (CORS); most do.
let audioContext = null;
let mpegDecoder = null;

function startStream(url) {
  musicStream = { url, waitingForClick: false, connection: null };
  connectStream(musicStream);
}

async function connectStream(stream) {
  if (stream.connection) closeConnection(stream);
  const conn = { controller: new AbortController(), lastDataAt: Date.now(), playhead: 0, playing: false, output: null, decoder: null };
  stream.connection = conn;
  const current = () => stream === musicStream && stream.connection === conn;

  // Browsers hold sound back until someone clicks the page. Until then, don't
  // connect at all; the click (unmuteMusic) comes back here.
  const ctx = await runningAudioContext();
  if (!current()) return;
  stream.waitingForClick = !ctx;
  reportMusic();
  if (!ctx) return;

  try {
    const [res, Decoder] = await Promise.all([
      fetch(stream.url, { cache: 'no-store', signal: conn.controller.signal }),
      loadMpegDecoder()
    ]);
    if (!current()) return;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (!/mpeg|mp3|octet-stream/i.test(res.headers.get('content-type') || '')) {
      conn.controller.abort();
      musicError = 'format';
      reportMusic();
      return;
    }
    conn.decoder = new Decoder();
    await conn.decoder.ready;
    if (!current()) return;
    conn.output = ctx.createGain(); // disconnecting this silences whatever is still queued
    conn.output.connect(ctx.destination);

    const reader = res.body.getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      conn.lastDataAt = Date.now();
      conn.decoder
        .decode(value)
        .then((audio) => current() && queueAudio(conn, audio))
        .catch(() => {});
    }
    throw new Error('the station ended the stream');
  } catch (err) {
    if (!current()) return;
    console.warn(`Music stream: ${err.message}. Reconnecting at the next check.`);
    musicError = 'stream';
    reportMusic();
  }
}

function closeConnection(stream) {
  const conn = stream.connection;
  stream.connection = null;
  conn.controller.abort();
  conn.output?.disconnect();
  conn.decoder?.free();
}

function queueAudio(conn, { channelData, samplesDecoded, sampleRate }) {
  if (!samplesDecoded || audioContext.state !== 'running') return;
  const buffer = audioContext.createBuffer(channelData.length, samplesDecoded, sampleRate);
  channelData.forEach((samples, i) => buffer.getChannelData(i).set(samples));
  const source = audioContext.createBufferSource();
  source.buffer = buffer;
  source.connect(conn.output);
  // Start a second ahead so network hiccups don't cause gaps (and again after
  // any gap), then play the pieces back to back.
  if (conn.playhead < audioContext.currentTime) conn.playhead = audioContext.currentTime + 1;
  source.start(conn.playhead);
  conn.playhead += buffer.duration;
  if (!conn.playing) {
    conn.playing = true;
    musicError = null;
    reportMusic();
  }
}

// The page's AudioContext once it's allowed to run, or null while the browser
// is still holding sound back.
async function runningAudioContext() {
  if (!audioContext) {
    const Context = window.AudioContext || window.webkitAudioContext;
    try {
      // Most streams are 44.1 kHz; matching it means the pieces join up exactly.
      audioContext = new Context({ sampleRate: 44100 });
    } catch {
      audioContext = new Context();
    }
  }
  if (audioContext.state !== 'running') {
    await Promise.race([audioContext.resume().catch(() => {}), new Promise((r) => setTimeout(r, 500))]);
  }
  return audioContext.state === 'running' ? audioContext : null;
}

function loadMpegDecoder() {
  if (!mpegDecoder) {
    mpegDecoder = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = MPEG_DECODER_URL;
      script.onload = () => resolve(window['mpg123-decoder'].MPEGDecoderWebWorker);
      script.onerror = () => {
        mpegDecoder = null;
        script.remove();
        reject(new Error('the MP3 decoder failed to load'));
      };
      document.head.appendChild(script);
    });
  }
  return mpegDecoder;
}

// ----- YouTube -----
let youTubeApi = null;
function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve();
  if (!youTubeApi) {
    youTubeApi = new Promise((resolve, reject) => {
      window.onYouTubeIframeAPIReady = resolve;
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.onerror = () => {
        youTubeApi = null;
        script.remove();
        reject(new Error('the YouTube player failed to load'));
      };
      document.head.appendChild(script);
    });
  }
  return youTubeApi;
}

function startYouTube({ videoId, list }) {
  const holder = document.createElement('div'); // the player swaps this for its iframe
  musicBox.replaceChildren(holder);
  const player = new YT.Player(holder, {
    width: 200,
    height: 200,
    ...(videoId ? { videoId } : {}),
    playerVars: {
      controls: 0,
      disablekb: 1,
      playsinline: 1,
      loop: 1,
      origin: location.origin,
      // A single video only loops when it's also given as its own playlist.
      ...(list ? { listType: 'playlist', list } : { playlist: videoId })
    },
    events: {
      onReady: async () => {
        if (player !== musicPlayer) return;
        // Browsers hold sound back until someone clicks the page. Until then the
        // music plays muted, so that click only has to unmute it.
        const withSound = await canPlaySound();
        if (player !== musicPlayer) return;
        musicReady = true;
        player.setLoop(true);
        if (withSound) player.unMute();
        else player.mute();
        player.playVideo();
        reportMusic();
      },
      onStateChange: (e) => {
        if (player !== musicPlayer) return;
        if (e.data === YT.PlayerState.PLAYING) {
          musicSkips = 0;
          musicError = null;
        }
        reportMusic();
      },
      onError: (e) => {
        if (player !== musicPlayer) return;
        // Skip a playlist video that won't play, but don't keep skipping forever.
        if (list && ++musicSkips < 5) {
          player.nextVideo();
          return;
        }
        musicError = e.data;
        reportMusic();
      }
    }
  });
  musicPlayer = player;
}

async function canPlaySound() {
  try {
    await new Audio(SILENT_WAV).play();
    return true;
  } catch {
    return false;
  }
}

function unmuteYouTube() {
  const player = musicPlayer;
  player.unMute();
  player.playVideo();
  // Some browsers still won't let the YouTube player make sound after a click
  // on the page. Keep the music going muted and say so in the admin panel.
  setTimeout(() => {
    if (player !== musicPlayer) return;
    const s = player.getPlayerState();
    musicBlocked = s !== YT.PlayerState.PLAYING && s !== YT.PlayerState.BUFFERING;
    if (musicBlocked) {
      player.mute();
      player.playVideo();
    }
    reportMusic();
  }, 3000);
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
  // The click also unlocks sound for the music, or for the video playing now.
  const video = currentLayer?.querySelector('video');
  if (video && currentAd && !currentAd.muted && !musicOn()) video.muted = false;
  unmuteMusic();
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
  keepMusicPlaying();
  heartbeat();
}, POLL_MS);

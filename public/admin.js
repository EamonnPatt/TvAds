// Admin panel: log in, manage the ad rotation, and see what the TV is showing.

const TOKEN_KEY = 'adScreenToken';
const REFRESH_MS = 15_000;
const TV_ONLINE_MS = 75_000; // the TV checks in every 30s

const $ = (sel, root = document) => root.querySelector(sel);

let state = { ads: [], settings: {}, display: null };
let editing = null; // ad being edited, or null for a new one
let previewUrl = null; // object URL for a freshly picked file
let videoLength = 0; // seconds, measured from the picked (or existing) video
let refreshTimer = null;
let dragging = false;

// ---------- API ----------
function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Private browsing etc.: stays logged in only until the page reloads.
  }
  memoryToken = token;
}
let memoryToken = getToken();

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: {
      Authorization: `Bearer ${memoryToken || ''}`,
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    showLogin();
    throw new Error(data.error || 'Not logged in.');
  }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// Ads go up as multipart (for the file) via XHR so we can show upload progress.
function sendAd(method, path, fields, file, onProgress) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('data', JSON.stringify(fields));
    if (file) form.append('file', file);

    const xhr = new XMLHttpRequest();
    xhr.open(method, path);
    xhr.setRequestHeader('Authorization', `Bearer ${memoryToken || ''}`);
    if (onProgress) xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let data = {};
      try {
        data = JSON.parse(xhr.responseText);
      } catch {}
      if (xhr.status === 401) showLogin();
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error(data.error || `Save failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error('Network error. Check the connection and try again.'));
    xhr.send(form);
  });
}

// ---------- Login ----------
function showLogin(message = '') {
  clearInterval(refreshTimer);
  setToken(null);
  $('#editor').open && $('#editor').close();
  $('#app-view').hidden = true;
  $('#login-view').hidden = false;
  $('#login-error').textContent = message;
  $('#login-password').focus();
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#login-error').textContent = '';
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: $('#login-password').value })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Login failed.');
    setToken(data.token);
    $('#login-password').value = '';
    start();
  } catch (err) {
    $('#login-error').textContent = err.message;
  }
});

$('#logout').addEventListener('click', () => showLogin());

async function start() {
  try {
    await refresh();
  } catch (err) {
    // A 401 already switched to the login screen; anything else (server down) is shown there too.
    if ($('#login-view').hidden) {
      $('#login-view').hidden = false;
      $('#login-error').textContent = err.message;
    }
    return;
  }
  $('#login-view').hidden = true;
  $('#app-view').hidden = false;
  clearInterval(refreshTimer);
  refreshTimer = setInterval(() => !dragging && refresh().catch(() => {}), REFRESH_MS);
}

async function refresh() {
  state = await api('/api/admin/state');
  render();
}

// ---------- Helpers ----------
function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function statusOf(ad) {
  const today = localToday();
  if (!ad.enabled) return { key: 'paused', label: 'Paused' };
  if (ad.startDate && ad.startDate > today) return { key: 'scheduled', label: `Starts ${fmtDate(ad.startDate)}` };
  if (ad.endDate && ad.endDate < today) return { key: 'expired', label: 'Ended' };
  return { key: 'live', label: 'Live' };
}

function fmtDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtDuration(totalSec) {
  const s = Math.round(totalSec);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return rest ? `${m}m ${rest}s` : `${m}m`;
}

function fmtAgo(ms) {
  const sec = Math.round((Date.now() - ms) / 1000);
  if (sec < 90) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `${hr} hr ago`;
  return new Date(ms).toLocaleDateString();
}

// Seconds an ad occupies the screen each time it plays (null if unknown).
function slotLength(ad) {
  if (ad.type === 'video' && ad.playFullVideo) return ad.videoLength || null;
  return ad.duration;
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) node.setAttribute(k, v === true ? '' : v);
  }
  // The muted attribute alone doesn't mute a video created from script, and unmuted videos won't autoplay.
  if (attrs.muted) node.muted = true;
  for (const c of children.flat()) if (c != null && c !== false) node.append(c);
  return node;
}

function trashIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML =
    '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
  return svg;
}

function toast(message) {
  const t = el('div', { class: 'toast', role: 'status' }, message);
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}

function thumbFor(ad) {
  const box = el('div', { class: 'thumb' });
  if (ad.type === 'image') box.append(el('img', { src: ad.src, alt: '', loading: 'lazy' }));
  else if (ad.type === 'video') box.append(el('video', { src: `${ad.src}#t=1`, muted: true, preload: 'metadata' }));
  else box.append(renderTextSlide(ad));
  return box;
}

// ---------- Render ----------
function tvIsOnline() {
  return state.display && Date.now() - state.display.seenAt < TV_ONLINE_MS;
}

let listKey = '';
function render() {
  renderTvStatus();
  renderSummary();
  // Rebuilding the list reloads every thumbnail, so only do it when something shown there changed.
  const key = JSON.stringify([state.ads, tvIsOnline() ? state.display.adId : null, localToday()]);
  if (key !== listKey) {
    listKey = key;
    renderList();
  }
  renderSettings();
}

function renderTvStatus() {
  const box = $('#tv-status');
  const d = state.display;
  let cls = '';
  let text = 'TV hasn’t connected since the server started';
  if (d && tvIsOnline()) {
    cls = 'online';
    text = d.title ? `TV on · showing “${d.title}”` : 'TV on · no ads running';
  } else if (d) {
    cls = 'offline';
    text = `TV offline · last seen ${fmtAgo(d.seenAt)}`;
  }
  box.className = `tv-status ${cls}`;
  box.replaceChildren(el('span', { class: 'dot' }), el('span', { class: 'label' }, text));
}

function renderSummary() {
  const live = state.ads.filter((a) => statusOf(a).key === 'live');
  const upcoming = state.ads.filter((a) => statusOf(a).key === 'scheduled');
  let loop = 0;
  let unknown = false;
  for (const ad of live) {
    const len = slotLength(ad);
    if (len == null) unknown = true;
    else loop += len * (ad.playsPerLoop || 1);
  }
  const stat = (value, label) => el('div', { class: 'stat' }, el('div', { class: 'value' }, value), el('div', { class: 'label' }, label));
  $('#summary').replaceChildren(
    stat(String(live.length), live.length === 1 ? 'ad playing now' : 'ads playing now'),
    stat(live.length ? `${fmtDuration(loop)}${unknown ? '+' : ''}` : '—', 'full loop length'),
    stat(live.length && !unknown ? `${Math.floor((60 * 60) / Math.max(loop, 1))}×` : '—', 'loops per hour'),
    stat(String(upcoming.length), 'scheduled to start later')
  );
}

function renderList() {
  const list = $('#spot-list');
  $('#empty').hidden = state.ads.length > 0;
  const onScreenId = tvIsOnline() ? state.display.adId : null;

  list.replaceChildren(
    ...state.ads.map((ad, i) => {
      const status = statusOf(ad);
      const len = slotLength(ad);
      const meta = [
        ad.type === 'text' ? 'Text slide' : ad.type === 'video' ? 'Video' : 'Image',
        ad.type === 'video' && ad.playFullVideo ? `Full video${len ? ` (${fmtDuration(len)})` : ''}` : fmtDuration(ad.duration),
        ad.playsPerLoop > 1 ? `${ad.playsPerLoop}× per loop` : null,
        ad.startDate || ad.endDate
          ? `${ad.startDate ? fmtDate(ad.startDate) : 'Now'} → ${ad.endDate ? fmtDate(ad.endDate) : 'no end'}`
          : null,
        ad.type === 'video' && !ad.muted ? 'Sound on' : null
      ].filter(Boolean);

      const toggle = el(
        'label',
        { class: 'switch', title: ad.enabled ? 'Pause this ad' : 'Resume this ad' },
        el('input', {
          type: 'checkbox',
          checked: ad.enabled,
          'aria-label': `${ad.title} active`,
          onchange: (e) => quickUpdate(ad, { enabled: e.target.checked })
        }),
        el('span', { class: 'track' })
      );

      return el(
        'li',
        { class: `spot-row ${ad.enabled ? '' : 'paused'}`, 'data-id': ad.id },
        el('span', { class: 'handle', title: 'Drag to reorder', 'aria-hidden': 'true', onpointerdown: startDrag }, '⠿'),
        thumbFor(ad),
        el(
          'div',
          { class: 'spot-info' },
          el(
            'div',
            { class: 'spot-title' },
            ad.title,
            el('span', { class: `badge ${status.key}` }, status.label),
            ad.id === onScreenId ? el('span', { class: 'badge onscreen' }, 'On screen now') : null
          ),
          el('div', { class: 'spot-meta' }, meta.map((m) => el('span', {}, m))),
          ad.notes ? el('div', { class: 'spot-notes', title: ad.notes }, ad.notes) : null
        ),
        el(
          'div',
          { class: 'spot-actions' },
          el('button', { type: 'button', class: 'icon-btn', title: 'Move up', 'aria-label': 'Move up', disabled: i === 0, onclick: () => move(ad.id, -1) }, '↑'),
          el('button', { type: 'button', class: 'icon-btn', title: 'Move down', 'aria-label': 'Move down', disabled: i === state.ads.length - 1, onclick: () => move(ad.id, 1) }, '↓'),
          toggle,
          el('button', { type: 'button', class: 'icon-btn', onclick: () => openEditor(ad) }, 'Edit'),
          el('button', { type: 'button', class: 'icon-btn danger', title: 'Delete', 'aria-label': `Delete ${ad.title}`, onclick: () => deleteAd(ad) }, trashIcon())
        )
      );
    })
  );
}

function renderSettings() {
  const form = $('#settings-form');
  // Don't clobber what the user is typing during a background refresh.
  if (form.contains(document.activeElement)) return;
  form.transition.value = state.settings.transition || 'fade';
  form.idleTitle.value = state.settings.idleTitle || '';
  form.idleSubtitle.value = state.settings.idleSubtitle || '';
}

// ---------- List actions ----------
async function quickUpdate(ad, fields) {
  try {
    await sendAd('PUT', `/api/admin/spots/${ad.id}`, fields);
    await refresh();
  } catch (err) {
    toast(err.message);
    listKey = '';
    render();
  }
}

async function deleteAd(ad) {
  if (!confirm(`Delete “${ad.title}”? This removes it from the TV and deletes its file.`)) return;
  try {
    await api(`/api/admin/spots/${ad.id}`, { method: 'DELETE' });
    toast('Ad deleted');
    await refresh();
  } catch (err) {
    toast(err.message);
  }
}

async function saveOrder(ids) {
  try {
    state.ads = await api('/api/admin/order', { method: 'PUT', body: { ids } });
    render();
  } catch (err) {
    toast(err.message);
    refresh().catch(() => {});
  }
}

function move(id, delta) {
  const ids = state.ads.map((a) => a.id);
  const i = ids.indexOf(id);
  const j = i + delta;
  if (j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  saveOrder(ids);
}

// Pointer-based dragging so it works with a mouse, touch screen, or iPad alike.
function startDrag(e) {
  const row = e.target.closest('.spot-row');
  if (!row) return;
  e.preventDefault();
  dragging = true;
  row.classList.add('dragging');
  let target = null;
  let after = false;

  const onMove = (ev) => {
    document.querySelectorAll('.drop-before, .drop-after').forEach((r) => r.classList.remove('drop-before', 'drop-after'));
    const over = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.spot-row');
    if (!over || over === row) {
      target = null;
      return;
    }
    const rect = over.getBoundingClientRect();
    after = ev.clientY > rect.top + rect.height / 2;
    target = over;
    over.classList.add(after ? 'drop-after' : 'drop-before');
  };

  const onUp = () => {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onUp);
    document.querySelectorAll('.drop-before, .drop-after').forEach((r) => r.classList.remove('drop-before', 'drop-after'));
    row.classList.remove('dragging');
    dragging = false;
    if (!target) return;

    const ids = state.ads.map((a) => a.id).filter((id) => id !== row.dataset.id);
    const at = ids.indexOf(target.dataset.id) + (after ? 1 : 0);
    ids.splice(at, 0, row.dataset.id);
    saveOrder(ids);
  };

  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
  document.addEventListener('pointercancel', onUp);
}

// ---------- Editor ----------
const editor = $('#editor');
const form = $('#spot-form');
const fileInput = $('#file-input');

function currentType() {
  return form.querySelector('input[name="type"]:checked').value;
}

function openEditor(ad = null) {
  editing = ad;
  form.reset();
  clearPreviewUrl();
  $('#editor-error').textContent = '';
  $('#upload-progress').hidden = true;
  $('#editor-title').textContent = ad ? `Edit “${ad.title}”` : 'New ad';

  const a = ad || {};
  form.title.value = a.title || '';
  form.querySelector(`input[name="type"][value="${a.type || 'image'}"]`).checked = true;
  form.headline.value = a.headline || '';
  form.body.value = a.body || '';
  form.footer.value = a.footer || '';
  form.textBackground.value = a.type === 'text' ? a.background : '#123a6b';
  form.textColor.value = a.textColor || '#ffffff';
  form.accentColor.value = a.accentColor || '#5fa82a';
  form.mediaBackground.value = a.type !== 'text' && a.background ? a.background : '#000000';
  form.duration.value = a.duration || 15;
  form.playFullVideo.checked = Boolean(a.playFullVideo);
  form.playsPerLoop.value = String(a.playsPerLoop || 1);
  form.startDate.value = a.startDate || '';
  form.endDate.value = a.endDate || '';
  form.fit.value = a.fit || 'cover';
  form.sound.checked = a.type === 'video' && a.muted === false;
  form.enabled.checked = a.enabled !== false;
  form.notes.value = a.notes || '';
  videoLength = a.videoLength || 0;

  syncEditor();
  editor.showModal();
  form.title.focus();
}

function clearPreviewUrl() {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
}

// Shows/hides fields for the chosen type and redraws the preview.
function syncEditor() {
  const type = currentType();
  form.querySelectorAll('[data-show]').forEach((node) => {
    node.hidden = !node.dataset.show.split(' ').includes(type);
  });

  if (type !== 'text') {
    fileInput.accept = `${type}/*`;
    const sameTypeFile = editing && editing.type === type;
    $('#file-label').textContent = `${type === 'video' ? 'Video' : 'Image'} file${sameTypeFile ? ' (leave empty to keep the current one)' : ''}`;
  }

  const fullVideo = type === 'video' && form.playFullVideo.checked;
  $('#duration-field').classList.toggle('disabled', fullVideo);

  renderPreview();
}

function renderPreview() {
  const box = $('#preview');
  const type = currentType();
  box.className = `preview fit-${form.fit.value}`;
  box.style.background = '';
  box.replaceChildren();

  if (type === 'text') {
    box.append(renderTextSlide(textFields()));
    return;
  }

  const src = previewUrl || (editing && editing.type === type ? editing.src : null);
  box.style.background = form.mediaBackground.value;
  if (!src) {
    box.append(`Choose ${type === 'video' ? 'a video' : 'an image'} to preview it here`);
  } else if (type === 'image') {
    box.append(el('img', { src, alt: '' }));
  } else {
    box.append(el('video', { src, muted: true, autoplay: true, loop: true, playsinline: true }));
  }
}

function textFields() {
  return {
    title: form.title.value.trim(),
    headline: form.headline.value.trim(),
    body: form.body.value.trim(),
    footer: form.footer.value.trim(),
    background: form.textBackground.value,
    textColor: form.textColor.value,
    accentColor: form.accentColor.value
  };
}

form.addEventListener('input', (e) => {
  if (e.target === fileInput) return;
  syncEditor();
});
form.addEventListener('change', (e) => {
  if (e.target.name === 'type') {
    // A file picked for one type doesn't carry over to another.
    fileInput.value = '';
    clearPreviewUrl();
  }
  syncEditor();
});

fileInput.addEventListener('change', () => {
  clearPreviewUrl();
  const file = fileInput.files[0];
  if (!file) return syncEditor();
  previewUrl = URL.createObjectURL(file);

  if (file.type.startsWith('video/')) {
    // Measure the clip so "play whole video" ads count correctly in the loop length.
    const probe = document.createElement('video');
    probe.preload = 'metadata';
    probe.onloadedmetadata = () => {
      if (Number.isFinite(probe.duration)) videoLength = Math.round(probe.duration);
    };
    probe.src = previewUrl;
  }
  if (!form.title.value.trim()) {
    form.title.value = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
  }
  syncEditor();
});

$('#duration-chips').addEventListener('click', (e) => {
  const sec = e.target.dataset?.sec;
  if (!sec) return;
  form.duration.value = sec;
  syncEditor();
});

editor.querySelectorAll('[data-close]').forEach((btn) => btn.addEventListener('click', () => editor.close()));
editor.addEventListener('close', () => {
  clearPreviewUrl();
  $('#preview').replaceChildren(); // stop any preview video
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const type = currentType();
  const file = fileInput.files[0] || null;
  const errorBox = $('#editor-error');
  errorBox.textContent = '';

  if (type !== 'text' && !file && !(editing && editing.type === type)) {
    errorBox.textContent = `Choose ${type === 'video' ? 'a video' : 'an image'} file.`;
    return;
  }
  if (type === 'text' && !form.headline.value.trim()) {
    errorBox.textContent = 'Add a headline for the text slide.';
    form.headline.focus();
    return;
  }
  if (form.startDate.value && form.endDate.value && form.endDate.value < form.startDate.value) {
    errorBox.textContent = 'The end date is before the start date.';
    return;
  }

  const fields = {
    title: form.title.value.trim(),
    type,
    duration: Number(form.duration.value),
    playFullVideo: type === 'video' && form.playFullVideo.checked,
    videoLength: type === 'video' ? videoLength : 0,
    playsPerLoop: Number(form.playsPerLoop.value),
    startDate: form.startDate.value,
    endDate: form.endDate.value,
    fit: form.fit.value,
    muted: !(type === 'video' && form.sound.checked),
    enabled: form.enabled.checked,
    notes: form.notes.value.trim(),
    ...(type === 'text' ? textFields() : { background: form.mediaBackground.value })
  };

  const saveBtn = $('#save-spot');
  const bar = $('#upload-progress');
  saveBtn.disabled = true;
  saveBtn.textContent = file ? 'Uploading…' : 'Saving…';
  bar.hidden = !file;
  bar.firstElementChild.style.width = '0';

  try {
    const onProgress = (p) => (bar.firstElementChild.style.width = `${Math.round(p * 100)}%`);
    if (editing) await sendAd('PUT', `/api/admin/spots/${editing.id}`, fields, file, onProgress);
    else await sendAd('POST', '/api/admin/spots', fields, file, onProgress);
    editor.close();
    toast(editing ? 'Ad updated. The TV picks it up within 30 seconds.' : 'Ad added. The TV picks it up within 30 seconds.');
    await refresh();
  } catch (err) {
    errorBox.textContent = err.message;
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save ad';
    bar.hidden = true;
  }
});

$('#new-spot').addEventListener('click', () => openEditor());

// ---------- Settings ----------
$('#settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    state.settings = await api('/api/admin/settings', {
      method: 'PUT',
      body: { transition: f.transition.value, idleTitle: f.idleTitle.value, idleSubtitle: f.idleSubtitle.value }
    });
    $('#settings-saved').textContent = 'Saved';
    setTimeout(() => ($('#settings-saved').textContent = ''), 2500);
  } catch (err) {
    toast(err.message);
  }
});

// ---------- Boot ----------
if (memoryToken) start();
else showLogin();

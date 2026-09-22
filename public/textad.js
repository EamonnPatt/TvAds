// Builds a text slide. Shared by the TV screen and the admin preview (see textad.css).
function renderTextAd(ad, el = document.createElement('div')) {
  el.classList.add('text-ad');
  el.style.background = ad.background || '#123a6b';
  el.style.color = ad.textColor || '#ffffff';
  el.style.setProperty('--accent', ad.accentColor || '#5fa82a');
  el.style.setProperty('--accent-ink', inkFor(ad.accentColor || '#5fa82a'));
  const inner = document.createElement('div');
  inner.className = 'ta-inner';
  el.replaceChildren(inner);

  const add = (tag, cls, text) => {
    if (!text) return;
    const node = document.createElement(tag);
    node.className = cls;
    node.textContent = text;
    inner.appendChild(node);
  };
  add('div', 'ta-business', ad.title);
  add('h1', 'ta-headline', ad.headline);
  add('p', 'ta-body', ad.body);
  add('div', 'ta-footer', ad.footer);
  return el;
}

// Black or white text, whichever reads better on the given background.
function inkFor(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b > 160 ? '#111111' : '#ffffff';
}

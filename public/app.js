(() => {
  const form = document.getElementById('waiverForm');
  const formView = document.getElementById('formView');
  const successView = document.getElementById('successView');
  const formError = document.getElementById('formError');
  const submitBtn = document.getElementById('submitBtn');
  const newWaiverBtn = document.getElementById('newWaiverBtn');
  const fullscreenBtn = document.getElementById('fullscreenBtn');
  const resetCountdownEl = document.getElementById('resetCountdown');
  const waiverEndMarker = document.getElementById('waiverEndMarker');
  const scrollHint = document.getElementById('scrollHint');
  const agreeCheckbox = document.getElementById('agreeCheckbox');

  // ---- Require scrolling through the full waiver before the form appears ----
  let hasReadWaiver = false;

  function unlockSigning() {
    if (hasReadWaiver) return;
    hasReadWaiver = true;
    scrollHint.hidden = true;
    form.hidden = false;
    // Canvas had zero size while the form was hidden; size it now that it's visible.
    requestAnimationFrame(resizeCanvas);
  }

  function lockSigning() {
    hasReadWaiver = false;
    agreeCheckbox.checked = false;
    scrollHint.hidden = false;
    form.hidden = true;
  }

  const waiverObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) unlockSigning();
      });
    },
    { root: null, threshold: 1.0 }
  );
  waiverObserver.observe(waiverEndMarker);

  // ---- Signature pad (Pointer Events cover mouse, touch, and stylus) ----
  const canvas = document.getElementById('signaturePad');
  const ctx = canvas.getContext('2d');
  let drawing = false;
  let hasStroke = false;

  function resizeCanvas() {
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const prevDrawing = canvas.toDataURL ? getSignatureDataUrlSafe() : null;
    canvas.width = rect.width * ratio;
    canvas.height = rect.height * ratio;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#1a1c20';
    if (prevDrawing && hasStroke) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, rect.width, rect.height);
      img.src = prevDrawing;
    }
  }

  function getSignatureDataUrlSafe() {
    try {
      return canvas.toDataURL('image/png');
    } catch (e) {
      return null;
    }
  }

  function pointFromEvent(evt) {
    const rect = canvas.getBoundingClientRect();
    return { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
  }

  function startStroke(evt) {
    drawing = true;
    hasStroke = true;
    const p = pointFromEvent(evt);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    canvas.setPointerCapture(evt.pointerId);
  }

  function moveStroke(evt) {
    if (!drawing) return;
    const p = pointFromEvent(evt);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }

  function endStroke() {
    drawing = false;
  }

  canvas.addEventListener('pointerdown', startStroke);
  canvas.addEventListener('pointermove', moveStroke);
  canvas.addEventListener('pointerup', endStroke);
  canvas.addEventListener('pointercancel', endStroke);
  canvas.addEventListener('pointerleave', endStroke);

  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();

  document.getElementById('clearSignature').addEventListener('click', () => {
    const rect = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
    hasStroke = false;
  });

  // ---- Fullscreen toggle ----
  fullscreenBtn.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  });

  // ---- Form submit ----
  function showError(message) {
    formError.textContent = message;
    formError.hidden = false;
  }

  function clearError() {
    formError.hidden = true;
    formError.textContent = '';
  }

  form.addEventListener('submit', async (evt) => {
    evt.preventDefault();
    clearError();

    const data = new FormData(form);
    const name = (data.get('name') || '').toString().trim();
    const company = (data.get('company') || '').toString().trim();
    const phone = (data.get('phone') || '').toString().trim();
    const email = (data.get('email') || '').toString().trim();
    const agreed = document.getElementById('agreeCheckbox').checked;

    if (!name || !phone || !email) {
      showError('Please fill in your name, phone, and email.');
      return;
    }
    if (!hasReadWaiver) {
      showError('Please scroll through and read the full waiver before signing.');
      return;
    }
    if (!agreed) {
      showError('Please check the box confirming you have read and agree to the waiver.');
      return;
    }
    if (!hasStroke) {
      showError('Please sign in the signature box before submitting.');
      return;
    }

    const signatureDataUrl = getSignatureDataUrlSafe();

    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending...';

    try {
      const res = await fetch('/api/submit-waiver', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, company, phone, email, signatureDataUrl })
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.error || 'Failed to send waiver.');
      }
      showSuccess();
    } catch (err) {
      showError(err.message || 'Something went wrong. Please try again or ask staff for help.');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Sign & Send Waiver';
    }
  });

  // ---- Success + auto reset ----
  let countdownTimer = null;
  let countdownValue = 5;

  function showSuccess() {
    formView.hidden = true;
    successView.hidden = false;
    countdownValue = 5;
    resetCountdownEl.textContent = countdownValue;
    countdownTimer = setInterval(() => {
      countdownValue -= 1;
      resetCountdownEl.textContent = countdownValue;
      if (countdownValue <= 0) {
        resetForm();
      }
    }, 1000);
  }

  function resetForm() {
    if (countdownTimer) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
    form.reset();
    const rect = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
    hasStroke = false;
    clearError();
    lockSigning();
    successView.hidden = true;
    formView.hidden = false;
    window.scrollTo(0, 0);
  }

  newWaiverBtn.addEventListener('click', resetForm);
})();

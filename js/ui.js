'use strict';
/* 描画・表示まわりの共通処理 */
const UI = (() => {
  const C = {
    bg: '#12152a', rowBlack: '#141830', rowWhite: '#1a1f3b', cLine: '#39407a', label: '#8a90b0',
    ref: 'rgba(96,165,250,0.42)', refThin: 'rgba(96,165,250,0.85)', you: '#c084fc',
    ok: '#4ade80', warn: '#facc15', bad: '#f87171', head: '#ffffff', loop: 'rgba(124,140,255,0.13)',
  };
  const isBlack = m => [1, 3, 6, 8, 10].includes(((Math.round(m) % 12) + 12) % 12);

  function fit(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const cw = canvas.clientWidth, ch = canvas.clientHeight;
    const w = Math.max(1, Math.round(cw * dpr)), h = Math.max(1, Math.round(ch * dpr));
    let resized = false;
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; resized = true; }
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { g, w: cw, h: ch, resized };
  }

  const yOf = (m, lo, hi, h) => h - (m - lo + 0.5) * (h / (hi - lo + 1));

  /** 半音ごとの横縞（ピアノロール）を描く */
  function drawGrid(g, x0, w, h, lo, hi, labels = true) {
    const rh = h / (hi - lo + 1);
    g.fillStyle = C.bg;
    g.fillRect(0, 0, w, h);
    for (let m = lo; m <= hi; m++) {
      const y = h - (m - lo + 1) * rh;
      g.fillStyle = isBlack(m) ? C.rowBlack : C.rowWhite;
      g.fillRect(x0, y, w - x0, rh);
      if (((m % 12) + 12) % 12 === 0) { g.fillStyle = C.cLine; g.fillRect(x0, y + rh - 1, w - x0, 1); }
    }
    if (!labels || x0 <= 0) return;
    g.font = '11px "Segoe UI", sans-serif';
    g.textBaseline = 'middle';
    for (let m = lo; m <= hi; m++) {
      const isC = ((m % 12) + 12) % 12 === 0;
      if (isBlack(m)) continue;
      if (!isC && rh < 9) continue;
      g.fillStyle = isC ? '#c8ccea' : C.label;
      g.fillText(Pitch.noteName(m, 'short'), 4, yOf(m, lo, hi, h));
    }
  }

  function devColor(c) {
    const a = Math.abs(c);
    return a <= 50 ? C.ok : a <= 100 ? C.warn : C.bad;
  }

  function fmtTime(t) {
    if (!isFinite(t) || t < 0) t = 0;
    const m = Math.floor(t / 60), s = t - m * 60;
    return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1);
  }

  function fmtCents(c) {
    const r = Math.round(c);
    return (r > 0 ? '+' : r < 0 ? '−' : '±') + Math.abs(r) + '¢';
  }

  let toastTimer = null;
  function toast(msg) {
    let el = document.getElementById('toast');
    if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
  }

  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  return { C, isBlack, fit, yOf, drawGrid, devColor, fmtTime, fmtCents, toast, download };
})();

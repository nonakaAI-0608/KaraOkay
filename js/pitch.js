'use strict';
/* 音程検出（YIN法）と音名ユーティリティ */
const Pitch = (() => {
  const EN = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const JA = ['ド', 'ド#', 'レ', 'レ#', 'ミ', 'ファ', 'ファ#', 'ソ', 'ソ#', 'ラ', 'ラ#', 'シ'];
  const MIN_F = 65;    // C2付近
  const MAX_F = 1100;  // C6付近
  const ANALYSIS_SR = 11025;
  let notation = 'both';
  let scratch = new Float32Array(0);

  const freqToMidi = f => 69 + 12 * Math.log2(f / 440);
  const midiToFreq = m => 440 * Math.pow(2, (m - 69) / 12);

  function noteName(m, mode = notation) {
    if (m == null || isNaN(m)) return '-';
    const r = Math.round(m);
    const pc = ((r % 12) + 12) % 12;
    const en = EN[pc] + (Math.floor(r / 12) - 1);
    if (mode === 'en') return en;
    if (mode === 'ja') return JA[pc];
    if (mode === 'short') return en + ' ' + JA[pc];
    return `${en}（${JA[pc]}）`;
  }
  const jaName = m => JA[((Math.round(m) % 12) + 12) % 12];

  /** オクターブ違いを無視したセント差（-600〜+600） */
  function foldCents(c) { return ((((c + 600) % 1200) + 1200) % 1200) - 600; }

  /** YIN法で基本周波数を求める。見つからなければ0 */
  function yin(buf, sr, minF = MIN_F, maxF = MAX_F, thresh = 0.15) {
    const tauMax = Math.min(Math.floor(sr / minF), Math.floor(buf.length / 2));
    const tauMin = Math.max(2, Math.floor(sr / maxF));
    const W = buf.length - tauMax;
    if (scratch.length < 2 * (tauMax + 2)) scratch = new Float32Array(2 * (tauMax + 2));
    const d = scratch.subarray(0, tauMax + 2);
    const raw = scratch.subarray(tauMax + 2);
    d[0] = 1;
    let run = 0;
    for (let tau = 1; tau <= tauMax; tau++) {
      let s = 0;
      for (let i = 0; i < W; i++) { const x = buf[i] - buf[i + tau]; s += x * x; }
      raw[tau] = s;
      run += s;
      d[tau] = run > 0 ? (s * tau) / run : 1;
    }
    let tau = -1;
    for (let t = tauMin; t <= tauMax; t++) {
      if (d[t] < thresh) {
        while (t + 1 <= tauMax && d[t + 1] < d[t]) t++;
        tau = t;
        break;
      }
    }
    if (tau < 0) return 0;
    let better = tau;
    if (tau > 1 && tau < tauMax) {
      const a = raw[tau - 1], b = raw[tau], c = raw[tau + 1];
      const den = a + c - 2 * b;
      if (Math.abs(den) > 1e-12) better = tau + (a - c) / (2 * den);
    }
    return sr / better;
  }

  function rms(buf, from = 0, to = buf.length) {
    let s = 0;
    for (let i = from; i < to; i++) s += buf[i] * buf[i];
    return Math.sqrt(s / Math.max(1, to - from));
  }

  /** AudioBuffer をモノラル・指定サンプルレートに変換 */
  async function resample(audioBuffer, sr = ANALYSIS_SR) {
    const len = Math.max(1, Math.ceil(audioBuffer.duration * sr));
    const off = new OfflineAudioContext(1, len, sr);
    const src = off.createBufferSource();
    src.buffer = audioBuffer;
    src.connect(off.destination);
    src.start(0);
    const out = await off.startRendering();
    return out.getChannelData(0);
  }

  /** 音声全体の音程カーブを求める。戻り値 {hop, t0, data(Float32Array, 無声はNaN)} */
  async function analyze(x, sr, opts = {}) {
    const { onProgress, gateRatio = 0.06, minGate = 0.002, thresh = 0.2 } = opts;
    const hop = Math.round(sr * 0.01);
    const frame = 640;
    const n = Math.max(0, Math.floor((x.length - frame) / hop) + 1);
    const r = new Float32Array(n);
    for (let i = 0; i < n; i++) r[i] = rms(x, i * hop, i * hop + frame);
    const sorted = Float32Array.from(r).sort();
    const p99 = sorted[Math.floor(n * 0.99)] || 0;
    const gate = Math.max(minGate, p99 * gateRatio);
    const data = new Float32Array(n).fill(NaN);
    let lastYield = performance.now();
    for (let i = 0; i < n; i++) {
      if (r[i] >= gate) {
        const f = yin(x.subarray(i * hop, i * hop + frame), sr, MIN_F, MAX_F, thresh);
        if (f > 0) data[i] = freqToMidi(f);
      }
      if (performance.now() - lastYield > 30) {
        if (onProgress) onProgress(i / n);
        await new Promise(res => setTimeout(res, 0));
        lastYield = performance.now();
      }
    }
    if (onProgress) onProgress(1);
    return { hop: hop / sr, t0: frame / 2 / sr, data: clean(data) };
  }

  async function analyzeBuffer(audioBuffer, opts) {
    const x = await resample(audioBuffer, ANALYSIS_SR);
    return analyze(x, ANALYSIS_SR, opts);
  }

  /** オクターブ誤検出の補正・メディアン平滑化・短い断片の除去 */
  function clean(data) {
    const n = data.length;
    const a = new Float32Array(n);
    const win = [];
    for (let i = 0; i < n; i++) {
      const v = data[i];
      if (isNaN(v)) { a[i] = NaN; continue; }
      win.length = 0;
      for (let k = i - 4; k <= i + 4; k++) if (k >= 0 && k < n && !isNaN(data[k])) win.push(data[k]);
      win.sort((p, q) => p - q);
      const med = win[win.length >> 1];
      a[i] = Math.abs(v - med) > 8 ? v + 12 * Math.round((med - v) / 12) : v;
    }
    const b = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      if (isNaN(a[i])) { b[i] = NaN; continue; }
      win.length = 0;
      for (let k = i - 2; k <= i + 2; k++) if (k >= 0 && k < n && !isNaN(a[k])) win.push(a[k]);
      win.sort((p, q) => p - q);
      b[i] = win[win.length >> 1];
    }
    // 小さな隙間を埋める
    for (let i = 1; i < n; i++) {
      if (!isNaN(b[i]) || isNaN(b[i - 1])) continue;
      let j = i;
      while (j < n && isNaN(b[j]) && j - i < 4) j++;
      if (j < n && j - i < 4 && !isNaN(b[j]) && Math.abs(b[j] - b[i - 1]) < 1) {
        for (let k = i; k < j; k++) b[k] = b[i - 1] + (b[j] - b[i - 1]) * (k - i + 1) / (j - i + 1);
      }
      i = j;
    }
    // 60ms未満の断片を除去
    let i = 0;
    while (i < n) {
      if (isNaN(b[i])) { i++; continue; }
      let j = i;
      while (j < n && !isNaN(b[j])) j++;
      if (j - i < 6) for (let k = i; k < j; k++) b[k] = NaN;
      i = j;
    }
    return b;
  }

  function trackAt(tr, t) {
    if (!tr) return NaN;
    const i = Math.round((t - tr.t0) / tr.hop);
    return i >= 0 && i < tr.data.length ? tr.data[i] : NaN;
  }

  return {
    EN, JA, freqToMidi, midiToFreq, noteName, jaName, foldCents, yin, rms,
    analyze, analyzeBuffer, trackAt,
    setNotation: n => { notation = n; },
  };
})();

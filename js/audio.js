'use strict';
/* オーディオ基盤：AudioContext、マイク、録音、音の合成・再生 */
const Engine = (() => {
  let ctx = null, master = null;
  const mic = { on: false, stream: null, src: null, analyser: null, proc: null, sink: null, buf: null };
  const rec = { active: false, chunks: [], startCtx: 0 };
  const live = { midi: NaN, rms: 0, hist: [] };
  let gate = 0.01;

  function ensure() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
      master = ctx.createGain();
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  const now = () => ensure().currentTime;

  async function startMic(deviceId, echo) {
    ensure();
    stopMic();
    const audio = { echoCancellation: !!echo, noiseSuppression: false, autoGainControl: false };
    if (deviceId) audio.deviceId = { exact: deviceId };
    const stream = await navigator.mediaDevices.getUserMedia({ audio });
    mic.stream = stream;
    mic.src = ctx.createMediaStreamSource(stream);
    mic.analyser = ctx.createAnalyser();
    mic.analyser.fftSize = 2048;
    mic.buf = new Float32Array(mic.analyser.fftSize);
    mic.src.connect(mic.analyser);
    mic.proc = ctx.createScriptProcessor(1024, 1, 1);
    mic.proc.onaudioprocess = e => {
      if (!rec.active) return;
      const d = e.inputBuffer.getChannelData(0);
      if (rec.chunks.length === 0) rec.startCtx = ctx.currentTime - d.length / ctx.sampleRate;
      rec.chunks.push(new Float32Array(d));
    };
    mic.sink = ctx.createGain();
    mic.sink.gain.value = 0;
    mic.src.connect(mic.proc);
    mic.proc.connect(mic.sink);
    mic.sink.connect(ctx.destination);
    mic.on = true;
  }

  function stopMic() {
    if (!mic.on) return;
    rec.active = false;
    mic.stream.getTracks().forEach(t => t.stop());
    try { mic.src.disconnect(); mic.proc.disconnect(); mic.sink.disconnect(); } catch (e) { /* noop */ }
    mic.proc.onaudioprocess = null;
    mic.on = false;
    live.midi = NaN; live.rms = 0;
  }

  /** 毎フレーム呼ぶ：現在の声の高さを更新 */
  function updateLive() {
    if (!mic.on) { live.midi = NaN; live.rms = 0; return live; }
    mic.analyser.getFloatTimeDomainData(mic.buf);
    const r = Pitch.rms(mic.buf);
    live.rms = r;
    let m = NaN;
    if (r >= gate) {
      const f = Pitch.yin(mic.buf, ctx.sampleRate, 65, 1100, 0.15);
      if (f > 0) m = Pitch.freqToMidi(f);
    }
    live.hist.push(m);
    if (live.hist.length > 3) live.hist.shift();
    if (isNaN(m)) live.midi = NaN;
    else {
      const v = live.hist.filter(x => !isNaN(x));
      if (v.length === 3) { v.sort((a, b) => a - b); live.midi = v[1]; } else live.midi = m;
    }
    return live;
  }

  function startRecording() { rec.chunks = []; rec.active = true; }
  function stopRecording() {
    if (!rec.active) return null;
    rec.active = false;
    const len = rec.chunks.reduce((a, c) => a + c.length, 0);
    if (!len) return null;
    const samples = new Float32Array(len);
    let o = 0;
    for (const c of rec.chunks) { samples.set(c, o); o += c.length; }
    rec.chunks = [];
    return { samples, sr: ctx.sampleRate, startCtx: rec.startCtx };
  }

  function makeBuffer(samples, sr) {
    ensure();
    const b = ctx.createBuffer(1, samples.length, sr);
    b.copyToChannel(samples, 0);
    return b;
  }

  /** 出力先ノード（必要ならパン付き） */
  function output(pan = 0) {
    ensure();
    if (pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      p.connect(master);
      return p;
    }
    return master;
  }

  function playBuffer(ab, { when = 0, gain = 1, offset = 0 } = {}) {
    ensure();
    const s = ctx.createBufferSource();
    s.buffer = ab;
    const g = ctx.createGain();
    g.gain.value = gain;
    s.connect(g); g.connect(master);
    s.start(Math.max(ctx.currentTime, when), offset);
    s.onended = () => g.disconnect();
    return s;
  }

  const TONES = {
    piano: { partials: [1, 0.5, 0.28, 0.14, 0.07, 0.04], decay: true },
    sine: { partials: [1] },
    triangle: { type: 'triangle' },
    organ: { partials: [1, 0.6, 0.35, 0.2, 0.1] },
  };

  /** 単音を鳴らす。dur=Infinity なら release() まで鳴り続ける */
  function playTone(midi, dur = 1.5, kind = 'piano', vol = 0.5, when = 0) {
    ensure();
    const t = Math.max(ctx.currentTime, when || 0);
    const f = Pitch.midiToFreq(midi);
    const spec = TONES[kind] || TONES.piano;
    const g = ctx.createGain();
    g.gain.value = 0;
    g.connect(master);
    const oscs = [];
    if (spec.type) {
      const o = ctx.createOscillator();
      o.type = spec.type; o.frequency.value = f; o.connect(g); oscs.push(o);
    } else {
      const sum = spec.partials.reduce((a, b) => a + b, 0);
      spec.partials.forEach((amp, i) => {
        if (f * (i + 1) > 16000) return;
        const o = ctx.createOscillator();
        o.frequency.value = f * (i + 1);
        const pg = ctx.createGain();
        pg.gain.value = amp / sum;
        o.connect(pg); pg.connect(g); oscs.push(o);
      });
    }
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + (spec.decay ? 0.006 : 0.03));
    if (spec.decay) g.gain.setTargetAtTime(vol * 0.4, t + 0.02, 0.3);
    oscs.forEach(o => o.start(t));
    let released = false;
    function release(at) {
      if (released) return;
      released = true;
      const r = Math.max(ctx.currentTime, at || 0);
      if (g.gain.cancelAndHoldAtTime) g.gain.cancelAndHoldAtTime(r);
      else g.gain.cancelScheduledValues(r);
      g.gain.setTargetAtTime(0, r, 0.05);
      oscs.forEach(o => o.stop(r + 0.4));
      setTimeout(() => { try { g.disconnect(); } catch (e) { /* noop */ } }, (r - ctx.currentTime + 0.5) * 1000);
    }
    if (isFinite(dur)) release(t + dur);
    return { release, start: t };
  }

  function encodeWav(samples, sr) {
    const buf = new ArrayBuffer(44 + samples.length * 2);
    const v = new DataView(buf);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); w(8, 'WAVE');
    w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    w(36, 'data'); v.setUint32(40, samples.length * 2, true);
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return new Blob([buf], { type: 'audio/wav' });
  }

  /** 出力＋入力の遅れの目安（秒） */
  function latencyEstimate() {
    ensure();
    return (ctx.outputLatency || 0) + (ctx.baseLatency || 0) + 0.03;
  }

  return {
    ensure, now, startMic, stopMic, updateLive, startRecording, stopRecording,
    makeBuffer, output, playBuffer, playTone, encodeWav, latencyEstimate, live,
    get master() { ensure(); return master; },
    micOn: () => mic.on,
    isRecording: () => rec.active,
    setGate: g => { gate = g; },
  };
})();

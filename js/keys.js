'use strict';
/* 鍵盤トレーニング：単音を聴いて同じ高さで歌う */
const Keys = (() => {
  const LOW = 36, HIGH = 84; // C2〜C6
  const PC_KEYS = { KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7, KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11, KeyK: 12, KeyO: 13, KeyL: 14 };
  const $ = id => document.getElementById(id);
  const S = {
    target: null, trace: [], muteUntil: 0, keyEls: {}, youKey: null,
    T: null, results: [], free: { rec: false, take: null },
  };
  let el = {};

  function init() {
    el = {
      target: $('kTarget'), note: $('kNote'), cents: $('kCents'), needle: $('kNeedle'), zone: $('kZone'),
      hint: $('kHint'), holdBar: $('kHoldBar'), trace: $('traceCanvas'), kb: $('keyboard'),
      tone: $('kTone'), vol: $('kVol'), dur: $('kDur'), oct: $('kOct'), listenTone: $('kListenTone'),
      freeRec: $('kFreeRec'), freeMe: $('kFreePlayMe'), freeBoth: $('kFreePlayBoth'),
      low: $('kLow'), high: $('kHigh'), mode: $('kMode'), tol: $('kTol'), keep: $('kKeep'), limit: $('kLimit'),
      count: $('kCount'), guideHold: $('kGuideHold'), oct8: $('kOct8'),
      start: $('kStart'), repeat: $('kRepeat'), quit: $('kQuit'), status: $('kStatus'),
      summary: $('kSummary'), results: $('kResults'),
    };
    // 音域セレクトの選択肢
    for (let m = LOW; m <= HIGH; m++) {
      el.low.add(new Option(Pitch.noteName(m, 'short'), m));
      el.high.add(new Option(Pitch.noteName(m, 'short'), m));
    }
    for (let m = LOW; m <= 72; m += 12) el.oct.add(new Option(`${Pitch.noteName(m, 'en')}〜`, m));
    el.low.value = 48; el.high.value = 64; el.oct.value = 60;

    buildKeyboard();

    document.querySelectorAll('.presets [data-range]').forEach(b => b.addEventListener('click', () => {
      const [a, c] = b.dataset.range.split(',');
      el.low.value = a; el.high.value = c;
      el.low.dispatchEvent(new Event('change', { bubbles: true }));
    }));
    el.low.addEventListener('change', fixRange);
    el.high.addEventListener('change', fixRange);
    el.tol.addEventListener('change', updateZone);
    el.start.addEventListener('click', startTraining);
    el.quit.addEventListener('click', () => quitTraining(true));
    el.repeat.addEventListener('click', repeatExample);
    el.freeRec.addEventListener('click', toggleFreeRec);
    el.freeMe.addEventListener('click', () => { if (S.free.take) Engine.playBuffer(S.free.take.ab, { gain: 1.5 }); });
    el.freeBoth.addEventListener('click', () => { if (S.free.take) playCompare(S.free.take.target, S.free.take.ab); });
    updateZone();
  }

  function fixRange() {
    if (+el.low.value > +el.high.value - 2) {
      if (this === el.high) el.low.value = Math.max(LOW, +el.high.value - 2);
      else el.high.value = Math.min(HIGH, +el.low.value + 2);
    }
  }
  const tol = () => +el.tol.value;
  function updateZone() {
    const w = (tol() / 100) * 50; // ゲージは±100¢
    el.zone.style.left = 50 - w + '%';
    el.zone.style.width = 2 * w + '%';
  }

  // ---------- 鍵盤 ----------
  function buildKeyboard() {
    el.kb.innerHTML = '';
    const whites = [];
    for (let m = LOW; m <= HIGH; m++) if (!UI.isBlack(m)) whites.push(m);
    const wW = 100 / whites.length;
    let wi = 0;
    for (let m = LOW; m <= HIGH; m++) {
      const d = document.createElement('div');
      const black = UI.isBlack(m);
      d.className = 'key ' + (black ? 'black' : 'white');
      d.dataset.midi = m;
      if (black) {
        d.style.left = (wi * wW - wW * 0.31) + '%';
        d.style.width = wW * 0.62 + '%';
      } else {
        d.style.left = wi * wW + '%';
        d.style.width = wW + '%';
        const isC = m % 12 === 0;
        d.innerHTML = `<span>${Pitch.jaName(m)}</span>${isC ? `<span class="c">${Pitch.noteName(m, 'en')}</span>` : ''}`;
        wi++;
      }
      d.addEventListener('pointerdown', e => { e.preventDefault(); pressKey(m); });
      el.kb.appendChild(d);
      S.keyEls[m] = d;
    }
    // 中央付近までスクロール
    requestAnimationFrame(() => {
      const wrap = el.kb.parentElement;
      const c4 = S.keyEls[60];
      if (c4) wrap.scrollLeft = c4.offsetLeft - wrap.clientWidth / 2 + 40;
    });
  }

  function flashKey(m, dur) {
    const k = S.keyEls[m];
    if (!k) return;
    k.classList.add('pressed');
    setTimeout(() => k.classList.remove('pressed'), Math.min(dur, 0.6) * 1000);
  }

  function sound(m, dur) {
    const h = Engine.playTone(m, dur, el.tone.value, +el.vol.value);
    flashKey(m, dur);
    if (!el.listenTone.checked) S.muteUntil = Math.max(S.muteUntil, h.start + dur + 0.25);
    return h;
  }

  function pressKey(m) {
    const T = S.T;
    if (T && T.active) { sound(m, 1); return; } // トレーニング中は目標を変えない
    S.target = m;
    sound(m, +el.dur.value);
  }

  function onKey(e) {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code in PC_KEYS) {
      e.preventDefault();
      const m = +el.oct.value + PC_KEYS[e.code];
      if (m >= LOW && m <= HIGH) pressKey(m);
    } else if (e.code === 'Escape') {
      if (S.T && S.T.active) quitTraining(true); else S.target = null;
    }
  }

  // ---------- 聴き比べ ----------
  function playCompare(target, ab) {
    const t = Engine.now() + 0.05;
    const d = 1.2;
    if (target != null) { Engine.playTone(target, d, el.tone.value, +el.vol.value, t); flashKey(target, d); }
    Engine.playBuffer(ab, { when: target != null ? t + d + 0.3 : t, gain: 1.5 });
  }

  async function toggleFreeRec() {
    if (S.free.rec) {
      S.free.rec = false;
      const r = Engine.stopRecording();
      el.freeRec.textContent = '● 録音';
      el.freeRec.classList.remove('active');
      if (r && r.samples.length > r.sr * 0.2) {
        S.free.take = { ab: Engine.makeBuffer(r.samples, r.sr), target: S.target };
        el.freeMe.disabled = false;
        el.freeBoth.disabled = S.target == null;
      }
      return;
    }
    if (S.T && S.T.active) return;
    if (!(await App.ensureMic())) return;
    Engine.startRecording();
    S.free.rec = true;
    el.freeRec.textContent = '■ 録音停止';
    el.freeRec.classList.add('active');
  }

  // ---------- トレーニング ----------
  function makeQuestions() {
    const lo = +el.low.value, hi = +el.high.value, n = +el.count.value, mode = el.mode.value;
    const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
    const list = [];
    if (mode === 'scale') {
      const steps = [0, 2, 4, 5, 7, 9, 11, 12];
      let base = lo;
      const notes = steps.map(s => base + s).filter(m => m <= hi);
      const seq = notes.concat(notes.slice(0, -1).reverse());
      while (list.length < n) list.push(...seq);
      return list.slice(0, n);
    }
    let prev = rnd(lo, hi);
    list.push(prev);
    while (list.length < n) {
      let m;
      if (mode === 'same') m = prev;
      else if (mode === 'random') { do { m = rnd(lo, hi); } while (m === prev && hi > lo); }
      else {
        const [a, b] = mode === 'step' ? [1, 2] : [3, 7];
        let tries = 0;
        do {
          m = prev + (Math.random() < 0.5 ? -1 : 1) * rnd(a, b);
          tries++;
        } while ((m < lo || m > hi) && tries < 50);
        if (m < lo || m > hi) m = rnd(lo, hi);
      }
      list.push(m);
      prev = m;
    }
    return list;
  }

  async function startTraining() {
    if (!(await App.ensureMic())) return;
    if (S.free.rec) toggleFreeRec();
    S.results = [];
    renderResults();
    S.T = { active: true, list: makeQuestions(), idx: -1, phase: 'idle', phaseEnd: 0 };
    el.start.disabled = true;
    el.quit.disabled = false;
    nextQuestion();
  }

  function nextQuestion() {
    const T = S.T;
    T.idx++;
    if (T.idx >= T.list.length) { finishTraining(); return; }
    S.target = T.list[T.idx];
    playExample();
  }

  function playExample() {
    const T = S.T;
    const d = +el.dur.value;
    T.phase = 'example';
    const h = Engine.playTone(S.target, d, el.tone.value, +el.vol.value);
    flashKey(S.target, d);
    T.phaseEnd = h.start + d + 0.15;
    el.repeat.disabled = true;
    setStatus(`第${T.idx + 1}問 / ${T.list.length}　お手本を聴いてください… ${Pitch.noteName(S.target)}`, '');
  }

  function startSinging() {
    const T = S.T;
    T.phase = 'sing';
    const t = Engine.now();
    Object.assign(T, { singStart: t, limitEnd: t + +el.limit.value, hold: 0, grace: 0, firstHit: null, devs: [] });
    if (T.recording) Engine.stopRecording();
    Engine.startRecording();
    T.recording = true;
    if (el.guideHold.checked) T.guide = Engine.playTone(S.target, Infinity, 'sine', +el.vol.value * 0.5);
    el.repeat.disabled = false;
    setStatus(`第${T.idx + 1}問　あなたの番です！ ${Pitch.noteName(S.target)} を歌って ${el.keep.value}秒キープ`, 'sing');
  }

  function repeatExample() {
    const T = S.T;
    if (!T || T.phase !== 'sing') return;
    const d = +el.dur.value;
    const h = Engine.playTone(S.target, d, el.tone.value, +el.vol.value);
    flashKey(S.target, d);
    if (!el.listenTone.checked && !el.guideHold.checked) S.muteUntil = h.start + d + 0.25;
    T.limitEnd += d + 0.3;
    T.hold = 0;
  }

  function endAttempt(ok) {
    const T = S.T;
    const t = Engine.now();
    if (T.guide) { T.guide.release(); T.guide = null; }
    const r = T.recording ? Engine.stopRecording() : null;
    T.recording = false;
    const devs = T.devs.filter(c => Math.abs(c) < 300);
    const bias = devs.length ? devs.reduce((a, b) => a + b, 0) / devs.length : NaN;
    S.results.push({
      n: T.idx + 1, target: S.target, ok,
      time: ok ? t - T.singStart : null, firstHit: T.firstHit,
      bias, voiced: T.devs.length,
      ab: r ? Engine.makeBuffer(r.samples, r.sr) : null,
    });
    if (ok) {
      Engine.playTone(S.target + 12, 0.12, 'sine', 0.25, t + 0.05);
      Engine.playTone(S.target + 19, 0.2, 'sine', 0.25, t + 0.16);
      setStatus(`◎ 成功！（${(t - T.singStart).toFixed(1)}秒）`, 'ok');
    } else {
      let msg = '✕ 時間切れ';
      if (!isNaN(bias)) msg += Math.abs(bias) < 50 ? '（おしい！キープが続きませんでした）' : bias < 0 ? '（低めでした）' : '（高めでした）';
      else msg += '（声を検出できませんでした）';
      setStatus(msg, 'bad');
    }
    S.muteUntil = t + 0.6;
    T.phase = 'result';
    T.phaseEnd = t + 1.4;
    el.repeat.disabled = true;
    renderResults();
  }

  function quitTraining(manual) {
    const T = S.T;
    if (!T) return;
    if (T.guide) { T.guide.release(); T.guide = null; }
    if (T.recording) { Engine.stopRecording(); T.recording = false; }
    T.active = false;
    S.T = null;
    el.start.disabled = false;
    el.quit.disabled = true;
    el.repeat.disabled = true;
    el.holdBar.style.width = '0';
    if (manual) setStatus('中断しました。', '');
  }

  function finishTraining() {
    quitTraining(false);
    const ok = S.results.filter(r => r.ok).length;
    setStatus(`おつかれさまでした！ ${ok} / ${S.results.length} 問成功。結果の表で聴き比べができます。`, 'ok');
  }

  function setStatus(txt, cls) {
    el.status.textContent = txt;
    el.status.className = 'kstatus ' + (cls || '');
  }

  function renderResults() {
    const R = S.results;
    el.results.innerHTML = '';
    if (!R.length) { el.summary.textContent = 'まだ結果がありません'; el.summary.classList.add('muted'); return; }
    el.summary.classList.remove('muted');
    const ok = R.filter(r => r.ok);
    const avgT = ok.length ? ok.reduce((a, r) => a + r.time, 0) / ok.length : NaN;
    const bs = R.filter(r => !isNaN(r.bias));
    const bias = bs.length ? bs.reduce((a, r) => a + r.bias, 0) / bs.length : NaN;
    let tend = '-';
    if (!isNaN(bias)) tend = Math.abs(bias) < 15 ? '偏りは小さい' : (bias < 0 ? '低めになりがち' : '高めになりがち') + `（${UI.fmtCents(bias)}）`;
    el.summary.innerHTML = `成功 <b>${ok.length} / ${R.length}</b>　・　平均到達時間 <b>${isNaN(avgT) ? '-' : avgT.toFixed(1) + '秒'}</b>　・　傾向 <b>${tend}</b>`;
    for (const r of [...R].reverse()) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${r.n}</td><td>${Pitch.noteName(r.target)}</td>
        <td class="${r.ok ? 'ok' : 'bad'}">${r.ok ? '◎ ' + r.time.toFixed(1) + '秒' : '✕'}</td>
        <td>${isNaN(r.bias) ? '-' : UI.fmtCents(r.bias)}</td><td></td>`;
      const td = tr.lastElementChild;
      const mk = (txt, title, fn) => {
        const b = document.createElement('button');
        b.className = 'btn'; b.textContent = txt; b.title = title;
        b.addEventListener('click', fn);
        td.appendChild(b);
        return b;
      };
      mk('お手本', 'お手本の音', () => { Engine.playTone(r.target, 1.2, el.tone.value, +el.vol.value); flashKey(r.target, 1.2); });
      const b1 = mk('自分', '自分の声', () => Engine.playBuffer(r.ab, { gain: 1.5 }));
      const b2 = mk('続けて', 'お手本→自分の声', () => playCompare(r.target, r.ab));
      if (!r.ab) { b1.disabled = true; b2.disabled = true; }
      el.results.appendChild(tr);
    }
  }

  // ---------- 毎フレーム ----------
  let lastT = 0;
  function frame() {
    const t = Engine.now();
    const dt = Math.min(0.25, Math.max(0, t - lastT));
    lastT = t;
    const live = Engine.live;
    const muted = t < S.muteUntil;
    const m = muted ? NaN : live.midi;
    const T = S.T;

    // 判定
    let c = NaN;
    if (S.target != null && !isNaN(m)) {
      c = (m - S.target) * 100;
      if (el.oct8.checked) c = Pitch.foldCents(c);
    }
    if (T && T.active) {
      if (T.phase === 'example' && t >= T.phaseEnd) startSinging();
      else if (T.phase === 'sing') {
        if (!isNaN(c)) T.devs.push(c);
        if (!isNaN(c) && Math.abs(c) <= tol()) {
          T.hold += dt; T.grace = 0;
          if (T.firstHit == null) T.firstHit = t - T.singStart;
        } else {
          T.grace += dt;
          if (T.grace > 0.15) T.hold = 0;
        }
        el.holdBar.style.width = Math.min(100, (T.hold / +el.keep.value) * 100) + '%';
        if (T.hold >= +el.keep.value) endAttempt(true);
        else if (t >= T.limitEnd) endAttempt(false);
      } else if (T.phase === 'result' && t >= T.phaseEnd) {
        el.holdBar.style.width = '0';
        nextQuestion();
      }
    }

    // 軌跡
    S.trace.push({ t, m: live.midi, muted });
    while (S.trace.length && S.trace[0].t < t - 7) S.trace.shift();

    updateMeter(m, c, muted);
    updateKeys(m, c);
    drawTrace(t);
  }

  function updateMeter(m, c, muted) {
    el.target.textContent = S.target == null ? '-（鍵盤をクリック）' : Pitch.noteName(S.target);
    el.note.textContent = isNaN(m) ? '-' : Pitch.noteName(m);
    let ref = S.target;
    let cc = c;
    if (ref == null && !isNaN(m)) cc = (m - Math.round(m)) * 100;
    if (isNaN(cc)) {
      el.needle.style.display = 'none';
      el.cents.textContent = ' ';
      el.note.style.color = '';
      if (muted) el.hint.textContent = '🔊 お手本を聴いています…';
      else if (S.T && S.T.phase === 'sing') el.hint.textContent = '声を出してください';
      else if (S.target == null) el.hint.textContent = '鍵盤をクリックして音を鳴らし、同じ高さで歌ってみましょう';
      else el.hint.textContent = `${Pitch.noteName(S.target)} の高さで歌ってみましょう`;
      return;
    }
    el.needle.style.display = 'block';
    el.needle.style.left = 50 + Math.max(-100, Math.min(100, cc)) / 2 + '%';
    const col = ref == null ? '#fff' : Math.abs(cc) <= tol() ? 'var(--ok)' : UI.devColor(cc);
    el.needle.style.background = col;
    el.cents.textContent = UI.fmtCents(cc);
    el.cents.style.color = col;
    el.note.style.color = ref == null ? '' : col;
    if (ref == null) { el.hint.textContent = 'いまの声の高さ（いちばん近い音とのずれ）'; return; }
    const a = Math.abs(cc);
    if (a <= tol()) el.hint.textContent = '◎ その高さ！そのままキープ';
    else if (a > 250) el.hint.textContent = cc < 0 ? `かなり低いです。目標は ${Pitch.noteName(ref)}（${Math.round(a / 100)}半音ほど上）` : `かなり高いです。目標は ${Pitch.noteName(ref)}（${Math.round(a / 100)}半音ほど下）`;
    else el.hint.textContent = cc < 0 ? '↑ もう少し高く' : '↓ もう少し低く';
  }

  function updateKeys(m, c) {
    for (const k of Object.values(S.keyEls)) k.classList.toggle('target', +k.dataset.midi === S.target);
    if (S.youKey) { S.youKey.classList.remove('you-ok', 'you-warn', 'you-bad', 'you-free'); S.youKey = null; }
    if (isNaN(m)) return;
    const k = S.keyEls[Math.round(m)];
    if (!k) return;
    let cls = 'you-free';
    if (S.target != null) cls = Math.abs(c) <= tol() ? 'you-ok' : Math.abs(c) <= 100 ? 'you-warn' : 'you-bad';
    k.classList.add(cls);
    S.youKey = k;
  }

  function drawTrace(now) {
    const { g, w, h } = UI.fit(el.trace);
    let lo = +el.low.value - 3, hi = +el.high.value + 3;
    if (S.target != null) { lo = Math.min(lo, S.target - 5); hi = Math.max(hi, S.target + 5); }
    const GUT = 58;
    UI.drawGrid(g, GUT, w, h, lo, hi);
    const span = 6;
    const X = t => GUT + (1 - (now - t) / span) * (w - GUT - 30);
    const Y = m => UI.yOf(Math.max(lo - 0.4, Math.min(hi + 0.4, m)), lo, hi, h);
    if (S.target != null) {
      const rh = h / (hi - lo + 1);
      const band = (tol() / 100) * rh;
      g.fillStyle = 'rgba(96,165,250,0.18)';
      g.fillRect(GUT, UI.yOf(S.target, lo, hi, h) - rh / 2, w - GUT, rh);
      g.fillStyle = 'rgba(74,222,128,0.28)';
      g.fillRect(GUT, UI.yOf(S.target, lo, hi, h) - band, w - GUT, band * 2);
      g.fillStyle = UI.C.ref;
      g.fillRect(GUT, UI.yOf(S.target, lo, hi, h) - 1, w - GUT, 2);
    }
    g.lineWidth = 3;
    g.lineCap = 'round';
    let prev = null;
    for (const p of S.trace) {
      if (isNaN(p.m) || p.muted) { prev = null; continue; }
      if (prev && Math.abs(p.m - prev.m) < 1.5) {
        let col = UI.C.you;
        if (S.target != null) {
          let c = (p.m - S.target) * 100;
          if (el.oct8.checked) c = Pitch.foldCents(c);
          col = Math.abs(c) <= tol() ? UI.C.ok : UI.devColor(c);
        }
        g.strokeStyle = col;
        g.beginPath(); g.moveTo(X(prev.t), Y(prev.m)); g.lineTo(X(p.t), Y(p.m)); g.stroke();
      }
      prev = p;
    }
    const last = S.trace[S.trace.length - 1];
    if (last && !isNaN(last.m) && !last.muted) {
      g.fillStyle = '#fff';
      g.beginPath(); g.arc(X(last.t), Y(last.m), 6, 0, Math.PI * 2); g.fill();
    }
  }

  function deactivate() {
    if (S.T && S.T.active) quitTraining(true);
    if (S.free.rec) toggleFreeRec();
  }

  return { init, frame, onKey, deactivate, _state: S };
})();

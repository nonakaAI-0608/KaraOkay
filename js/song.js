'use strict';
/* 音源トレーニング：お手本音源を再生しながら録音し、音程を比較する */
const Song = (() => {
  const S = {
    buffer: null, track: null, name: '', duration: 0, lo: 48, hi: 72,
    pos: 0, state: 'idle', from: 0, end: 0, t0: 0, scoreFrom: 0,
    nodes: null, loop: null, takes: [], sel: null, livePts: [], seq: 0,
    listen: 'both', overDirty: true, analyzing: false,
  };
  const GUTTER = 58;
  const $ = id => document.getElementById(id);
  let el = {};
  let overCache = null;
  let overDrag = null, rollDrag = null;

  function init() {
    el = {
      file: $('fileInput'), name: $('songName'), status: $('songStatus'),
      roll: $('rollCanvas'), over: $('overviewCanvas'), wrap: $('rollWrap'), page: $('tab-song'),
      play: $('btnPlay'), rec: $('btnRec'), stop: $('btnStop'), home: $('btnHome'), time: $('timeLabel'),
      loopLabel: $('loopLabel'), loopClear: $('btnLoopClear'), loopRepeat: $('loopRepeat'), preroll: $('preroll'),
      volRef: $('volRef'), volMe: $('volMe'), volGuide: $('volGuide'), guideOn: $('guideOn'), splitLR: $('splitLR'),
      viewSec: $('viewSec'), octFold: $('octFold'), latency: $('latency'), latencyLabel: $('latencyLabel'),
      autoAlign: $('btnAutoAlign'), result: $('resultBox'), takes: $('takeList'), seg: $('listenSeg'),
      tNote: $('songTargetNote'), yNote: $('songYouNote'), diff: $('songDiff'),
    };

    el.file.addEventListener('change', () => { if (el.file.files[0]) loadFile(el.file.files[0]); el.file.value = ''; });
    el.page.addEventListener('dragover', e => { e.preventDefault(); el.wrap.classList.add('dragover'); });
    el.page.addEventListener('dragleave', e => { if (e.target === el.page || !el.page.contains(e.relatedTarget)) el.wrap.classList.remove('dragover'); });
    el.page.addEventListener('drop', e => {
      e.preventDefault();
      el.wrap.classList.remove('dragover');
      const f = e.dataTransfer.files[0];
      if (f) loadFile(f);
    });

    el.play.addEventListener('click', togglePlay);
    el.rec.addEventListener('click', toggleRec);
    el.stop.addEventListener('click', stop);
    el.home.addEventListener('click', () => seek(S.loop ? S.loop.a : 0));
    el.loopClear.addEventListener('click', () => { S.loop = null; updateLoopLabel(); });
    [el.volRef, el.volMe, el.volGuide].forEach(x => x.addEventListener('input', applyVolumes));
    el.splitLR.addEventListener('change', restartIfPlaying);
    el.guideOn.addEventListener('change', restartIfPlaying);
    el.seg.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      S.listen = b.dataset.v;
      [...el.seg.children].forEach(x => x.classList.toggle('on', x === b));
      applyVolumes();
    });
    el.latency.addEventListener('input', () => {
      updateLatencyLabel();
      if (S.sel && S.sel.track) { S.sel.comp = +el.latency.value / 1000; refreshTake(S.sel); }
    });
    el.octFold.addEventListener('change', () => { S.takes.forEach(t => { if (t.track) t.stats = computeStats(t); }); renderAll(); });
    el.autoAlign.addEventListener('click', autoAlign);

    // 全体バー：クリックで移動、ドラッグで区間指定
    el.over.addEventListener('pointerdown', e => {
      if (!S.buffer) return;
      el.over.setPointerCapture(e.pointerId);
      overDrag = { x0: e.offsetX, t0: overT(e.offsetX), t1: overT(e.offsetX), moved: false };
    });
    el.over.addEventListener('pointermove', e => {
      if (!overDrag) return;
      if (Math.abs(e.offsetX - overDrag.x0) > 4) overDrag.moved = true;
      overDrag.t1 = overT(e.offsetX);
    });
    el.over.addEventListener('pointerup', () => {
      if (!overDrag) return;
      const d = overDrag;
      overDrag = null;
      if (d.moved) {
        const a = Math.min(d.t0, d.t1), b = Math.max(d.t0, d.t1);
        if (b - a >= 0.3) { S.loop = { a, b }; updateLoopLabel(); seek(a); return; }
      }
      seek(d.t0);
    });

    // ピアノロール：停止中はドラッグ・ホイールで時間移動
    el.roll.addEventListener('pointerdown', e => {
      if (!S.buffer || S.state !== 'idle') return;
      el.roll.setPointerCapture(e.pointerId);
      rollDrag = { x: e.clientX, pos: S.pos };
    });
    el.roll.addEventListener('pointermove', e => {
      if (!rollDrag) return;
      const spp = +el.viewSec.value / Math.max(1, el.roll.clientWidth - GUTTER);
      S.pos = clamp(rollDrag.pos - (e.clientX - rollDrag.x) * spp, 0, S.duration);
    });
    el.roll.addEventListener('pointerup', () => { rollDrag = null; });
    el.roll.addEventListener('wheel', e => {
      if (!S.buffer || S.state !== 'idle') return;
      e.preventDefault();
      S.pos = clamp(S.pos + (e.deltaY + e.deltaX) * 0.0015 * +el.viewSec.value, 0, S.duration);
    }, { passive: false });

    updateLatencyLabel();
    updateButtons();
  }

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const comp = () => +el.latency.value / 1000;
  const fold = () => el.octFold.checked;
  function updateLatencyLabel() { el.latencyLabel.textContent = el.latency.value + 'ms'; }
  function setStatus(s) { el.status.textContent = s; }

  async function loadFile(file) {
    if (S.analyzing) return;
    stopNodes();
    S.state = 'idle';
    const ctx = Engine.ensure();
    S.analyzing = true;
    updateButtons();
    try {
      setStatus('読み込み中…');
      const buf = await ctx.decodeAudioData(await file.arrayBuffer());
      Object.assign(S, { buffer: buf, duration: buf.duration, name: file.name, track: null, takes: [], sel: null, loop: null, pos: 0, livePts: [] });
      el.name.textContent = file.name;
      renderAll();
      updateLoopLabel();
      setStatus('音程を解析中… 0%');
      S.track = await Pitch.analyzeBuffer(buf, { onProgress: p => setStatus(`音程を解析中… ${Math.round(p * 100)}%`) });
      computeRange();
      const voiced = S.track.data.reduce((a, v) => a + (isNaN(v) ? 0 : 1), 0);
      setStatus(voiced < 50 ? '音程をほとんど検出できませんでした。ボーカルだけの音源か確認してください' : '');
      S.overDirty = true;
    } catch (err) {
      console.error(err);
      setStatus('');
      UI.toast('読み込めませんでした：' + (err.message || err));
    } finally {
      S.analyzing = false;
      updateButtons();
    }
  }

  function computeRange() {
    const v = [];
    for (const x of S.track.data) if (!isNaN(x)) v.push(x);
    if (!v.length) { S.lo = 48; S.hi = 72; return; }
    v.sort((a, b) => a - b);
    let lo = Math.floor(v[Math.floor(v.length * 0.01)]) - 4;
    let hi = Math.ceil(v[Math.floor(v.length * 0.99)]) + 4;
    while (hi - lo < 16) { lo--; hi++; }
    S.lo = lo; S.hi = hi;
  }

  // ---------- 再生 ----------
  function curPos() {
    if (S.state === 'idle') return S.pos;
    return S.from + Math.max(0, Engine.now() - S.t0);
  }
  const refVol = rec => (rec || S.listen !== 'me' ? +el.volRef.value : 0);
  const meVol = () => (S.listen === 'ref' ? 0 : +el.volMe.value);

  function applyVolumes() {
    if (!S.nodes) return;
    const t = Engine.now();
    S.nodes.refGain.gain.setTargetAtTime(refVol(S.state === 'rec'), t, 0.02);
    if (S.nodes.meGain) S.nodes.meGain.gain.setTargetAtTime(meVol(), t, 0.02);
  }

  async function play(record) {
    if (!S.buffer || !S.track) return;
    if (record && !(await App.ensureMic())) return;
    stopNodes();
    const ctx = Engine.ensure();
    let start = S.pos;
    if (S.loop && (record || start < S.loop.a || start >= S.loop.b - 0.05)) start = S.loop.a;
    if (start >= S.duration - 0.1) start = 0;
    const end = S.loop ? S.loop.b : S.duration;
    const pre = record ? +el.preroll.value : 0;
    S.from = Math.max(0, start - pre);
    S.scoreFrom = start;
    S.end = end;
    S.t0 = ctx.currentTime + 0.08;
    const split = el.splitLR.checked;
    const n = { srcs: [], gains: [] };

    n.refGain = ctx.createGain();
    n.refGain.gain.value = refVol(record);
    n.refGain.connect(Engine.output(split ? -0.85 : 0));
    n.gains.push(n.refGain);
    const src = ctx.createBufferSource();
    src.buffer = S.buffer;
    src.connect(n.refGain);
    src.start(S.t0, S.from);
    n.srcs.push(src);

    const tk = S.sel;
    if (!record && tk) {
      n.meGain = ctx.createGain();
      n.meGain.gain.value = meVol();
      n.meGain.connect(Engine.output(split ? 0.85 : 0));
      n.gains.push(n.meGain);
      const r0 = S.from - tk.recStartSong + tk.comp;
      if (r0 < tk.ab.duration) {
        const ts = ctx.createBufferSource();
        ts.buffer = tk.ab;
        ts.connect(n.meGain);
        if (r0 >= 0) ts.start(S.t0, r0); else ts.start(S.t0 - r0, 0);
        n.srcs.push(ts);
      }
    }

    if (el.guideOn.checked) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      const gg = ctx.createGain();
      gg.gain.value = 0;
      o.connect(gg);
      gg.connect(Engine.output(split ? -0.85 : 0));
      o.start(S.t0);
      n.srcs.push(o);
      n.gains.push(gg);
      n.guide = { o, g: gg };
    }

    S.nodes = n;
    S.state = record ? 'rec' : 'play';
    S.livePts = [];
    if (record) { S.sel = null; Engine.startRecording(); renderTakes(); renderResult(); S.overDirty = true; }
    updateButtons();
  }

  function stopNodes() {
    if (!S.nodes) return;
    S.nodes.srcs.forEach(s => { try { s.stop(); } catch (e) { /* noop */ } });
    S.nodes.gains.forEach(g => { try { g.disconnect(); } catch (e) { /* noop */ } });
    S.nodes = null;
  }

  function pause() {
    S.pos = clamp(curPos(), 0, S.duration);
    stopNodes();
    S.state = 'idle';
    updateButtons();
  }

  function togglePlay() {
    if (S.state === 'play') pause();
    else if (S.state === 'rec') finishRecording();
    else play(false);
  }
  function toggleRec() {
    if (S.state === 'rec') finishRecording();
    else play(true);
  }
  function stop() {
    if (S.state === 'rec') finishRecording();
    else if (S.state === 'play') pause();
    else S.pos = S.loop ? S.loop.a : 0;
  }
  function restartIfPlaying() {
    if (S.state === 'play') { S.pos = curPos(); play(false); }
  }
  function seek(t) {
    if (!S.buffer || S.state === 'rec') return;
    S.pos = clamp(t, 0, S.duration);
    if (S.state === 'play') play(false);
  }

  function updateButtons() {
    const ready = !!(S.buffer && S.track) && !S.analyzing;
    el.play.disabled = !ready || S.state === 'rec';
    el.rec.disabled = !ready;
    el.stop.disabled = !ready;
    el.home.disabled = !ready;
    el.play.textContent = S.state === 'play' ? '❚❚ 一時停止' : '▶ 再生';
    el.rec.textContent = S.state === 'rec' ? '■ 録音を終える' : '● 歌って録音';
    el.rec.classList.toggle('active', S.state === 'rec');
    el.autoAlign.disabled = !(S.sel && S.sel.track);
  }

  function updateLoopLabel() {
    el.loopLabel.textContent = S.loop
      ? `区間：${UI.fmtTime(S.loop.a)} 〜 ${UI.fmtTime(S.loop.b)}`
      : '区間：全体（下のバーをドラッグで指定）';
    el.loopClear.disabled = !S.loop;
  }

  // ---------- 録音と採点 ----------
  async function finishRecording() {
    if (S.state !== 'rec') return;
    const endPos = Math.min(curPos(), S.end);
    const r = Engine.stopRecording();
    stopNodes();
    S.state = 'idle';
    S.pos = S.scoreFrom;
    updateButtons();
    if (!r || r.samples.length < r.sr * 0.3 || endPos - S.scoreFrom < 0.3) {
      UI.toast('録音が短すぎます');
      return;
    }
    const take = {
      id: ++S.seq, samples: r.samples, sr: r.sr, ab: Engine.makeBuffer(r.samples, r.sr),
      recStartSong: S.from + (r.startCtx - S.t0), comp: comp(),
      range: [S.scoreFrom, endPos], track: null, stats: null, live: S.livePts,
    };
    S.takes.unshift(take);
    if (S.takes.length > 30) S.takes.pop();
    S.sel = take;
    renderAll();
    take.track = await Pitch.analyzeBuffer(take.ab, { gateRatio: 0.12, minGate: 0.004 });
    take.stats = computeStats(take);
    renderAll();
  }

  function userAt(tk, t) {
    return tk.track ? Pitch.trackAt(tk.track, t - tk.recStartSong + tk.comp) : NaN;
  }

  function computeStats(tk) {
    const ref = S.track;
    let nRef = 0, nSung = 0, nHit = 0, sumAbs = 0, sumSigned = 0, nSigned = 0;
    for (let t = tk.range[0]; t < tk.range[1]; t += ref.hop) {
      const rm = Pitch.trackAt(ref, t);
      if (isNaN(rm)) continue;
      nRef++;
      const um = userAt(tk, t);
      if (isNaN(um)) continue;
      nSung++;
      let c = (um - rm) * 100;
      if (fold()) c = Pitch.foldCents(c);
      sumAbs += Math.min(Math.abs(c), 600);
      if (Math.abs(c) <= 50) nHit++;
      if (Math.abs(c) < 300) { sumSigned += c; nSigned++; }
    }
    return {
      nRef,
      sung: nRef ? nSung / nRef : 0,
      hit: nRef ? nHit / nRef : 0,
      accuracy: nSung ? nHit / nSung : 0,
      meanAbs: nSung ? sumAbs / nSung : 0,
      bias: nSigned ? sumSigned / nSigned : 0,
      score: nRef ? Math.round((100 * nHit) / nRef) : 0,
    };
  }

  function refreshTake(tk) {
    tk.stats = computeStats(tk);
    S.overDirty = true;
    renderTakes();
    if (tk === S.sel) renderResult();
  }

  /** お手本と声の出だし・音程が最も合うように補正値を探す */
  function autoAlign() {
    const tk = S.sel;
    if (!tk || !tk.track) return;
    let best = -Infinity, bestC = tk.comp;
    for (let c = 0; c <= 0.5001; c += 0.005) {
      let sc = 0;
      for (let t = tk.range[0]; t < tk.range[1]; t += 0.02) {
        const rm = Pitch.trackAt(S.track, t);
        const um = Pitch.trackAt(tk.track, t - tk.recStartSong + c);
        const rv = !isNaN(rm), uv = !isNaN(um);
        if (rv && uv) {
          sc += 1;
          let d = Math.abs(um - rm) * 100;
          if (fold()) d = Math.abs(Pitch.foldCents(d));
          if (d < 100) sc += 1;
        } else if (rv !== uv) sc -= 1;
      }
      if (sc > best) { best = sc; bestC = c; }
    }
    tk.comp = bestC;
    el.latency.value = Math.round(bestC * 1000);
    el.latency.dispatchEvent(new Event('change'));
    updateLatencyLabel();
    refreshTake(tk);
    UI.toast(`補正値を ${Math.round(bestC * 1000)}ms にしました`);
  }

  function renderAll() {
    S.overDirty = true;
    renderTakes();
    renderResult();
    updateButtons();
  }

  function renderResult() {
    const tk = S.sel;
    if (!tk) {
      el.result.innerHTML = '<p class="muted">「● 歌って録音」で歌うと、ここに結果が出ます。テイクを選ぶと結果を見返せます。</p>';
      return;
    }
    if (!tk.stats) { el.result.innerHTML = '<p class="muted">解析中…</p>'; return; }
    const s = tk.stats;
    if (!s.nRef) { el.result.innerHTML = '<p class="muted">この区間にはお手本の歌声がありません。</p>'; return; }
    const pct = x => Math.round(x * 100) + '%';
    let bias;
    if (Math.abs(s.bias) < 15) bias = '偏りは小さい';
    else bias = (s.bias > 0 ? '高め' : '低め') + `（${UI.fmtCents(s.bias)}）`;
    const advice = [];
    if (s.sung < 0.6) advice.push('お手本が歌っている所で、声が出ていない（または検出できていない）部分が多めです。マイクの感度や距離も確認してください。');
    if (s.bias <= -20) advice.push('全体的に低めになりがちです。「少し高いかな」と思うくらいを意識してみましょう。');
    if (s.bias >= 20) advice.push('全体的に高めになりがちです。力まず、少し低めを意識してみましょう。');
    if (s.accuracy < 0.4) advice.push('区間を短く（1フレーズ）して、ガイド音をONにしてくり返すのがおすすめです。');
    else if (s.accuracy < 0.7) advice.push('グラフの赤・黄色の部分を区間指定して、重点的に練習してみましょう。');
    else advice.push('いい感じです！区間を広げたり、ガイド音をOFFにして挑戦してみましょう。');
    el.result.innerHTML = `
      <div class="score"><b>${s.score}</b><span>点</span></div>
      <div class="stat"><span>音程が合っていた割合（±50¢以内）</span><b>${pct(s.hit)}</b></div>
      <div class="stat"><span>声が出ていた割合</span><b>${pct(s.sung)}</b></div>
      <div class="stat"><span>声が出ていた所の正確さ</span><b>${pct(s.accuracy)}</b></div>
      <div class="stat"><span>平均のずれ</span><b>${Math.round(s.meanAbs)}¢</b></div>
      <div class="stat"><span>高さの傾向</span><b>${bias}</b></div>
      <p class="advice">${advice.join('<br>')}</p>`;
  }

  function renderTakes() {
    el.takes.innerHTML = '';
    if (!S.takes.length) { el.takes.innerHTML = '<li class="muted">まだ録音がありません</li>'; return; }
    for (const tk of S.takes) {
      const li = document.createElement('li');
      li.className = tk === S.sel ? 'sel' : '';
      li.innerHTML = `<span class="tname">テイク${tk.id}</span>
        <span class="trange">${UI.fmtTime(tk.range[0])}〜${UI.fmtTime(tk.range[1])}</span>
        <span class="tscore">${tk.stats ? tk.stats.score + '点' : '解析中'}</span>`;
      const bPlay = mkBtn('▶', '原曲と重ねて再生', () => {
        S.sel = tk; renderAll(); S.pos = tk.range[0]; play(false);
      });
      const bDl = mkBtn('⬇', 'WAVで保存', () => UI.download(Engine.encodeWav(tk.samples, tk.sr), `karaokay_take${tk.id}.wav`));
      const bDel = mkBtn('✕', '削除', () => {
        S.takes = S.takes.filter(x => x !== tk);
        if (S.sel === tk) S.sel = null;
        renderAll();
      });
      li.append(bPlay, bDl, bDel);
      li.addEventListener('click', e => {
        if (e.target.closest('button')) return;
        S.sel = S.sel === tk ? null : tk;
        if (S.sel) {
          if (S.state === 'idle') S.pos = tk.range[0];
          el.latency.value = Math.round(tk.comp * 1000);
          updateLatencyLabel();
        }
        renderAll();
        restartIfPlaying();
      });
      el.takes.appendChild(li);
    }
  }
  function mkBtn(txt, title, fn) {
    const b = document.createElement('button');
    b.className = 'btn small';
    b.textContent = txt;
    b.title = title;
    b.addEventListener('click', e => { e.stopPropagation(); fn(); });
    return b;
  }

  // ---------- 毎フレームの処理 ----------
  function frame() {
    const live = Engine.live;
    if (S.state !== 'idle') {
      const p = curPos();
      if (p >= S.end) {
        if (S.state === 'rec') finishRecording();
        else if (el.loopRepeat.checked && S.loop) { S.pos = S.loop.a; play(false); }
        else { stopNodes(); S.state = 'idle'; S.pos = S.scoreFrom; updateButtons(); }
      } else {
        if (S.nodes && S.nodes.guide) {
          const rm = Pitch.trackAt(S.track, p);
          const t = Engine.now();
          const g = S.nodes.guide;
          if (!isNaN(rm)) {
            g.o.frequency.setTargetAtTime(Pitch.midiToFreq(rm), t, 0.012);
            g.g.gain.setTargetAtTime(+el.volGuide.value, t, 0.02);
          } else g.g.gain.setTargetAtTime(0, t, 0.03);
        }
        if (!isNaN(live.midi) && p > S.from + 0.05) S.livePts.push({ t: p - comp() - 0.021, m: live.midi });
      }
    }
    draw();
    updateMeter(live);
    el.time.textContent = `${UI.fmtTime(curPos())} / ${UI.fmtTime(S.duration)}`;
  }

  function updateMeter(live) {
    const p = curPos();
    const rm = S.track ? Pitch.trackAt(S.track, p) : NaN;
    el.tNote.textContent = Pitch.noteName(rm);
    el.yNote.textContent = Pitch.noteName(live.midi);
    if (!isNaN(rm) && !isNaN(live.midi)) {
      let c = (live.midi - rm) * 100;
      if (fold()) c = Pitch.foldCents(c);
      el.diff.textContent = UI.fmtCents(c) + (Math.abs(c) <= 50 ? '  OK' : c > 0 ? '  高い' : '  低い');
      el.diff.style.color = UI.devColor(c);
    } else el.diff.textContent = '';
  }

  // ---------- 描画 ----------
  function dispUser(um, rm, st) {
    if (fold() && !isNaN(rm)) st.shift = 12 * Math.round((rm - um) / 12);
    return um + (fold() ? st.shift : 0);
  }

  function draw() {
    drawRoll();
    drawOverview();
  }

  function drawRoll() {
    const { g, w, h } = UI.fit(el.roll);
    const lo = S.lo, hi = S.hi;
    UI.drawGrid(g, GUTTER, w, h, lo, hi);
    if (!S.buffer) {
      g.fillStyle = '#8a90b0';
      g.font = '16px "Segoe UI", sans-serif';
      g.textAlign = 'center';
      g.fillText('ボーカル抽出した音源ファイルをドロップしてください', (w + GUTTER) / 2, h / 2);
      g.textAlign = 'left';
      return;
    }
    const view = +el.viewSec.value;
    const cur = curPos();
    const t0 = cur - view * 0.3, t1 = t0 + view;
    const X = t => GUTTER + ((t - t0) / view) * (w - GUTTER);
    const Y = m => UI.yOf(m, lo, hi, h);
    const rh = h / (hi - lo + 1);

    g.save();
    g.beginPath();
    g.rect(GUTTER, 0, w - GUTTER, h);
    g.clip();

    if (S.loop) { g.fillStyle = UI.C.loop; g.fillRect(X(S.loop.a), 0, X(S.loop.b) - X(S.loop.a), h); }

    // お手本
    if (S.track) {
      const tr = S.track;
      g.strokeStyle = UI.C.ref;
      g.lineWidth = Math.max(4, Math.min(14, rh * 0.75));
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.beginPath();
      let prev = NaN;
      const i0 = Math.max(0, Math.floor((t0 - tr.t0) / tr.hop)), i1 = Math.min(tr.data.length - 1, Math.ceil((t1 - tr.t0) / tr.hop));
      for (let i = i0; i <= i1; i++) {
        const m = tr.data[i];
        const x = X(tr.t0 + i * tr.hop);
        if (isNaN(m)) { prev = NaN; continue; }
        if (isNaN(prev) || Math.abs(m - prev) > 1.5) g.moveTo(x, Y(m)); else g.lineTo(x, Y(m));
        prev = m;
      }
      g.stroke();
    }

    // 自分の声
    g.lineWidth = 2.5;
    g.lineCap = 'round';
    const st = { shift: 0 };
    let pm = NaN, px = 0, py = 0;
    const seg = (t, um) => {
      if (isNaN(um)) { pm = NaN; return; }
      const rm = S.track ? Pitch.trackAt(S.track, t) : NaN;
      const m = dispUser(um, rm, st);
      const x = X(t), y = Y(m);
      if (!isNaN(pm) && Math.abs(m - pm) < 1.5) {
        let col = UI.C.you;
        if (!isNaN(rm)) { let c = (um - rm) * 100; if (fold()) c = Pitch.foldCents(c); col = UI.devColor(c); }
        g.strokeStyle = col;
        g.beginPath(); g.moveTo(px, py); g.lineTo(x, y); g.stroke();
      }
      pm = m; px = x; py = y;
    };
    const tk = S.sel;
    if (tk && tk.track) {
      const a = Math.max(t0, tk.range[0] - 0.5), b = Math.min(t1, tk.range[1]);
      const hop = tk.track.hop;
      for (let t = a; t <= b; t += hop) seg(t, userAt(tk, t));
    } else {
      const pts = tk ? tk.live : S.livePts;
      let lastT = -1;
      for (const p of pts) {
        if (p.t < t0 - 0.1 || p.t > t1) continue;
        if (p.t - lastT > 0.08) pm = NaN;
        seg(p.t, p.m);
        lastT = p.t;
      }
    }
    // 今の声（右側に点で表示）
    const live = Engine.live;
    if (S.state !== 'idle' && !isNaN(live.midi)) {
      const t = cur - comp();
      const rm = S.track ? Pitch.trackAt(S.track, t) : NaN;
      const m = dispUser(live.midi, rm, { shift: fold() && !isNaN(rm) ? 0 : st.shift });
      g.fillStyle = '#fff';
      g.beginPath(); g.arc(X(t), Y(m), 5, 0, Math.PI * 2); g.fill();
    }

    // 再生位置
    g.fillStyle = S.state === 'rec' ? '#ef4444' : UI.C.head;
    g.fillRect(X(cur) - 1, 0, 2, h);
    g.restore();
  }

  const overT = x => clamp((x / Math.max(1, el.over.clientWidth)) * S.duration, 0, S.duration);

  function drawOverview() {
    const { g, w, h, resized } = UI.fit(el.over);
    g.fillStyle = UI.C.bg;
    g.fillRect(0, 0, w, h);
    if (!S.buffer) return;
    const dpr = window.devicePixelRatio || 1;
    if (resized || S.overDirty || !overCache) {
      S.overDirty = false;
      overCache = overCache || document.createElement('canvas');
      overCache.width = el.over.width;
      overCache.height = el.over.height;
      const c = overCache.getContext('2d');
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.fillStyle = UI.C.bg;
      c.fillRect(0, 0, w, h);
      const lo = S.lo, hi = S.hi;
      const X = t => (t / S.duration) * w;
      const Y = m => UI.yOf(m, lo, hi, h);
      if (S.track) {
        const tr = S.track;
        c.fillStyle = UI.C.refThin;
        const step = Math.max(1, Math.floor(tr.data.length / (w * 2)));
        for (let i = 0; i < tr.data.length; i += step) {
          const m = tr.data[i];
          if (!isNaN(m)) c.fillRect(X(tr.t0 + i * tr.hop), Y(m) - 1, 1.2, 2);
        }
      }
      const tk = S.sel;
      if (tk && tk.track && S.track) {
        const st = { shift: 0 };
        const dt = Math.max(tk.track.hop, S.duration / (w * 2));
        for (let t = tk.range[0]; t < tk.range[1]; t += dt) {
          const um = userAt(tk, t);
          if (isNaN(um)) continue;
          const rm = Pitch.trackAt(S.track, t);
          let col = UI.C.you;
          if (!isNaN(rm)) { let cc = (um - rm) * 100; if (fold()) cc = Pitch.foldCents(cc); col = UI.devColor(cc); }
          c.fillStyle = col;
          c.fillRect(X(t), Y(dispUser(um, rm, st)) - 1, 1.2, 2);
        }
      }
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(overCache, 0, 0);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const X = t => (t / S.duration) * w;
    const lp = overDrag && overDrag.moved ? { a: Math.min(overDrag.t0, overDrag.t1), b: Math.max(overDrag.t0, overDrag.t1) } : S.loop;
    if (lp) {
      g.fillStyle = 'rgba(124,140,255,0.22)';
      g.fillRect(X(lp.a), 0, X(lp.b) - X(lp.a), h);
      g.fillStyle = '#7c8cff';
      g.fillRect(X(lp.a) - 1, 0, 2, h);
      g.fillRect(X(lp.b) - 1, 0, 2, h);
    }
    // 表示中の範囲
    const view = +el.viewSec.value, cur = curPos();
    g.strokeStyle = 'rgba(255,255,255,0.25)';
    g.strokeRect(X(cur - view * 0.3) + 0.5, 0.5, Math.max(2, X(view) - 1), h - 1);
    g.fillStyle = S.state === 'rec' ? '#ef4444' : '#fff';
    g.fillRect(X(cur) - 1, 0, 2, h);
  }

  function onKey(e) {
    if (e.code === 'Space') { e.preventDefault(); if (S.state === 'rec') finishRecording(); else togglePlay(); }
    else if (e.code === 'KeyR') { e.preventDefault(); toggleRec(); }
    else if (e.code === 'Escape') stop();
    else if (e.code === 'Home') seek(S.loop ? S.loop.a : 0);
  }

  function deactivate() {
    if (S.state === 'rec') finishRecording();
    else if (S.state === 'play') pause();
  }

  return { init, frame, onKey, deactivate, loadFile, _state: S };
})();

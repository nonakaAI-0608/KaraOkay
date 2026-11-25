'use strict';
/* アプリ全体：タブ・マイク・設定の保存・描画ループ */
const App = (() => {
  const KEY = 'karaokay.settings.v1';
  const $ = id => document.getElementById(id);
  let active = 'song';

  function loadSettings() {
    let s = {};
    try { s = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { s = {}; }
    document.querySelectorAll('[data-persist]').forEach(e => {
      if (!(e.id in s)) return;
      if (e.type === 'checkbox') e.checked = !!s[e.id];
      else e.value = s[e.id];
    });
    return s;
  }
  function saveSettings() {
    const o = {};
    document.querySelectorAll('[data-persist]').forEach(e => { o[e.id] = e.type === 'checkbox' ? e.checked : e.value; });
    try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) { /* noop */ }
  }

  async function refreshDevices() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    const sel = $('micSelect');
    const cur = sel.value;
    const devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput');
    sel.innerHTML = '<option value="">既定のマイク</option>';
    devs.forEach((d, i) => { if (d.deviceId && d.deviceId !== 'default') sel.add(new Option(d.label || `マイク ${i + 1}`, d.deviceId)); });
    if ([...sel.options].some(o => o.value === cur)) sel.value = cur;
  }

  async function startMic() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      UI.toast('このブラウザではマイクを使えません。Chrome / Edge でお試しください');
      return false;
    }
    try {
      await Engine.startMic($('micSelect').value, $('optEcho').checked);
    } catch (e) {
      // 保存していたマイクが見つからない場合は既定のマイクで再試行
      if ($('micSelect').value) {
        $('micSelect').value = '';
        return startMic();
      }
      UI.toast('マイクを使用できません：' + (e.message || e.name));
      return false;
    }
    $('micBtn').textContent = '🎙 マイクOFF';
    $('micBtn').classList.add('primary');
    refreshDevices();
    return true;
  }
  function stopMic() {
    Engine.stopMic();
    $('micBtn').textContent = '🎙 マイクON';
    $('micBtn').classList.remove('primary');
  }
  async function ensureMic() { return Engine.micOn() ? true : startMic(); }

  function switchTab(name) {
    if (name === active) return;
    if (active === 'song') Song.deactivate(); else Keys.deactivate();
    active = name;
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    document.querySelectorAll('.tabpage').forEach(p => p.classList.toggle('active', p.id === 'tab-' + name));
  }

  function loop() {
    Engine.updateLive();
    $('levelBar').style.width = Math.min(100, Engine.live.rms * 500) + '%';
    try {
      if (active === 'song') Song.frame(); else Keys.frame();
    } catch (e) { console.error(e); }
    requestAnimationFrame(loop);
  }

  function init() {
    Song.init();
    Keys.init();
    loadSettings();
    // 設定値の反映
    Pitch.setNotation($('optNotation').value);
    Engine.setGate(+$('optGate').value);
    $('latencyLabel').textContent = $('latency').value + 'ms';
    $('kTol').dispatchEvent(new Event('change'));

    document.addEventListener('change', e => { if (e.target.matches('[data-persist]')) saveSettings(); });
    document.addEventListener('input', e => { if (e.target.matches('input[type=range][data-persist]')) saveSettings(); });

    document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));
    $('micBtn').addEventListener('click', () => (Engine.micOn() ? stopMic() : startMic()));
    $('micSelect').addEventListener('change', () => { if (Engine.micOn()) startMic(); });
    $('optEcho').addEventListener('change', () => { if (Engine.micOn()) startMic(); });
    $('optGate').addEventListener('input', e => Engine.setGate(+e.target.value));
    $('optNotation').addEventListener('change', e => Pitch.setNotation(e.target.value));
    $('settingsBtn').addEventListener('click', () => $('settingsPanel').classList.toggle('hidden'));

    document.addEventListener('keydown', e => {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' && t.type !== 'range' && t.type !== 'checkbox' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
      if (active === 'song') Song.onKey(e); else Keys.onKey(e);
    });
    // ブラウザの自動再生制限対策：最初の操作でAudioContextを起こす
    document.addEventListener('pointerdown', () => Engine.ensure(), { once: true });
    document.addEventListener('keydown', () => Engine.ensure(), { once: true });

    // 初回は遅延の目安を補正値の初期値にする
    try {
      if (!localStorage.getItem(KEY)) {
        document.addEventListener('pointerdown', () => {
          const v = Math.round(Engine.latencyEstimate() * 1000 / 5) * 5;
          $('latency').value = Math.max(0, Math.min(500, v));
          $('latencyLabel').textContent = $('latency').value + 'ms';
        }, { once: true });
      }
    } catch (e) { /* noop */ }

    refreshDevices();
    requestAnimationFrame(loop);
  }

  document.addEventListener('DOMContentLoaded', init);
  return { ensureMic, startMic, stopMic };
})();

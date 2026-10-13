// In-game chat for the host: type a change and Claude Code applies it to the game.
// Only appears for whoever opened the game with the host key (?key=...), which is then
// remembered in this browser. Other players never see it.
(function () {
  'use strict';
  var STORE = 'hhpd-host-key';
  var params = new URLSearchParams(location.search), key = params.get('key');
  try {
    if (key) { localStorage.setItem(STORE, key); params.delete('key'); history.replaceState(null, '', location.pathname + (params.toString() ? '?' + params : '') + location.hash); }
    else key = localStorage.getItem(STORE);
  } catch (e) {}
  if (!key) return;

  var host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:0;bottom:0;z-index:2147483000;';
  var root = host.attachShadow({ mode: 'open' });
  root.innerHTML = '<style>' +
    ':host{all:initial}' +
    '*{box-sizing:border-box;font:15px/1.4 system-ui,sans-serif}' +
    '.btn{position:fixed;left:14px;bottom:14px;width:54px;height:54px;border-radius:50%;border:3px solid #fff;background:#b44fd1;color:#fff;font-size:26px;cursor:pointer;box-shadow:0 4px 14px rgba(60,20,90,.35);display:flex;align-items:center;justify-content:center}' +
    '.btn.busy{animation:p 1.2s ease-in-out infinite}' +
    '@keyframes p{50%{transform:scale(1.1);box-shadow:0 0 0 8px rgba(180,79,209,.25)}}' +
    '.panel{position:fixed;left:14px;bottom:80px;width:min(360px,calc(100vw - 28px));height:min(440px,calc(100vh - 110px));background:rgba(255,250,255,.97);color:#2b1a3a;border-radius:18px;box-shadow:0 10px 30px rgba(60,20,90,.35);display:flex;flex-direction:column;overflow:hidden}' +
    '.panel[hidden]{display:none}' +
    '.head{padding:10px 14px;background:#b44fd1;color:#fff;font-weight:700;display:flex;justify-content:space-between;align-items:center}' +
    '.head small{font-weight:400;opacity:.85;font-size:12px}' +
    '.x{background:none;border:0;color:#fff;font-size:20px;cursor:pointer;padding:0 4px}' +
    '.log{flex:1;overflow-y:auto;padding:10px 12px;display:flex;flex-direction:column;gap:6px}' +
    '.m{max-width:88%;padding:7px 11px;border-radius:14px;white-space:pre-wrap;word-break:break-word}' +
    '.request{align-self:flex-end;background:#b44fd1;color:#fff;border-bottom-right-radius:4px}' +
    '.claude{align-self:flex-start;background:#efe3f7;border-bottom-left-radius:4px}' +
    '.tool,.info{align-self:flex-start;color:#7a6a8a;font-size:12px;padding:0 4px}' +
    '.done{align-self:flex-start;color:#2e8a5a;font-weight:600;font-size:13px;padding:0 4px}' +
    '.error{align-self:flex-start;background:#fde8e7;color:#a12a26;border-bottom-left-radius:4px;font-size:13px}' +
    'form{display:flex;gap:6px;padding:8px;border-top:1px solid #ead9f5}' +
    'textarea{flex:1;resize:none;height:44px;padding:8px 10px;border:1px solid #d9c3ea;border-radius:12px;background:#fff;color:#2b1a3a}' +
    '.send{border:0;border-radius:12px;background:#b44fd1;color:#fff;font-weight:700;padding:0 14px;cursor:pointer}' +
    '</style>' +
    '<button class="btn" aria-label="Ask Claude to change the game">✨</button>' +
    '<div class="panel" hidden><div class="head"><div>Change the game<br><small class="st">Connecting…</small></div><button class="x" aria-label="Close">×</button></div>' +
    '<div class="log"></div><form><textarea placeholder="e.g. make the gems sparkle more"></textarea><button class="send">Send</button></form></div>';
  document.documentElement.appendChild(host);

  var $ = function (s) { return root.querySelector(s); };
  var btn = $('.btn'), panel = $('.panel'), log = $('.log'), st = $('.st'), ta = $('textarea');
  var stop = function (e) { e.stopPropagation(); };
  // Keep taps and typing in the chat from steering the unicorn.
  ['pointerdown', 'pointermove', 'pointerup', 'click', 'keydown', 'keyup'].forEach(function (t) { host.addEventListener(t, stop); });
  function setOpen(o) { panel.hidden = !o; try { sessionStorage.setItem('hhpd-chat-open', o ? '1' : ''); } catch (e) {} if (o) { ta.focus(); log.scrollTop = log.scrollHeight; } }
  btn.onclick = function () { setOpen(panel.hidden); };
  $('.x').onclick = function () { setOpen(false); };
  try { if (sessionStorage.getItem('hhpd-chat-open')) setOpen(true); } catch (e) {}

  var ws;
  function connect() {
    ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/hostws?key=' + encodeURIComponent(key));
    ws.onopen = function () { log.innerHTML = ''; };
    ws.onmessage = function (e) {
      var m = JSON.parse(e.data);
      if (m.t === 'log') {
        var d = document.createElement('div'); d.className = 'm ' + m.kind; d.textContent = m.text;
        var stick = log.scrollTop + log.clientHeight >= log.scrollHeight - 30;
        log.appendChild(d); if (stick) log.scrollTop = log.scrollHeight;
      } else if (m.t === 'status') {
        btn.classList.toggle('busy', m.busy);
        st.textContent = (m.busy ? 'Claude is working on it' + (m.queued.length ? ', ' + m.queued.length + ' waiting' : '') : 'Ready') +
          ' · ' + m.players + ' playing';
      }
    };
    ws.onclose = function () {
      st.textContent = 'Reconnecting…';
      // If the server says the key is wrong (e.g. it restarted with a new one), forget it and hide the chat.
      fetch('/host?key=' + encodeURIComponent(key), { cache: 'no-store' }).then(function (r) {
        if (r.status === 403) { try { localStorage.removeItem(STORE); } catch (er) {} host.remove(); }
        else setTimeout(connect, 1500);
      }, function () { setTimeout(connect, 1500); });
    };
  }
  connect();

  $('form').onsubmit = function (e) {
    e.preventDefault();
    var text = ta.value.trim(); if (!text || ws.readyState !== 1) return;
    ws.send(JSON.stringify({ t: 'request', text: text })); ta.value = '';
  };
  ta.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('form').requestSubmit(); } });
})();

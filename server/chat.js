// In-game chat for the host: type a change and Claude Code applies it to the game.
// The sparkle button shows for everyone, but the chat only opens with the host password,
// which is then remembered in this browser.
(function () {
  'use strict';
  var STORE = 'hhpd-host-pw', pw = null;
  try { localStorage.removeItem('hhpd-host-key'); pw = localStorage.getItem(STORE); } catch (e) {}

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
    '.login{flex:1;display:flex;flex-direction:column;justify-content:center;gap:10px;padding:20px}' +
    '.login[hidden],.chat[hidden]{display:none}' +
    '.chat{flex:1;display:flex;flex-direction:column;min-height:0}' +
    '.login input{padding:10px 12px;border:1px solid #d9c3ea;border-radius:12px;font-size:18px;letter-spacing:2px;text-align:center;background:#fff;color:#2b1a3a}' +
    '.login .send{padding:10px}' +
    '.msg{color:#a12a26;font-size:13px;text-align:center;min-height:18px}' +
    '.send{border:0;border-radius:12px;background:#b44fd1;color:#fff;font-weight:700;padding:0 14px;cursor:pointer}' +
    '</style>' +
    '<button class="btn" aria-label="Ask Claude to change the game">✨</button>' +
    '<div class="panel" hidden><div class="head"><div>Change the game<br><small class="st">Connecting…</small></div><button class="x" aria-label="Close">×</button></div>' +
    '<form class="login"><div>Grown-ups only: type the password to change the game.</div><input type="password" inputmode="numeric" autocomplete="current-password" aria-label="Password"><button class="send">Unlock</button><div class="msg"></div></form>' +
    '<div class="chat" hidden><div class="log"></div><form class="ask"><textarea placeholder="e.g. make the gems sparkle more"></textarea><button class="send">Send</button></form></div></div>';
  document.documentElement.appendChild(host);

  var $ = function (s) { return root.querySelector(s); };
  var btn = $('.btn'), panel = $('.panel'), log = $('.log'), st = $('.st'), ta = $('textarea');
  var login = $('.login'), chat = $('.chat'), pwIn = $('.login input'), msg = $('.msg');
  function showLogin(note) { login.hidden = false; chat.hidden = true; msg.textContent = note || ''; st.textContent = 'Locked'; pwIn.value = ''; if (!panel.hidden) pwIn.focus(); }
  function showChat() { login.hidden = true; chat.hidden = false; }
  var stop = function (e) { e.stopPropagation(); };
  // Keep taps and typing in the chat from steering the unicorn.
  ['pointerdown', 'pointermove', 'pointerup', 'click', 'keydown', 'keyup'].forEach(function (t) { host.addEventListener(t, stop); });
  function setOpen(o) { panel.hidden = !o; try { sessionStorage.setItem('hhpd-chat-open', o ? '1' : ''); } catch (e) {} if (o) { (chat.hidden ? pwIn : ta).focus(); log.scrollTop = log.scrollHeight; } }
  btn.onclick = function () { setOpen(panel.hidden); };
  $('.x').onclick = function () { setOpen(false); };
  try { if (sessionStorage.getItem('hhpd-chat-open')) setOpen(true); } catch (e) {}

  var ws = null;
  function connect() {
    if (!pw) return showLogin();
    ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/hostws?pw=' + encodeURIComponent(pw));
    ws.onopen = function () { log.innerHTML = ''; showChat(); };
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
      ws = null; st.textContent = 'Reconnecting…';
      check(pw, function (r) { if (r === 'ok' || r === 'offline') setTimeout(connect, 1500); else forget(r); });
    };
  }
  function check(p, cb) {
    fetch('/hostcheck?pw=' + encodeURIComponent(p), { cache: 'no-store' }).then(function (r) {
      cb(r.status === 204 ? 'ok' : r.status === 429 ? 'locked' : 'wrong');
    }, function () { cb('offline'); });
  }
  function forget(r) {
    pw = null; try { localStorage.removeItem(STORE); } catch (e) {}
    showLogin(r === 'locked' ? 'Too many tries. Wait a few minutes.' : 'That password did not work.');
  }
  login.onsubmit = function (e) {
    e.preventDefault();
    var p = pwIn.value.trim(); if (!p) return;
    msg.textContent = 'Checking…';
    check(p, function (r) {
      if (r === 'ok') { pw = p; try { localStorage.setItem(STORE, p); } catch (er) {} msg.textContent = ''; connect(); }
      else if (r === 'offline') msg.textContent = 'Can\'t reach the game server.';
      else forget(r);
    });
  };
  connect();

  $('.ask').onsubmit = function (e) {
    e.preventDefault();
    var text = ta.value.trim(); if (!text || !ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify({ t: 'request', text: text })); ta.value = '';
  };
  ta.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('.ask').requestSubmit(); } });
})();

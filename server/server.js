// Local play server for Lia's Phoenix Jewels.
// - serves the game (index.html) and live-reloads every browser when game files change
// - relays player positions so everyone in the same land sees each other
// - gives the host a page to type change requests that Claude Code applies to the game
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, execSync } = require('child_process');
const { WebSocketServer } = require('ws');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT) || 8080;
const HOST_KEY = process.env.HOST_KEY || crypto.randomBytes(6).toString('hex');

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' };

// Injected into every HTML page we serve: turns on multiplayer and live reload.
const INJECT = `<script>window.__LIVE__ = true;
(function () {
  var proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
  function connect() {
    var ws = new WebSocket(proto + location.host + '/live');
    ws.onmessage = function (e) { if (e.data === 'reload') location.reload(); };
    ws.onclose = function () { setTimeout(connect, 1500); };
  }
  connect();
})();</script>`;

const hostPage = fs.readFileSync(path.join(__dirname, 'host.html'), 'utf8');

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/host') {
    if (url.searchParams.get('key') !== HOST_KEY) { res.writeHead(403); return res.end('Host key required.'); }
    res.writeHead(200, { 'Content-Type': TYPES['.html'], 'Cache-Control': 'no-store' });
    return res.end(hostPage);
  }
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.resolve(ROOT, '.' + rel);
  if (!file.startsWith(ROOT + path.sep) || /[\\/](\.git|server|node_modules)([\\/]|$)/.test(file.slice(ROOT.length))) {
    res.writeHead(404); return res.end('Not found');
  }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    if (ext === '.html') {
      const html = data.toString('utf8');
      const i = html.search(/<head[^>]*>/i);
      return res.end(i < 0 ? INJECT + html : html.replace(/<head[^>]*>/i, m => m + INJECT));
    }
    res.end(data);
  });
});

/* ---------- WebSockets ---------- */
const live = new WebSocketServer({ noServer: true });
const play = new WebSocketServer({ noServer: true });
const host = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, sock, head) => {
  const url = new URL(req.url, 'http://x');
  const wss = url.pathname === '/live' ? live : url.pathname === '/play' ? play
    : url.pathname === '/hostws' && url.searchParams.get('key') === HOST_KEY ? host : null;
  if (!wss) return sock.destroy();
  wss.handleUpgrade(req, sock, head, ws => wss.emit('connection', ws, req));
});
const send = (ws, msg) => { if (ws.readyState === 1) ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg)); };

// Players: each socket gets an id; state is whatever the game reports (land, positions, look).
let nextId = 1;
const players = new Map(); // ws -> { id, state }
play.on('connection', ws => {
  const me = { id: nextId++, state: null };
  players.set(ws, me);
  send(ws, { t: 'hello', id: me.id });
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (m.t !== 'state' || typeof m.s !== 'object' || raw.length > 2000) return;
    me.state = m.s;
    for (const [other] of players) if (other !== ws) send(other, { t: 'state', id: me.id, s: me.state });
  });
  ws.on('close', () => {
    players.delete(ws);
    for (const [other] of players) send(other, { t: 'gone', id: me.id });
  });
});

/* ---------- Live reload ---------- */
let reloadTimer = null, pendingReload = null;
function scheduleReload(why) {
  // While Claude is mid-change, wait and reload once at the end so nobody sees a half-finished edit.
  if (busy) { pendingReload = why; return; }
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => {
    console.log(`[reload] ${why}`);
    for (const ws of live.clients) send(ws, 'reload');
    hostLog(`Game files changed (${why}). Reloading everyone's browser.`);
  }, 300);
}
fs.watch(ROOT, { recursive: true }, (ev, name) => {
  if (!name || /^(\.git|server|node_modules)([\\/]|$)/.test(name)) return;
  if (!/\.(html|js|css|png|jpg|svg|json|mp3|wav)$/i.test(name)) return;
  scheduleReload(name);
});

/* ---------- Host change requests (Claude Code CLI) ---------- */
function findClaude() {
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN;
  try { return execSync(process.platform === 'win32' ? 'where claude' : 'command -v claude', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().split(/\r?\n/)[0].trim(); } catch (e) {}
  // The Claude desktop app keeps its own copy of Claude Code here on Windows.
  const base = path.join(process.env.APPDATA || '', 'Claude', 'claude-code');
  try {
    const found = [];
    for (const v of fs.readdirSync(base)) for (const h of fs.readdirSync(path.join(base, v))) {
      const exe = path.join(base, v, h, 'claude.exe');
      if (fs.existsSync(exe)) found.push({ exe, t: fs.statSync(exe).mtimeMs });
    }
    found.sort((a, b) => b.t - a.t);
    if (found[0]) return found[0].exe;
  } catch (e) {}
  return 'claude';
}
const CLAUDE = findClaude();

const history = []; // recent host log lines, replayed to a newly opened host page
function hostLog(text, kind = 'info') {
  const line = { t: 'log', kind, text, at: Date.now() };
  history.push(line); if (history.length > 300) history.shift();
  for (const ws of host.clients) send(ws, line);
}
const queue = [];
let busy = null;
function hostStatus() {
  const s = { t: 'status', busy: !!busy, current: busy && busy.text, queued: queue.map(q => q.text), players: players.size };
  for (const ws of host.clients) send(ws, s);
}

const BRIEF = `You are editing a children's browser game for a 6-year-old named Lia, in the current folder.
The whole game is index.html (one self-contained file). Make the change the host asks for directly in the files, keep it gentle and kid-friendly,
and keep the game working: don't break the multiplayer block (search "Multiplayer") or the save data. Don't run git commands. Keep your final message to one or two short sentences saying what you changed.

The host asks: `;

function runNext() {
  if (busy || !queue.length) return hostStatus();
  busy = queue.shift(); hostStatus();
  hostLog(busy.text, 'request');
  const args = ['-p', BRIEF + busy.text, '--output-format', 'stream-json', '--verbose',
    '--permission-mode', 'acceptEdits', '--allowedTools', 'Read,Edit,Write,Glob,Grep'];
  let child;
  try { child = spawn(CLAUDE, args, { cwd: ROOT, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { hostLog(`Couldn't start Claude Code: ${e.message}`, 'error'); busy = null; return runNext(); }
  let buf = '', errBuf = '';
  child.stdout.on('data', d => {
    buf += d; let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line) continue;
      let ev; try { ev = JSON.parse(line); } catch (e) { hostLog(line); continue; }
      if (ev.type === 'assistant' && ev.message && ev.message.content) {
        for (const c of ev.message.content) {
          if (c.type === 'text' && c.text.trim()) hostLog(c.text.trim(), 'claude');
          if (c.type === 'tool_use') hostLog(`${c.name} ${c.input && (c.input.file_path || c.input.pattern || '') || ''}`.trim(), 'tool');
        }
      } else if (ev.type === 'result') {
        hostLog(ev.is_error ? `Claude Code stopped: ${ev.result || ev.subtype}` : 'Done.', ev.is_error ? 'error' : 'done');
        if (ev.is_error && /authenticat|log ?in|OAuth/i.test(String(ev.result))) hostLog(`Claude Code needs signing in on this computer: run "${CLAUDE}" once in a terminal and type /login.`, 'error');
      }
    }
  });
  child.stderr.on('data', d => { errBuf += d; });
  child.on('error', e => { hostLog(`Couldn't start Claude Code (${CLAUDE}): ${e.message}`, 'error'); });
  child.on('close', code => {
    if (code) hostLog(`Claude Code exited with code ${code}. ${(errBuf || buf).replace(/\x1b\[[0-9;]*m/g, '').trim().slice(-600)}`, 'error');
    busy = null;
    if (pendingReload) { const why = pendingReload; pendingReload = null; scheduleReload(why); }
    runNext();
  });
}

host.on('connection', ws => {
  for (const l of history) send(ws, l);
  hostStatus();
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (m.t === 'request' && typeof m.text === 'string' && m.text.trim()) {
      queue.push({ text: m.text.trim().slice(0, 4000) }); runNext();
    }
  });
});
setInterval(hostStatus, 5000);

server.listen(PORT, () => {
  console.log(`\nLia's Phoenix Jewels is running.`);
  console.log(`  Play:  http://localhost:${PORT}/`);
  console.log(`  Host:  http://localhost:${PORT}/host?key=${HOST_KEY}   (keep this link private)`);
  console.log(`  Claude Code: ${CLAUDE}\n`);
});

// Local play server for Lia's games.
// - the hub at / lists every game in games.json; each game lives at /games/<slug>/
// - live-reloads only the browsers playing a game when that game's files change
// - relays player positions so everyone in the same land sees each other (Phoenix Jewels)
// - lets the host type requests that Claude Code applies: change the game being played, or make a new game
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, execSync } = require('child_process');
const { WebSocketServer } = require('ws');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT) || 8080;
const GAMES_FILE = path.join(ROOT, 'games.json');
// The host password unlocks the chat. It comes from HOST_PASSWORD or server/password.txt
// (kept out of git); without either, a random one is made up and printed at startup.
function readPassword() {
  if (process.env.HOST_PASSWORD) return process.env.HOST_PASSWORD;
  try { const p = fs.readFileSync(path.join(__dirname, 'password.txt'), 'utf8').trim(); if (p) return p; } catch (e) {}
  return crypto.randomBytes(4).toString('hex');
}
const PASSWORD = readPassword();
// Slow down guessing: each address gets 8 wrong tries per 10 minutes.
const fails = new Map();
function checkPassword(given, req) {
  const who = req.headers['cf-connecting-ip'] || req.socket.remoteAddress, now = Date.now();
  const f = fails.get(who) || { n: 0, since: now };
  if (now - f.since > 10 * 60e3) { f.n = 0; f.since = now; }
  if (f.n >= 8) return 'locked';
  const a = Buffer.from(String(given || '')), b = Buffer.from(PASSWORD);
  if (a.length === b.length && crypto.timingSafeEqual(a, b)) { fails.delete(who); return 'ok'; }
  f.n++; fails.set(who, f); return 'wrong';
}

/* ---------- The list of games ---------- */
// games.json: [{ slug, title, blurb, dir, file, color }]. dir is relative to this repo ("." for the root game).
function loadGames() {
  try { const g = JSON.parse(fs.readFileSync(GAMES_FILE, 'utf8')); return Array.isArray(g) ? g.filter(x => x && /^[a-z0-9-]+$/.test(x.slug || '')) : []; }
  catch (e) { return []; }
}
const gameDir = g => path.resolve(ROOT, g.dir || path.join('games', g.slug));
// Which game a changed file belongs to (the deepest matching folder wins; "." only owns files right in the root)
function gameForFile(rel) {
  rel = rel.replace(/\\/g, '/');
  const games = loadGames().sort((a, b) => (b.dir || '').length - (a.dir || '').length);
  for (const g of games) {
    const d = (g.dir || 'games/' + g.slug).replace(/\\/g, '/').replace(/\/$/, '');
    if (d === '.' ? !rel.includes('/') : rel.startsWith(d + '/')) return g;
  }
  return null;
}
const slugOfPage = p => { const m = /^\/games\/([a-z0-9-]+)\//.exec(p || ''); return m ? m[1] : null; };

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  '.gif': 'image/gif', '.webp': 'image/webp', '.ogg': 'audio/ogg' };

// Injected into every HTML page we serve: turns on multiplayer, live reload (for this page's game only) and the chat.
const INJECT = `<script>window.__LIVE__ = true;
(function () {
  var proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
  function connect() {
    var ws = new WebSocket(proto + location.host + '/live?page=' + encodeURIComponent(location.pathname));
    ws.onmessage = function (e) {
      if (e.data === 'reload') location.reload();
      else if (e.data === 'games') window.dispatchEvent(new Event('games-changed'));
    };
    ws.onclose = function () { setTimeout(connect, 1500); };
  }
  connect();
})();</script><script src="/__chat.js" defer></script>`;
const inject = html => { const i = html.search(/<head[^>]*>/i); return i < 0 ? INJECT + html : html.replace(/<head[^>]*>/i, m => m + INJECT); };

const hostPage = fs.readFileSync(path.join(__dirname, 'host.html'), 'utf8');
const hubPage = fs.readFileSync(path.join(__dirname, 'hub.html'), 'utf8');
const chatJs = fs.readFileSync(path.join(__dirname, 'chat.js'), 'utf8');

function sendFile(res, file) {
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(ext === '.html' ? inject(data.toString('utf8')) : data);
  });
}
const blocked = file => !file.startsWith(ROOT + path.sep) || /[\\/](\.git|server|node_modules)([\\/]|$)/.test(file.slice(ROOT.length));

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  if (p === '/hostcheck') {
    const r = checkPassword(url.searchParams.get('pw'), req);
    res.writeHead(r === 'ok' ? 204 : r === 'locked' ? 429 : 403, { 'Cache-Control': 'no-store' }); return res.end();
  }
  if (p === '/host') { res.writeHead(200, { 'Content-Type': TYPES['.html'], 'Cache-Control': 'no-store' }); return res.end(hostPage); }
  if (p === '/__chat.js') { res.writeHead(200, { 'Content-Type': TYPES['.js'], 'Cache-Control': 'no-store' }); return res.end(chatJs); }
  if (p === '/' || p === '/hub') { res.writeHead(200, { 'Content-Type': TYPES['.html'], 'Cache-Control': 'no-store' }); return res.end(inject(hubPage)); }
  if (p === '/games.json') {
    const list = loadGames().map(({ slug, title, blurb, color }) => ({ slug, title, blurb, color }));
    res.writeHead(200, { 'Content-Type': TYPES['.json'], 'Cache-Control': 'no-store' }); return res.end(JSON.stringify(list));
  }
  if (p === '/building') {
    res.writeHead(200, { 'Content-Type': TYPES['.json'], 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ count: [...running.values(), ...queue].filter(j => j.mode === 'new').length }));
  }
  // /games/<slug>/... is served from that game's folder
  const m = /^\/games\/([a-z0-9-]+)(\/.*)?$/.exec(p);
  if (m) {
    const g = loadGames().find(x => x.slug === m[1]);
    if (g) {
      if (!m[2]) { res.writeHead(301, { Location: `/games/${g.slug}/` }); return res.end(); }
      let rest = decodeURIComponent(m[2]).slice(1);
      if (!rest || rest.endsWith('/')) rest += rest ? 'index.html' : (g.file || 'index.html');
      const base = gameDir(g), file = path.resolve(base, rest);
      if (!file.startsWith(base) || blocked(file)) { res.writeHead(404); return res.end('Not found'); }
      return sendFile(res, file);
    }
  }
  let rel = decodeURIComponent(p);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.resolve(ROOT, '.' + rel);
  if (blocked(file)) { res.writeHead(404); return res.end('Not found'); }
  sendFile(res, file);
});

/* ---------- WebSockets ---------- */
const live = new WebSocketServer({ noServer: true });
const play = new WebSocketServer({ noServer: true });
const host = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, sock, head) => {
  const url = new URL(req.url, 'http://x');
  const wss = url.pathname === '/live' ? live : url.pathname === '/play' ? play
    : url.pathname === '/hostws' && checkPassword(url.searchParams.get('pw'), req) === 'ok' ? host : null;
  if (!wss) return sock.destroy();
  wss.handleUpgrade(req, sock, head, ws => { ws.page = url.searchParams.get('page') || '/'; wss.emit('connection', ws, req); });
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

/* ---------- Live reload, one game at a time ---------- */
const reloadTimers = new Map(), pendingReloads = new Set();
let gamesTimer = null;
function reloadGame(slug, why) {
  // While Claude is mid-change on this game, wait and reload once at the end so nobody sees a half-finished edit.
  if (running.has(slug)) { pendingReloads.add(slug); return; }
  clearTimeout(reloadTimers.get(slug));
  reloadTimers.set(slug, setTimeout(() => {
    let n = 0;
    for (const ws of live.clients) if (slugOfPage(ws.page) === slug) { send(ws, 'reload'); n++; }
    console.log(`[reload] ${slug} (${why}) for ${n} browser(s)`);
    if (n) hostLog(`${titleOf(slug)} changed. Reloading the ${n === 1 ? 'browser' : n + ' browsers'} playing it.`);
  }, 300));
}
fs.watch(ROOT, { recursive: true }, (ev, name) => {
  if (!name) return;
  const rel = name.replace(/\\/g, '/');
  if (/(^|\/)(\.git|node_modules)(\/|$)/.test(rel) || /^server\//.test(rel)) return;
  if (rel === 'games.json') { // the hub (and the chat) refresh their list of games
    clearTimeout(gamesTimer);
    gamesTimer = setTimeout(() => { for (const ws of live.clients) send(ws, 'games'); hostStatus(); }, 300);
    return;
  }
  if (!/\.(html|js|css|png|jpg|gif|webp|svg|json|mp3|wav|ogg)$/i.test(rel)) return;
  const g = gameForFile(rel);
  if (g) reloadGame(g.slug, rel);
});

/* ---------- Host requests (Claude Code CLI) ---------- */
function findClaude() {
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN;
  try { return execSync(process.platform === 'win32' ? 'where claude' : 'command -v claude', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().split(/\r?\n/)[0].trim(); } catch (e) {}
  // The Claude desktop app keeps its own copy of Claude Code on Windows. The Store/MSIX install
  // keeps it inside its package folder, which only looks like %APPDATA% from inside the app.
  const bases = [path.join(process.env.APPDATA || '', 'Claude', 'claude-code')];
  const pkgs = path.join(process.env.LOCALAPPDATA || '', 'Packages');
  try { for (const p of fs.readdirSync(pkgs)) if (/^Claude_/i.test(p)) bases.push(path.join(pkgs, p, 'LocalCache', 'Roaming', 'Claude', 'claude-code')); } catch (e) {}
  // Newer desktop app versions keep it in %LOCALAPPDATA%\Claude-Data\<id>\claude-code
  const data = path.join(process.env.LOCALAPPDATA || '', 'Claude-Data');
  try { for (const p of fs.readdirSync(data)) bases.push(path.join(data, p, 'claude-code')); } catch (e) {}
  const found = [];
  for (const base of bases) {
    try {
      for (const v of fs.readdirSync(base)) for (const h of fs.readdirSync(path.join(base, v))) {
        const exe = path.join(base, v, h, 'claude.exe');
        if (fs.existsSync(exe)) found.push({ exe, t: fs.statSync(exe).mtimeMs });
      }
    } catch (e) {}
  }
  found.sort((a, b) => b.t - a.t);
  return found[0] ? found[0].exe : 'claude';
}
const CLAUDE = findClaude();
const titleOf = slug => { const g = loadGames().find(x => x.slug === slug); return g ? g.title || slug : slug; };

const history = []; // recent host log lines, replayed to a newly opened chat
function hostLog(text, kind = 'info') {
  const line = { t: 'log', kind, text, at: Date.now() };
  history.push(line); if (history.length > 300) history.shift();
  for (const ws of host.clients) send(ws, line);
}
// Requests for different games run side by side; requests for the same game (or two new games) take turns.
const queue = [], running = new Map(); // key -> job
const MAX_AT_ONCE = 3;
function hostStatus() {
  const s = { t: 'status', busy: running.size > 0, current: [...running.values()].map(j => j.label + ': ' + j.text),
    queued: queue.map(q => q.text), players: players.size, games: loadGames().map(({ slug, title }) => ({ slug, title })) };
  for (const ws of host.clients) send(ws, s);
}

const RULES = `It is for a 6-year-old girl named Lia. Keep everything gentle, cute and kind: nothing scary, no losing, no punishing timers, big easy buttons, and it must work with touch as well as a mouse.
Don't run git commands, and don't touch the server folder or any other game's files. Keep your final message to one or two short sentences, in plain words, saying what you did.`;
function briefChange(g) {
  return `You are changing "${g.title}", a children's browser game. The whole game is ${g.file || 'index.html'} in the current folder. ${RULES}
Only edit that game's own files.${g.slug === 'phoenix-jewels' ? ' Keep the multiplayer block (search "Multiplayer") and the save data working. Ignore the games/, liakratts/ and server/ folders.' : ''}

The host asks: `;
}
function briefNew() {
  const used = loadGames().map(g => g.slug).join(', ');
  return `Make a brand-new browser game from the host's idea below. ${RULES}
How to add it:
1. Pick a short lowercase name with dashes for it (not one of: ${used}) and create the folder games/<name>/ with one self-contained index.html: all the CSS and JavaScript inline, no other files (Google Fonts links are fine). Make it look lovely and colorful, fill the screen, and work on phones, tablets and computers.
2. Add it to games.json in this folder. Keep it valid JSON and keep every existing entry. Add an object with "slug" (the folder name), "title", "blurb" (one short sentence a 6-year-old would like), "dir" ("games/<name>"), "file" ("index.html") and "color" (a bright hex color).
Don't change any other file.

The host's idea: `;
}

function runNext() {
  for (let i = 0; i < queue.length && running.size < MAX_AT_ONCE; i++) {
    const job = queue[i];
    if (running.has(job.key)) continue;
    queue.splice(i--, 1);
    start(job);
  }
  hostStatus();
}
function start(job) {
  running.set(job.key, job);
  hostLog(`${job.label}: ${job.text}`, 'request');
  const g = job.mode === 'change' ? loadGames().find(x => x.slug === job.slug) : null;
  const cwd = g ? gameDir(g) : ROOT;
  const args = ['-p', (g ? briefChange(g) : briefNew()) + job.text, '--output-format', 'stream-json', '--verbose',
    '--permission-mode', 'acceptEdits', '--allowedTools', 'Read,Edit,Write,Glob,Grep'];
  const say = (text, kind) => hostLog(`${job.label}: ${text}`, kind);
  let child;
  try { child = spawn(CLAUDE, args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { say(`Couldn't start Claude Code: ${e.message}`, 'error'); return finish(job); }
  let buf = '', errBuf = '';
  child.stdout.on('data', d => {
    buf += d; let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line) continue;
      let ev; try { ev = JSON.parse(line); } catch (e) { say(line); continue; }
      if (ev.type === 'assistant' && ev.message && ev.message.content) {
        for (const c of ev.message.content) {
          if (c.type === 'text' && c.text.trim()) say(c.text.trim(), 'claude');
          if (c.type === 'tool_use') hostLog(`${c.name} ${c.input && (c.input.file_path || c.input.pattern || '') || ''}`.trim(), 'tool');
        }
      } else if (ev.type === 'result') {
        say(ev.is_error ? `Claude Code stopped: ${ev.result || ev.subtype}` : job.mode === 'new' ? 'Done! The new game is on the games page.' : 'Done.', ev.is_error ? 'error' : 'done');
        if (ev.is_error && /authenticat|log ?in|OAuth/i.test(String(ev.result))) hostLog(`Claude Code needs signing in on this computer: run "${CLAUDE}" once in a terminal and type /login.`, 'error');
      }
    }
  });
  child.stderr.on('data', d => { errBuf += d; });
  child.on('error', e => { say(`Couldn't start Claude Code (${CLAUDE}): ${e.message}`, 'error'); });
  child.on('close', code => {
    if (code) say(`Claude Code exited with code ${code}. ${(errBuf || buf).replace(/\x1b\[[0-9;]*m/g, '').trim().slice(-600)}`, 'error');
    finish(job);
  });
}
function finish(job) {
  running.delete(job.key);
  if (pendingReloads.delete(job.key)) reloadGame(job.key, 'after the change');
  if (job.mode === 'new') for (const ws of live.clients) send(ws, 'games');
  runNext();
}

host.on('connection', ws => {
  for (const l of history) send(ws, l);
  hostStatus();
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (m.t !== 'request' || typeof m.text !== 'string' || !m.text.trim()) return;
    const text = m.text.trim().slice(0, 4000);
    const g = m.mode === 'change' && loadGames().find(x => x.slug === m.game);
    if (m.mode === 'change' && !g) { hostLog('Open a game first to change it, or choose "Make a new game".', 'error'); return; }
    queue.push(g ? { text, mode: 'change', slug: g.slug, key: g.slug, label: g.title } : { text, mode: 'new', key: '__new', label: 'New game' });
    runNext();
  });
});
setInterval(hostStatus, 5000);

server.listen(PORT, () => {
  console.log(`\nLia's games are running.`);
  console.log(`  Games: http://localhost:${PORT}/`);
  for (const g of loadGames()) console.log(`         http://localhost:${PORT}/games/${g.slug}/   ${g.title}`);
  console.log(`  Chat:  tap the sparkle button on any page, or open http://localhost:${PORT}/host`);
  if (!process.env.HOST_PASSWORD && !fs.existsSync(path.join(__dirname, 'password.txt')))
    console.log(`  Chat password (made up for this run; put one in server/password.txt to keep it): ${PASSWORD}`);
  console.log(`  Claude Code: ${CLAUDE}\n`);
});

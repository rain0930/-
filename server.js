// 英雄聯盟派對答題：零依賴，Node.js 18+。啟動：node server.js
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const PORT = +process.env.PORT || 3000;
const PER = +process.env.PER || 8;          // 每場題數
const ARAM_N = +process.env.ARAM_N || 2;    // 每場 ARAM 題數
const IMG_N = +process.env.IMG_N || 2;      // 每場最多圖片題數
const KEY = process.env.HOST_KEY || crypto.randomBytes(3).toString('hex');
const PUB = path.join(__dirname, 'public');
const BANK = JSON.parse(fs.readFileSync(path.join(__dirname, 'questions.json'), 'utf8')).map((q, i) => ({ id: i, ...q }));

let G = { phase: 'lobby', q: -1, deck: [], players: {} };
const clients = new Set();

const sh = a => a.map(x => [Math.random(), x]).sort((p, q) => p[0] - q[0]).map(x => x[1]);
function mkDeck() {
  const img = sh(BANK.filter(b => b.img)).slice(0, IMG_N);
  const aram = sh(BANK.filter(b => b.c === 'a' && !b.img)).slice(0, ARAM_N);
  const rest = sh(BANK.filter(b => b.c !== 'a' && !b.img)).slice(0, Math.max(0, PER - img.length - aram.length));
  return sh([...img, ...aram, ...rest]).map(b => b.id);
}
const cur = () => BANK[G.deck[G.q]];
const norm = s => String(s).trim().toLowerCase().replace(/\s+/g, '');
function pts(q, v) {
  if (v === undefined || !q) return 0;
  if (q.t === 'num') return Math.max(0, Math.round(1000 * (1 - Math.abs(v - q.a) / q.tol)));
  if (q.t === 'text') return q.a.some(x => norm(x) === norm(v)) ? 1000 : 0;
  if (q.t === 'order') return JSON.stringify(v) === JSON.stringify(q.a) ? 1000 : 0;
  return v === q.a ? 1000 : 0;
}
function valid(q, v) {
  if (q.t === 'choice' || q.t === 'tf') return Number.isInteger(v) && v >= 0 && v < q.o.length;
  if (q.t === 'text') return typeof v === 'string' && v.length <= 40;
  if (q.t === 'num') return typeof v === 'number' && isFinite(v);
  if (q.t === 'order') return Array.isArray(v) && v.length === q.a.length && [...v].sort().join('|') === [...q.a].sort().join('|');
  return false;
}
function total(p) {
  const u = (G.phase === 'reveal' || G.phase === 'end') ? G.q : G.q - 1;
  let t = 0; for (let i = 0; i <= u; i++) t += pts(BANK[G.deck[i]], p.answers[i]); return t;
}
const board = () => Object.entries(G.players).map(([id, p]) => ({ id, name: p.name, s: total(p) })).sort((a, b) => b.s - a.s).slice(0, 30);

function snap(id) {
  const me = G.players[id];
  const o = { phase: G.phase, q: G.q, total: G.deck.length, n: Object.keys(G.players).length, joined: !!me };
  if (G.phase === 'question' || G.phase === 'reveal') {
    const q = cur(), rev = G.phase === 'reveal';
    o.question = { t: q.t, q: q.q, o: q.o, img: q.img, show: q.show, c: q.c };
    o.answered = Object.values(G.players).filter(p => p.answers[G.q] !== undefined).length;
    if (me) o.mine = me.answers[G.q];
    if (rev) { o.answer = q.t === 'text' ? q.a[0] : q.a; if (me) o.gain = pts(q, me.answers[G.q]); }
  }
  if (G.phase !== 'question') o.board = board();
  return o;
}
function broadcast() {
  for (const c of clients) c.res.write('data: ' + JSON.stringify(snap(c.id)) + '\n\n');
}
function next() {
  if (G.phase === 'lobby') { if (!Object.keys(G.players).length) return false; G.deck = mkDeck(); G.q = 0; G.phase = 'question'; }
  else if (G.phase === 'question') G.phase = 'reveal';
  else if (G.phase === 'reveal') { if (G.q + 1 < G.deck.length) { G.q++; G.phase = 'question'; } else G.phase = 'end'; }
  else { for (const p of Object.values(G.players)) p.answers = {}; G.phase = 'lobby'; G.q = -1; G.deck = []; }
  return true;
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml' };
function body(req) {
  return new Promise(r => { let b = ''; req.on('data', d => { b += d; if (b.length > 1e5) req.destroy(); }); req.on('end', () => { try { r(JSON.parse(b || '{}')); } catch { r({}); } }); });
}
const json = (res, o, code = 200) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
function lanUrls() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) for (const i of list || []) if (i.family === 'IPv4' && !i.internal) out.push(`http://${i.address}:${PORT}`);
  return out;
}

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (req.method === 'GET' && u.pathname === '/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    const c = { id: String(u.searchParams.get('id') || '').slice(0, 40), res };
    clients.add(c);
    res.write('data: ' + JSON.stringify(snap(c.id)) + '\n\n');
    req.on('close', () => clients.delete(c));
    return;
  }
  if (req.method === 'GET' && u.pathname === '/api/info') return json(res, { urls: lanUrls() });
  if (req.method === 'POST' && u.pathname === '/api/join') {
    const b = await body(req), name = String(b.name || '').trim().slice(0, 12), id = String(b.id || '').slice(0, 40);
    if (!name || !id) return json(res, { ok: false }, 400);
    G.players[id] = G.players[id] || { answers: {} }; G.players[id].name = name;
    broadcast(); return json(res, { ok: true });
  }
  if (req.method === 'POST' && u.pathname === '/api/answer') {
    const b = await body(req), p = G.players[b.id];
    if (!p || G.phase !== 'question' || !valid(cur(), b.v)) return json(res, { ok: false }, 400);
    p.answers[G.q] = b.v; broadcast(); return json(res, { ok: true });
  }
  if (req.method === 'POST' && u.pathname === '/api/host') {
    const b = await body(req);
    if (b.key !== KEY) return json(res, { ok: false, error: '主持人金鑰不正確' }, 403);
    const ok = next(); broadcast(); return json(res, { ok, error: ok ? undefined : '還沒有玩家加入' });
  }
  if (req.method === 'GET' && u.pathname.startsWith('/images/')) {
    const f = path.join(PUB, 'images', path.basename(decodeURIComponent(u.pathname)));
    return fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': TYPES[path.extname(f).toLowerCase()] || 'application/octet-stream' }); res.end(d); });
  }
  if (req.method === 'GET' && (u.pathname === '/' || u.pathname === '/host')) {
    return fs.readFile(path.join(PUB, 'index.html'), (e, d) => { res.writeHead(200, { 'content-type': TYPES['.html'] }); res.end(d); });
  }
  res.writeHead(404); res.end('Not found');
}).listen(PORT, () => {
  console.log('\n英雄聯盟派對答題 已啟動');
  console.log('  主持人（大螢幕）： http://localhost:' + PORT + '/host?key=' + KEY);
  const l = lanUrls(); console.log('  玩家（手機）請連： ' + (l.join('  或  ') || 'http://localhost:' + PORT));
  console.log('  題庫：' + BANK.length + ' 題，每場抽 ' + PER + ' 題\n');
});
setInterval(() => { for (const c of clients) c.res.write(': ping\n\n'); }, 25000);

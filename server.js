// 英雄聯盟答題（單人闖關＋排行榜）：零依賴，Node.js 18+。啟動：node server.js
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const PORT = +process.env.PORT || 3000;
const PER = +process.env.PER || 10;         // 每場題數
const ARAM_N = +process.env.ARAM_N || 3;    // 每場 ARAM 題數
const IMG_N = +process.env.IMG_N || 2;      // 每場最多圖片／影片題數
const PUB = path.join(__dirname, 'public');
const BANK = JSON.parse(fs.readFileSync(path.join(__dirname, 'questions.json'), 'utf8')).map((q, i) => ({ id: i, ...q }));
const isMedia = b => b.img || b.video || b.yt;
const players = {};  // id → { name, state, deck, i, score, best, res:{} }

const sh = a => a.map(x => [Math.random(), x]).sort((p, q) => p[0] - q[0]).map(x => x[1]);
function mkDeck() {
  const med = sh(BANK.filter(isMedia)).slice(0, IMG_N);
  const aram = sh(BANK.filter(b => b.c === 'a' && !isMedia(b))).slice(0, ARAM_N);
  const rest = sh(BANK.filter(b => b.c !== 'a' && !isMedia(b))).slice(0, Math.max(0, PER - med.length - aram.length));
  return sh([...med, ...aram, ...rest]).map(b => b.id);
}
const norm = s => String(s).trim().toLowerCase().replace(/\s+/g, '');
function pts(q, v) {
  if (q.t === 'num') return Math.max(0, Math.round(1000 * (1 - Math.abs(v - q.a) / q.tol)));
  if (q.t === 'text') return q.a.some(x => norm(x) === norm(v)) ? 1000 : 0;
  if (q.t === 'order') return JSON.stringify(v) === JSON.stringify(q.a) ? 1000 : 0;
  return v === q.a ? 1000 : 0;
}
function valid(q, v) {
  if (q.t === 'choice' || q.t === 'tf') return Number.isInteger(v) && v >= 0 && v < q.o.length;
  if (q.t === 'text') return typeof v === 'string' && v.trim().length > 0 && v.length <= 40;
  if (q.t === 'num') return typeof v === 'number' && isFinite(v);
  if (q.t === 'order') return Array.isArray(v) && v.length === q.a.length && [...v].sort().join('|') === [...q.a].sort().join('|');
  return false;
}
function board(me) {
  const all = Object.entries(players);
  return {
    top: all.filter(([, p]) => p.best > 0 || p.played).map(([id, p]) => ({ name: p.name, s: p.best, me: id === me })).sort((a, b) => b.s - a.s).slice(0, 30),
    playing: all.filter(([, p]) => p.state === 'play' || p.state === 'reveal').length
  };
}
function snap(id) {
  const p = players[id];
  if (!p) return { state: 'new', board: board(id) };
  const o = { state: p.state, name: p.name, total: p.deck.length, i: p.i, score: p.score, best: p.best, board: board(id) };
  if (p.state === 'play' || p.state === 'reveal') {
    const q = BANK[p.deck[p.i]];
    const pm = p.perm[p.i]; o.question = { t: q.t, q: q.q, o: pm ? pm.map(k => q.o[k]) : q.o, img: q.img, video: q.video, yt: q.yt, show: q.show, c: q.c };
    if (p.state === 'reveal') { const r = p.res[p.i]; o.mine = r.v; o.gain = r.g; o.answer = pm ? pm.indexOf(q.a) : (q.t === 'text' ? q.a[0] : q.a); o.exp = q.exp; }
  }
  return o;
}
function act(b) {
  const id = String(b.id || '').slice(0, 40); if (!id) return {};
  let p = players[id];
  if (b.type === 'join') {
    const name = String(b.name || '').trim().slice(0, 12); if (!name) return snap(id);
    if (!p) p = players[id] = { name, state: 'lobby', deck: [], i: 0, score: 0, best: 0, played: false, res: {} }; else p.name = name;
  } else if (p) {
    if (b.type === 'start' && (p.state === 'lobby' || p.state === 'end')) { p.deck = mkDeck(); p.perm = p.deck.map(id => { const q = BANK[id]; return q.t === 'choice' ? sh([...q.o.keys()]) : null; }); p.i = 0; p.score = 0; p.res = {}; p.state = 'play'; p.played = true; }
    else if (b.type === 'submit' && p.state === 'play') {
      const q = BANK[p.deck[p.i]];
      const pm = p.perm[p.i]; if (valid(q, b.v)) { const g = pts(q, pm ? pm[b.v] : b.v); p.res[p.i] = { v: b.v, g }; p.score += g; p.state = 'reveal'; }
    } else if (b.type === 'next' && p.state === 'reveal') {
      if (p.i + 1 < p.deck.length) { p.i++; p.state = 'play'; } else { p.state = 'end'; p.best = Math.max(p.best, p.score); }
    }
  }
  return snap(id);
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.webm': 'video/webm' };
function body(req) {
  return new Promise(r => { let b = ''; req.on('data', d => { b += d; if (b.length > 1e5) req.destroy(); }); req.on('end', () => { try { r(JSON.parse(b || '{}')); } catch { r({}); } }); });
}
function sendFile(req, res, f) {   // 支援 Range，讓手機（含 iPhone）能播放 mp4
  fs.stat(f, (e, st) => {
    if (e || !st.isFile()) { res.writeHead(404); return res.end(); }
    const type = TYPES[path.extname(f).toLowerCase()] || 'application/octet-stream', r = req.headers.range;
    if (r) {
      const m = /bytes=(\d*)-(\d*)/.exec(r) || [];
      const s = m[1] ? +m[1] : 0, en = Math.min(m[2] ? +m[2] : st.size - 1, st.size - 1);
      if (s > en) { res.writeHead(416); return res.end(); }
      res.writeHead(206, { 'content-type': type, 'content-range': `bytes ${s}-${en}/${st.size}`, 'accept-ranges': 'bytes', 'content-length': en - s + 1 });
      fs.createReadStream(f, { start: s, end: en }).pipe(res);
    } else {
      res.writeHead(200, { 'content-type': type, 'accept-ranges': 'bytes', 'content-length': st.size });
      fs.createReadStream(f).pipe(res);
    }
  });
}
http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (req.method === 'POST' && u.pathname === '/api/act') {
    const out = act(await body(req));
    res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(out));
  }
  if (req.method === 'GET' && u.pathname.startsWith('/images/')) return sendFile(req, res, path.join(PUB, 'images', path.basename(decodeURIComponent(u.pathname))));
  if (req.method === 'GET' && (u.pathname === '/' || u.pathname === '/host')) return sendFile(req, res, path.join(PUB, 'index.html'));
  res.writeHead(404); res.end('Not found');
}).listen(PORT, () => {
  const lan = []; for (const l of Object.values(os.networkInterfaces())) for (const i of l || []) if (i.family === 'IPv4' && !i.internal) lan.push(`http://${i.address}:${PORT}`);
  console.log('\n英雄聯盟答題（單人闖關＋排行榜）已啟動');
  console.log('  開啟： http://localhost:' + PORT + (lan.length ? '  或  ' + lan.join('  或  ') : ''));
  console.log('  題庫：' + BANK.length + ' 題，每場抽 ' + PER + ' 題\n');
});

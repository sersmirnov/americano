// Americano padel site: serves the page and keeps results in a JSON file.
// Env: ADMIN_PIN (required for editing), PORT, DATA_DIR (folder for state.json).
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
// ADMIN_PIN may list several PINs separated by commas: one per organizer
const PINS = String(process.env.ADMIN_PIN || '').split(',').map(x => x.trim()).filter(Boolean);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const FILE = path.join(DATA_DIR, 'state.json');
const PAGE = fs.readFileSync(path.join(__dirname, 'public', 'index.html'));

const DEFAULT = {
  v: 1,
  title: 'Americano · Saturday 3 October',
  sub: 'Padel · team americano · 12 pairs',
  total: null,
  sort: 'points',
  courts: ['1', '2', '3', '4', '5', '6'],
  pairs: Array.from({ length: 12 }, (_, i) => 'Pair ' + (i + 1)),
  scores: {},
};

fs.mkdirSync(DATA_DIR, { recursive: true });
let state = DEFAULT;
try { state = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (_) {}
// Switch untouched Russian defaults to English; anything the organizers typed stays as is
if (state.title === 'Американо · суббота 3 октября') state.title = DEFAULT.title;
if (state.sub === 'Падел · парное американо · 12 пар') state.sub = DEFAULT.sub;
if (Array.isArray(state.pairs)) state.pairs = state.pairs.map(p => /^Пара \d+$/.test(p) ? p.replace('Пара', 'Pair') : p);

function valid(s) {
  if (!s || typeof s !== 'object') return false;
  if (!Array.isArray(s.pairs) || s.pairs.length !== 12 || !s.pairs.every(p => typeof p === 'string' && p.length <= 60)) return false;
  if (!s.scores || typeof s.scores !== 'object') return false;
  for (const [k, v] of Object.entries(s.scores)) {
    if (!/^\d{1,2}-\d{1,2}$/.test(k) || !Array.isArray(v) || v.length !== 2) return false;
    if (!v.every(x => x === null || (Number.isInteger(x) && x >= 0 && x <= 99))) return false;
  }
  return true;
}
function clean(s) {
  return {
    v: 1,
    title: String(s.title || '').slice(0, 80),
    sub: String(s.sub || '').slice(0, 80),
    total: Number.isInteger(s.total) && s.total > 0 && s.total < 100 ? s.total : null,
    sort: s.sort === 'wins' ? 'wins' : 'points',
    courts: Array.isArray(s.courts) && s.courts.length === 6 && s.courts.every(c => typeof c === 'string' && c.trim() && c.length <= 12) ? s.courts : ['1', '2', '3', '4', '5', '6'],
    sideA: String(s.sideA || '').slice(0, 60),
    pairs: s.pairs,
    scores: s.scores,
  };
}
function save() {
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, FILE);
}
function authed(req) {
  return PINS.includes(String(req.headers['x-pin'] || ''));
}
function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (req.method === 'GET' && url === '/api/state') return send(res, 200, state);
  if (req.method === 'POST' && url === '/api/login') return authed(req) ? send(res, 200, { ok: true }) : send(res, 401, { ok: false });
  if (req.method === 'POST' && url === '/api/state') {
    if (!authed(req)) return send(res, 401, { ok: false });
    let body = '';
    req.on('data', c => { body += c; if (body.length > 100000) req.destroy(); });
    req.on('end', () => {
      try {
        const { base, next } = JSON.parse(body);
        if (!valid(base) || !valid(next)) return send(res, 400, { ok: false });
        // Apply only what this organizer changed, so two organizers can enter scores at once
        const merged = JSON.parse(JSON.stringify(state));
        for (const f of ['title', 'sub', 'total', 'sort', 'courts', 'sideA']) if (JSON.stringify(base[f]) !== JSON.stringify(next[f])) merged[f] = next[f];
        next.pairs.forEach((p, i) => { if (p !== base.pairs[i]) merged.pairs[i] = p; });
        const keys = new Set([...Object.keys(base.scores), ...Object.keys(next.scores)]);
        for (const k of keys) {
          if (JSON.stringify(base.scores[k]) === JSON.stringify(next.scores[k])) continue;
          if (next.scores[k] === undefined) delete merged.scores[k]; else merged.scores[k] = next.scores[k];
        }
        if (!valid(merged)) return send(res, 400, { ok: false });
        state = clean(merged);
        save();
        send(res, 200, state);
      } catch (_) { send(res, 400, { ok: false }); }
    });
    return;
  }
  if (req.method === 'GET') return send(res, 200, PAGE, 'text/html; charset=utf-8');
  send(res, 404, { ok: false });
}).listen(PORT, () => console.log('Americano on port ' + PORT));

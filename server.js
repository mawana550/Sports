// Village League TV - tiny zero-dependency server.
// Run:  ADMIN_PASSWORD=yourpassword node server.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const PASS = process.env.ADMIN_PASSWORD || 'admin123';
const DB_FILE = path.join(__dirname, 'data.json');
const TOKEN = crypto.createHash('sha256').update('vltv:' + PASS).digest('hex');
const uid = () => crypto.randomBytes(4).toString('hex');

// ---------- storage ----------
function seed() {
  const now = Date.now();
  return {
    rev: 1,
    leagueName: 'Village League TV',
    siteName: 'Rock Videos',
    matches: [
      {
        id: uid(), home: 'Hunters FC', away: 'Eagles United', league: 'Village League',
        homeLogo: '', awayLogo: '',
        kickoff: new Date(now).toISOString(), status: 'live', pinned: true,
        sources: [{ type: 'hls', url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8', label: 'Demo test stream' }]
      },
      {
        id: uid(), home: 'Rock Rangers', away: 'Valley Stars', league: 'Village League',
        homeLogo: '', awayLogo: '',
        kickoff: new Date(now + 2 * 86400000).toISOString(), status: 'upcoming', pinned: true, sources: []
      }
    ],
    commentary: []
  };
}
let db;
try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch { db = seed(); save(false); }

db.siteName = db.siteName || 'Rock Videos';

// team library (built from existing matches the first time)
db.teams = Array.isArray(db.teams) ? db.teams : [];
if (!db.teams.length) {
  const seen = new Map();
  for (const m of db.matches) for (const [n, l] of [[m.home, m.homeLogo], [m.away, m.awayLogo]])
    if (n && !['Home', 'Away'].includes(n) && !seen.has(n.toLowerCase())) seen.set(n.toLowerCase(), { id: uid(), name: n, logo: l || '' });
  db.teams = [...seen.values()]; save(false);
}
const cleanTeam = b => ({ name: str(b.name, 40), logo: isUrl(str(b.logo, 500)) ? str(b.logo, 500) : '' });

function save(bump = true) {
  if (bump) db.rev++;
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

// ---------- validation ----------
const str = (v, n = 120) => String(v ?? '').trim().slice(0, n);
const isUrl = u => /^https?:\/\//i.test(u);
function cleanMatch(b, id) {
  const sources = (Array.isArray(b.sources) ? b.sources : [])
    .map(s => ({ type: s.type === 'embed' ? 'embed' : 'hls', url: str(s.url, 1000), label: str(s.label, 40) }))
    .filter(s => isUrl(s.url)).slice(0, 5);
  const k = new Date(b.kickoff);
  const logo = v => isUrl(str(v, 500)) ? str(v, 500) : '';
  const tid = v => /^[a-f0-9]{1,16}$/.test(String(v || '')) ? String(v) : '';
  return {
    id,
    homeId: tid(b.homeId), awayId: tid(b.awayId),
    home: str(b.home, 40) || 'Home',
    away: str(b.away, 40) || 'Away',
    homeLogo: logo(b.homeLogo),
    awayLogo: logo(b.awayLogo),
    league: str(b.league, 40) || 'Village League',
    leagueLogo: logo(b.leagueLogo),
    kickoff: isNaN(k) ? new Date().toISOString() : k.toISOString(),
    status: ['upcoming', 'live', 'finished'].includes(b.status) ? b.status : 'upcoming',
    pinned: !!b.pinned,
    sources
  };
}

// ---------- helpers ----------
function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = '';
    req.on('data', c => { d += c; if (d.length > 200000) { reject(new Error('too big')); req.destroy(); } });
    req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch (e) { reject(e); } });
  });
}
const sendFile = (res, name, type = 'text/html') => {
  try { send(res, 200, fs.readFileSync(path.join(__dirname, name), 'utf8'), type); }
  catch { send(res, 404, { error: 'missing ' + name }); }
};

// ---------- HLS proxy (fixes CORS / hotlink blocks; needs Node 18+) ----------
// The player first tries the stream link directly. If the browser blocks it (usually CORS),
// it retries through /proxy, where this server fetches the stream and relays it.
const dns = require('dns').promises;
const net = require('net');
const discoveredHosts = new Map(); // hosts found inside playlists -> expiry time
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';

// The proxy turns itself off when many people are watching (it would overload the server).
const PROXY_MAX_VIEWERS = +process.env.PROXY_MAX_VIEWERS || 100;
const seenViewers = new Map(); // viewer id -> last seen
function viewerCount() {
  const now = Date.now();
  for (const [k, t] of seenViewers) if (now - t > 15000) seenViewers.delete(k);
  return seenViewers.size;
}

function dbHosts() {
  const s = new Set();
  for (const m of db.matches) for (const x of m.sources) { try { s.add(new URL(x.url).hostname); } catch {} }
  return s;
}
function isPrivateIp(ip) {
  ip = ip.replace(/^::ffff:/, '');
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  return /^(::1?|f[cd]|fe80)/i.test(ip);
}
async function hostIsPublic(h) {
  if (net.isIP(h)) return !isPrivateIp(h);
  try { return (await dns.lookup(h, { all: true })).every(a => !isPrivateIp(a.address)); } catch { return false; }
}

async function proxy(req, res, u) {
  let target;
  try { target = new URL(u); } catch { return send(res, 400, { error: 'bad url' }); }
  if (!/^https?:$/.test(target.protocol)) return send(res, 400, { error: 'bad url' });

  // only hosts the admin saved, or hosts that appear inside their playlists (never an open proxy)
  const trusted = dbHosts().has(target.hostname);
  if (!trusted) {
    const exp = discoveredHosts.get(target.hostname);
    if (!exp || exp < Date.now() || !(await hostIsPublic(target.hostname))) return send(res, 403, { error: 'host not allowed' });
  }

  const headers = { 'User-Agent': UA, 'Accept': '*/*' };
  if (req.headers.range) headers.Range = req.headers.range;
  let up;
  try { up = await fetch(target, { headers, redirect: 'follow', signal: AbortSignal.timeout(20000) }); }
  catch (e) { return send(res, 502, { error: 'upstream unreachable: ' + (e.cause?.code || e.message) }); }
  if (!up.ok && up.status !== 206) return send(res, up.status, { error: 'upstream ' + up.status });

  const buf = Buffer.from(await up.arrayBuffer());
  if (buf.subarray(0, 7).toString() === '#EXTM3U') {
    const base = new URL(up.url);
    const abs = ref => {
      if (/^data:/i.test(ref)) return ref;
      const r = new URL(ref, base);
      // signed streams: segments on the same host often need the same token as the playlist
      if (!r.search && target.search && r.hostname === base.hostname) r.search = target.search;
      discoveredHosts.set(r.hostname, Date.now() + 6 * 3600e3);
      return '/proxy?u=' + encodeURIComponent(r.href);
    };
    const text = buf.toString('utf8').split(/\r?\n/).map(line => {
      if (!line.trim()) return line;
      if (line.startsWith('#')) return line.replace(/URI="([^"]+)"/g, (_, x) => 'URI="' + abs(x) + '"');
      return abs(line.trim());
    }).join('\n');
    res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-store' });
    return res.end(text);
  }
  const h = { 'Content-Type': up.headers.get('content-type') || 'video/mp2t', 'Cache-Control': 'no-store' };
  if (up.headers.get('content-range')) h['Content-Range'] = up.headers.get('content-range');
  res.writeHead(up.status, h);
  res.end(buf);
}

// ---------- server ----------
http.createServer(async (req, res) => {
  try {
    const p = new URL(req.url, 'http://x').pathname;
    const m = req.method;

    if (m === 'GET' && (p === '/' || p === '/index.html')) return sendFile(res, 'index.html');
    if (m === 'GET' && (p === '/admin' || p === '/admin.html')) return sendFile(res, 'admin.html');
    if (m === 'GET' && (p === '/match' || p === '/match.html')) return sendFile(res, 'match.html');
    const STATIC = { '/common.js': 'application/javascript', '/common.css': 'text/css', '/manifest.json': 'application/manifest+json' };
    if (m === 'GET' && STATIC[p]) return sendFile(res, p.slice(1), STATIC[p]);

    if (m === 'GET' && p === '/proxy') {
      if (viewerCount() >= PROXY_MAX_VIEWERS) return send(res, 503, { error: 'proxy off: too many viewers' });
      return await proxy(req, res, new URL(req.url, 'http://x').searchParams.get('u') || '');
    }

    if (m === 'GET' && p === '/api/state') {
      const cid = new URL(req.url, 'http://x').searchParams.get('c');
      if (cid) seenViewers.set(cid.slice(0, 40), Date.now());
      return send(res, 200, { proxyOk: viewerCount() < PROXY_MAX_VIEWERS, teams: db.teams, rev: db.rev, leagueName: db.leagueName, siteName: db.siteName, matches: db.matches, commentary: db.commentary });
    }

    if (m === 'POST' && p === '/api/login') {
      const b = await readBody(req);
      if (b.password === PASS) return send(res, 200, { token: TOKEN });
      return setTimeout(() => send(res, 401, { error: 'Wrong password' }), 800);
    }

    if (p.startsWith('/api/admin/')) {
      if (req.headers['x-token'] !== TOKEN) return send(res, 401, { error: 'unauthorized' });

      if (m === 'POST' && p === '/api/admin/matches') {
        const match = cleanMatch(await readBody(req), uid());
        db.matches.push(match); save();
        return send(res, 200, match);
      }
      const mm = p.match(/^\/api\/admin\/matches\/([a-f0-9]+)$/);
      if (mm) {
        const i = db.matches.findIndex(x => x.id === mm[1]);
        if (i < 0) return send(res, 404, { error: 'not found' });
        if (m === 'PUT') { db.matches[i] = cleanMatch(await readBody(req), mm[1]); save(); return send(res, 200, db.matches[i]); }
        if (m === 'DELETE') { db.matches.splice(i, 1); save(); return send(res, 200, { ok: true }); }
      }
      if (m === 'POST' && p === '/api/admin/teams') {
        const t = cleanTeam(await readBody(req));
        if (!t.name) return send(res, 400, { error: 'Team name required' });
        const ex = db.teams.find(x => x.name.toLowerCase() === t.name.toLowerCase());
        if (ex) { if (t.logo) ex.logo = t.logo; save(); return send(res, 200, ex); }
        if (db.teams.length >= 500) return send(res, 400, { error: 'Too many teams' });
        t.id = uid(); db.teams.push(t); save(); return send(res, 200, t);
      }
      const tm = p.match(/^\/api\/admin\/teams\/([a-f0-9]+)$/);
      if (tm) {
        const i = db.teams.findIndex(x => x.id === tm[1]);
        if (i < 0) return send(res, 404, { error: 'not found' });
        if (m === 'PUT') {
          const t = cleanTeam(await readBody(req));
          if (!t.name) return send(res, 400, { error: 'Team name required' });
          t.id = tm[1]; db.teams[i] = t;
          for (const x of db.matches) {
            if (x.homeId === t.id) { x.home = t.name; x.homeLogo = t.logo; }
            if (x.awayId === t.id) { x.away = t.name; x.awayLogo = t.logo; }
          }
          save(); return send(res, 200, t);
        }
        if (m === 'DELETE') { db.teams.splice(i, 1); save(); return send(res, 200, { ok: true }); }
      }
      if (m === 'PUT' && p === '/api/admin/commentary') {
        const b = await readBody(req);
        db.commentary = (Array.isArray(b.commentary) ? b.commentary : [])
          .map(c => ({ id: str(c.id, 20) || uid(), label: str(c.label, 40), url: str(c.url, 1000) }))
          .filter(c => c.label && isUrl(c.url)).slice(0, 10);
        save(); return send(res, 200, { ok: true });
      }
      if (m === 'PUT' && p === '/api/admin/settings') {
        const b = await readBody(req);
        db.leagueName = str(b.leagueName, 50) || db.leagueName;
        db.siteName = str(b.siteName, 40) || db.siteName; save();
        return send(res, 200, { ok: true });
      }
    }
    send(res, 404, { error: 'not found' });
  } catch (e) {
    send(res, 400, { error: String(e.message || e) });
  }
}).listen(PORT, () => {
  console.log(`Viewer: http://localhost:${PORT}/`);
  console.log(`Admin:  http://localhost:${PORT}/admin   (password: ${PASS === 'admin123' ? 'admin123 - change it with ADMIN_PASSWORD' : '[from ADMIN_PASSWORD]'})`);
});

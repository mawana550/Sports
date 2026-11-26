// Village League TV - tiny zero-dependency server.
// Run:  ADMIN_PASSWORD=yourpassword node server.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
// hosts sometimes add spaces/quotes/newlines around variables, so they are cleaned
const cleanEnv = v => String(v ?? '').trim().replace(/^(["'])(.*)\1$/, '$2').trim();
const PASS = cleanEnv(process.env.ADMIN_PASSWORD ?? process.env.ADMIN_PASS) || 'admin123';
const USING_DEFAULT_PASS = PASS === 'admin123';
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
db.siteLogo = db.siteLogo || '';
if (!Array.isArray(db.backgrounds)) db.backgrounds = [
  { id: 'champions', name: 'Champions League', url: '/backgrounds/champions.webp' },
  { id: 'zigzag', name: 'Purple zigzag', url: '/backgrounds/zigzag.webp' }];
const bgRef = v => { const t = str(v, 500); return /^[a-z0-9-]{1,40}$/.test(t) || isLogo(t) ? t : ''; };

// team library (built from existing matches the first time)
db.teams = Array.isArray(db.teams) ? db.teams : [];
if (!db.teams.length) {
  const seen = new Map();
  for (const m of db.matches) for (const [n, l] of [[m.home, m.homeLogo], [m.away, m.awayLogo]])
    if (n && !['Home', 'Away'].includes(n) && !seen.has(n.toLowerCase())) seen.set(n.toLowerCase(), { id: uid(), name: n, logo: l || '' });
  db.teams = [...seen.values()]; save(false);
}
// commentary used to be one shared list; move it onto the matches that are not finished (once)
if (!db.commentaryMoved) {
  if (Array.isArray(db.commentary) && db.commentary.length)
    for (const m of db.matches) if (m.status !== 'finished' && !(m.commentary && m.commentary.length))
      m.commentary = db.commentary.map(c => ({ label: c.label, url: c.url }));
  db.commentaryMoved = true; save(false);
}
const cleanTeam = b => ({ name: str(b.name, 40), logo: isLogo(str(b.logo, 500)) ? str(b.logo, 500) : '' });

function save(bump = true) {
  if (bump) db.rev++;
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

// ---------- validation ----------
const str = (v, n = 120) => String(v ?? '').trim().slice(0, n);
const isUrl = u => /^https?:\/\//i.test(u);
const isLogo = u => isUrl(u) || /^\/(logos|backgrounds)\/[\w.-]+\.(png|webp|jpe?g|svg|gif)$/i.test(u); // own club badges live in /logos
function cleanMatch(b, id) {
  const sources = (Array.isArray(b.sources) ? b.sources : [])
    .map(s => ({ type: s.type === 'embed' ? 'embed' : 'hls', url: str(s.url, 1000), label: str(s.label, 40) }))
    .filter(s => isUrl(s.url)).slice(0, 5);
  const k = new Date(b.kickoff);
  const logo = v => isLogo(str(v, 500)) ? str(v, 500) : '';
  const tid = v => /^[a-f0-9]{1,16}$/.test(String(v || '')) ? String(v) : '';
  return {
    id,
    extId: /^fd:\d{1,12}$/.test(String(b.extId || '')) ? String(b.extId) : '',
    homeId: tid(b.homeId), awayId: tid(b.awayId),
    home: str(b.home, 40) || 'Home',
    away: str(b.away, 40) || 'Away',
    homeLogo: logo(b.homeLogo),
    awayLogo: logo(b.awayLogo),
    league: str(b.league, 40) || 'Village League',
    leagueLogo: logo(b.leagueLogo),
    bg: bgRef(b.bg),
    kickoff: isNaN(k) ? new Date().toISOString() : k.toISOString(),
    status: ['upcoming', 'live', 'finished'].includes(b.status) ? b.status : 'upcoming',
    pinned: !!b.pinned,
    sources,
    commentary: (Array.isArray(b.commentary) ? b.commentary : [])
      .map(c => ({ label: str(c.label, 40) || 'Commentary', url: str(c.url, 1000) }))
      .filter(c => isUrl(c.url)).slice(0, 5)
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


// ---------- automatic fixtures (football-data.org) ----------
// Needs a free API token from https://www.football-data.org  ->  set it as FOOTBALL_DATA_API_KEY
// (never paste the token into the code or into a chat). Free plan covers PL, La Liga and Champions League.
const FD_KEY = cleanEnv(process.env.FOOTBALL_DATA_API_KEY);
const FD_BASE = cleanEnv(process.env.FOOTBALL_DATA_BASE) || 'https://api.football-data.org/v4';
const FD_COMPS = { PL: 'Premier League', PD: 'La Liga', CL: 'Champions League' };
db.sync = Object.assign({ enabled: true, comps: ['PL', 'PD', 'CL'], daysAhead: 10, everyHours: 6, last: null }, db.sync || {});
let syncing = false;

let clubIndex = null;
const norm = n => String(n || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/\b(fc|afc|cf|ac|as|sc|fk|ud|rc|cd|club|de|1907|calcio)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
function clubs() {
  if (clubIndex) return clubIndex;
  clubIndex = new Map();
  try { for (const c of JSON.parse(fs.readFileSync(path.join(__dirname, 'clubs.json'), 'utf8'))) clubIndex.set(norm(c.name), c); } catch {}
  return clubIndex;
}
function teamFor(apiTeam) {
  const names = [apiTeam.name, apiTeam.shortName].filter(Boolean);
  let team = null;
  for (const n of names) { team = db.teams.find(t => norm(t.name) === norm(n)); if (team) break; }
  if (team) return team;
  let club = null;
  for (const n of names) { club = clubs().get(norm(n)); if (club) break; }
  const name = str(club ? club.name : (apiTeam.shortName || apiTeam.name), 40);
  const logo = club ? club.logo : (isUrl(apiTeam.crest || '') ? str(apiTeam.crest, 500) : '');
  team = { id: uid(), name, logo };
  if (db.teams.length < 500) db.teams.push(team);
  return team;
}
const mapStatus = s => ['IN_PLAY', 'PAUSED', 'LIVE'].includes(s) ? 'live' : ['FINISHED', 'AWARDED'].includes(s) ? 'finished' : 'upcoming';
const ymd = d => d.toISOString().slice(0, 10);

async function fdGet(pathAndQuery) {
  const r = await fetch(FD_BASE + pathAndQuery, { headers: { 'X-Auth-Token': FD_KEY }, signal: AbortSignal.timeout(20000) });
  if (r.status === 429) throw new Error('API rate limit reached - try again in a minute');
  if (r.status === 401 || r.status === 403) throw new Error('API rejected the key (HTTP ' + r.status + ') - check FOOTBALL_DATA_API_KEY and that your plan includes this competition');
  if (!r.ok) throw new Error('API error HTTP ' + r.status);
  return r.json();
}

async function syncFixtures(trigger = 'manual') {
  if (!FD_KEY) throw new Error('FOOTBALL_DATA_API_KEY is not set on the server');
  if (syncing) throw new Error('A sync is already running');
  syncing = true;
  const res = { at: new Date().toISOString(), trigger, added: 0, updated: 0, errors: [] };
  try {
    const from = new Date(Date.now() - 86400000), days = Math.min(Math.max(+db.sync.daysAhead || 10, 1), 30);
    const comps = db.sync.comps.filter(c => FD_COMPS[c]);
    for (const code of comps) {
      for (let off = 0; off <= days + 1; off += 10) { // the API allows a limited date range per request
        const a = new Date(from.getTime() + off * 86400000), b = new Date(Math.min(a.getTime() + 9 * 86400000, from.getTime() + (days + 1) * 86400000));
        let data;
        try { data = await fdGet('/competitions/' + code + '/matches?dateFrom=' + ymd(a) + '&dateTo=' + ymd(b)); }
        catch (e) { res.errors.push(code + ': ' + e.message); break; }
        for (const fx of data.matches || []) {
          if (!fx || !fx.id || !fx.homeTeam || !fx.awayTeam || !fx.homeTeam.name || !fx.awayTeam.name) continue; // e.g. knockout slots with no teams yet
          if (['CANCELLED'].includes(fx.status)) continue;
          const ext = 'fd:' + fx.id, status = mapStatus(fx.status), kick = new Date(fx.utcDate);
          if (isNaN(kick)) continue;
          const cur = db.matches.find(x => x.extId === ext);
          if (cur) {
            let changed = false;
            if (cur.kickoff !== kick.toISOString()) { cur.kickoff = kick.toISOString(); changed = true; }
            // never pull a match the admin already set live back to "upcoming"
            const st = (cur.status === 'live' && status === 'upcoming') ? 'live' : status;
            if (cur.status !== st) { cur.status = st; changed = true; }
            if (changed) res.updated++;
          } else {
            const h = teamFor(fx.homeTeam), w = teamFor(fx.awayTeam);
            db.matches.push(cleanMatch({ extId: ext, home: h.name, away: w.name, homeId: h.id, awayId: w.id, homeLogo: h.logo, awayLogo: w.logo,
              league: FD_COMPS[code], leagueLogo: '', kickoff: kick.toISOString(), status, pinned: false, sources: [], commentary: [] }, uid()));
            res.added++;
          }
        }
        await new Promise(r => setTimeout(r, 700)); // stay well inside the free-plan rate limit
      }
    }
    db.sync.last = res;
    save(res.added > 0 || res.updated > 0);
    return res;
  } finally { syncing = false; }
}
function scheduleSync() {
  if (!FD_KEY) return;
  const tick = () => { if (db.sync.enabled) syncFixtures('auto').then(r => console.log('Fixtures sync:', r.added, 'added,', r.updated, 'updated', r.errors.length ? r.errors : ''), e => console.log('Fixtures sync failed:', e.message)); };
  setTimeout(tick, 5000);
  setInterval(tick, Math.max(1, +db.sync.everyHours || 6) * 3600e3);
}
const syncInfo = () => ({ keySet: !!FD_KEY, running: syncing, comps: FD_COMPS, selected: db.sync.comps, enabled: db.sync.enabled, daysAhead: db.sync.daysAhead, last: db.sync.last });

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

    if (m === 'GET' && (p.startsWith('/logos/') || p.startsWith('/backgrounds/'))) {
      const name = path.basename(p); // badges are looked up in /logos, or next to server.js if they were uploaded flat
      let f = path.join(__dirname, p.split('/')[1], name);
      if (!fs.existsSync(f) && (name === 'clubs.json' || /\.png$/i.test(name))) f = path.join(__dirname, name);
      try { const buf = fs.readFileSync(f); res.writeHead(200, { 'Content-Type': { '.png': 'image/png', '.json': 'application/json', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml' }[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'public, max-age=604800' }); return res.end(buf); }
      catch { return send(res, 404, { error: 'not found' }); }
    }

    if (m === 'GET' && p === '/proxy') {
      if (viewerCount() >= PROXY_MAX_VIEWERS) return send(res, 503, { error: 'proxy off: too many viewers' });
      return await proxy(req, res, new URL(req.url, 'http://x').searchParams.get('u') || '');
    }

    if (m === 'GET' && p === '/api/state') {
      const cid = new URL(req.url, 'http://x').searchParams.get('c');
      if (cid) seenViewers.set(cid.slice(0, 40), Date.now());
      return send(res, 200, { proxyOk: viewerCount() < PROXY_MAX_VIEWERS, teams: db.teams, rev: db.rev, leagueName: db.leagueName, siteName: db.siteName, siteLogo: db.siteLogo, backgrounds: db.backgrounds, matches: db.matches, commentary: db.commentary });
    }

    if (m === 'POST' && p === '/api/login') {
      const b = await readBody(req);
      if (String(b.password ?? '').trim() === PASS) return send(res, 200, { token: TOKEN });
      return setTimeout(() => send(res, 401, { error: 'Wrong password' + (USING_DEFAULT_PASS ? ' (no ADMIN_PASSWORD is set on this server, so the default is in use)' : '') }), 800);
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
        if (m === 'PUT') { const nm = cleanMatch(await readBody(req), mm[1]); nm.extId = db.matches[i].extId || ''; db.matches[i] = nm; save(); return send(res, 200, db.matches[i]); }
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
      if (m === 'GET' && p === '/api/admin/sync') return send(res, 200, syncInfo());
      if (m === 'PUT' && p === '/api/admin/sync') {
        const b = await readBody(req);
        db.sync.enabled = !!b.enabled;
        db.sync.comps = (Array.isArray(b.comps) ? b.comps : []).filter(c => FD_COMPS[c]);
        db.sync.daysAhead = Math.min(Math.max(parseInt(b.daysAhead) || 10, 1), 30);
        save(false); return send(res, 200, syncInfo());
      }
      if (m === 'POST' && p === '/api/admin/sync/run') {
        try { const r = await syncFixtures('manual'); return send(res, 200, r); }
        catch (e) { return send(res, 400, { error: e.message }); }
      }
      if (m === 'PUT' && p === '/api/admin/commentary') {
        const b = await readBody(req);
        db.commentary = (Array.isArray(b.commentary) ? b.commentary : [])
          .map(c => ({ id: str(c.id, 20) || uid(), label: str(c.label, 40), url: str(c.url, 1000) }))
          .filter(c => c.label && isUrl(c.url)).slice(0, 10);
        save(); return send(res, 200, { ok: true });
      }
      if (m === 'POST' && p === '/api/admin/backgrounds') {
        const b = await readBody(req);
        const url = str(b.url, 500);
        if (!isUrl(url) && !isLogo(url)) return send(res, 400, { error: 'Enter a full picture link starting with http' });
        if (db.backgrounds.length >= 20) return send(res, 400, { error: 'Up to 20 backgrounds - delete one first' });
        const bg = { id: uid(), name: str(b.name, 40) || 'Background', url };
        db.backgrounds.push(bg); save(); return send(res, 200, bg);
      }
      const bgm = p.match(/^\/api\/admin\/backgrounds\/([a-f0-9]+)$/);
      if (bgm && m === 'DELETE') { db.backgrounds = db.backgrounds.filter(x => x.id !== bgm[1]); save(); return send(res, 200, { ok: true }); }
      if (m === 'PUT' && p === '/api/admin/settings') {
        const b = await readBody(req);
        db.leagueName = str(b.leagueName, 50) || db.leagueName;
        db.siteName = str(b.siteName, 40) || db.siteName;
        if (b.siteLogo !== undefined) db.siteLogo = isLogo(str(b.siteLogo, 500)) ? str(b.siteLogo, 500) : '';
        save();
        return send(res, 200, { ok: true });
      }
    }
    send(res, 404, { error: 'not found' });
  } catch (e) {
    send(res, 400, { error: String(e.message || e) });
  }
}).listen(PORT, () => {
  scheduleSync();
  console.log(FD_KEY ? 'Auto fixtures: ON (football-data.org)' : 'Auto fixtures: OFF (set FOOTBALL_DATA_API_KEY to enable)');
  console.log(`Viewer: http://localhost:${PORT}/`);
  console.log(`Admin:  http://localhost:${PORT}/admin   (password: ${PASS === 'admin123' ? 'admin123 - change it with ADMIN_PASSWORD' : '[from ADMIN_PASSWORD]'})`);
});

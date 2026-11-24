// Shared by index.html and match.html, so both pages read the same data the admin saves.
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

const viewerId = (() => {
  try { return localStorage.vid || (localStorage.vid = Math.random().toString(36).slice(2, 12)); }
  catch { return Math.random().toString(36).slice(2, 12); }
})();
let BG_LIB = [];
async function getState() {
  const r = await fetch('/api/state?c=' + viewerId, { cache: 'no-store' });
  if (!r.ok) throw new Error('state ' + r.status);
  const j = await r.json();
  BG_LIB = j.backgrounds || [];
  try { sessionStorage.vstate = JSON.stringify(j); } catch {}
  return j;
}

// A card background: a library id (picked in admin) or a picture link. Returns a CSS-safe URL or ''.
function bgUrl(ref) {
  if (!ref) return '';
  const hit = BG_LIB.find(b => b.id === ref);
  const u = hit ? hit.url : (/^(https?:\/\/|\/backgrounds\/)/i.test(ref) ? ref : '');
  return u.replace(/[\s'"()\\]/g, c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'));
}

// Logo space in the header: the uploaded logo, or the first letter of the site name
function siteMark(S) {
  const name = S.siteName || 'Rock Videos';
  if (S.siteLogo) return `<img class="site-logo" src="${esc(S.siteLogo)}" alt="${esc(name)}" data-fb="${esc(name.charAt(0).toUpperCase())}">`;
  return `<span class="site-mark" aria-hidden="true">${esc(name.charAt(0).toUpperCase())}</span>`;
}

// Badge image, or a lettered circle when there is no link or the image fails to load
function logo(url, name, big) {
  const size = big ? ' lg' : '';
  const letter = esc((name || '?').trim().charAt(0).toUpperCase());
  if (!url) return `<span class="fallback${size}">${letter}</span>`;
  return `<img class="logo${size}" src="${esc(url)}" alt="" loading="lazy" data-fb="${letter}">`;
}
document.addEventListener('error', e => {
  const t = e.target;
  if (t.tagName === 'IMG' && t.dataset.fb) {
    const s = document.createElement('span');
    s.className = 'fallback' + (t.classList.contains('lg') || t.classList.contains('site-logo') ? ' lg' : '');
    s.textContent = t.dataset.fb;
    t.replaceWith(s);
  }
}, true);

// "Today 21:30", "Tomorrow 23:06", "Sunday 15:00" - never a year
function whenLabel(iso) {
  const d = new Date(iso), now = new Date();
  const sod = x => new Date(x.getFullYear(), x.getMonth(), x.getDate());
  const days = Math.round((sod(d) - sod(now)) / 86400000);
  const time = d.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', hour12:false });
  let day;
  if (days === 0) day = 'Today';
  else if (days === 1) day = 'Tomorrow';
  else if (days === -1) day = 'Yesterday';
  else if (days > 1 && days < 7) day = d.toLocaleDateString('en-US', { weekday:'long' });
  else day = d.toLocaleDateString('en-US', { weekday:'short', day:'numeric', month:'short' });
  return day + ' ' + time;
}

// Live first, then pinned, then by kick-off time. Finished matches are hidden.
const visibleMatches = S => S.matches.filter(m => m.status !== 'finished').sort((a, b) =>
  (b.status === 'live') - (a.status === 'live') || (b.pinned - a.pinned) || new Date(a.kickoff) - new Date(b.kickoff));

function matchCard(m, currentId) {
  const bg = bgUrl(m.bg);
  const style = bg ? ` style="--bgimg:url('${esc(bg)}')"` : '';
  const live = m.status === 'live';
  return `<a class="card${m.id === currentId ? ' current' : ''}${live ? ' is-live' : ''}" href="/match?id=${encodeURIComponent(m.id)}"${style}>
    <div class="team">${logo(m.homeLogo, m.home, true)}<span>${esc(m.home)}</span></div>
    <div class="mid"><span class="vs">vs</span>${live ? '<span class="live">● LIVE</span>' : `<span class="when">${esc(whenLabel(m.kickoff))}</span>`}</div>
    <div class="team">${logo(m.awayLogo, m.away, true)}<span>${esc(m.away)}</span></div></a>`;
}
function leagueCards(list, currentId) {
  const groups = new Map();
  for (const m of list) { if (!groups.has(m.league)) groups.set(m.league, []); groups.get(m.league).push(m); }
  return [...groups].map(([name, ms]) => {
    const lg = (ms.find(x => x.leagueLogo) || {}).leagueLogo || '';
    const n = ms.length;
    return `<section class="league"><div class="league-head">${logo(lg, name)}<h2>${esc(name)}</h2><span class="count">${n} match${n === 1 ? '' : 'es'}</span></div><div class="cards">${ms.map(m => matchCard(m, currentId)).join('')}</div></section>`;
  }).join('');
}

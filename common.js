// Shared by index.html and match.html, so both pages read the same data the admin saves.
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

const viewerId = (() => {
  try { return localStorage.vid || (localStorage.vid = Math.random().toString(36).slice(2, 12)); }
  catch { return Math.random().toString(36).slice(2, 12); }
})();
async function getState() {
  const r = await fetch('/api/state?c=' + viewerId, { cache: 'no-store' });
  if (!r.ok) throw new Error('state ' + r.status);
  const j = await r.json();
  try { sessionStorage.vstate = JSON.stringify(j); } catch {}
  return j;
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
    s.className = 'fallback' + (t.classList.contains('lg') ? ' lg' : '');
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
  return `<a class="card${m.id === currentId ? ' current' : ''}" href="/match?id=${encodeURIComponent(m.id)}">
    <div class="team">${logo(m.homeLogo, m.home, true)}<span>${esc(m.home)}</span></div>
    <div class="mid"><span class="vs">vs</span>${m.status === 'live' ? '<span class="live">LIVE</span>' : `<span class="when">${esc(whenLabel(m.kickoff))}</span>`}</div>
    <div class="team">${logo(m.awayLogo, m.away, true)}<span>${esc(m.away)}</span></div></a>`;
}
function leagueCards(list, currentId) {
  const groups = new Map();
  for (const m of list) { if (!groups.has(m.league)) groups.set(m.league, []); groups.get(m.league).push(m); }
  return [...groups].map(([name, ms]) => {
    const lg = (ms.find(x => x.leagueLogo) || {}).leagueLogo || '';
    return `<section class="league"><div class="league-head">${logo(lg, name)}<h2>${esc(name)}</h2></div>${ms.map(m => matchCard(m, currentId)).join('')}</section>`;
  }).join('');
}

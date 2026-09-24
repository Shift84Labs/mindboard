/* ============ MindBoard display mode (read-only) ============ */

let notes = [];
let tags = [];
let period = localStorage.getItem('mb-display-period') || 'all';

const $ = (id) => document.getElementById(id);
const tagById = (id) => tags.find((t) => t.id === id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' · ' +
    d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

// theme, font and layout are the board's, shared with index.html through the server;
// localStorage is only a cache so the first paint is right before the server answers
const prefs = { theme: 'dark', font: 'roboto', ui: 'auto' };
for (const k of Object.keys(prefs)) prefs[k] = localStorage.getItem('mb-' + k) || prefs[k];
const mobileQuery = matchMedia('(max-width: 820px)');
const detectMobile = () => mobileQuery.matches;

function applyPrefs() {
  document.documentElement.dataset.theme = prefs.theme;
  document.documentElement.dataset.font = prefs.font;
  const mode = prefs.ui === 'auto' ? (detectMobile() ? 'mobile' : 'desktop') : prefs.ui;
  document.documentElement.dataset.ui = mode;
  const btn = $('uiModeToggle');
  if (btn) {
    btn.textContent = mode === 'mobile' ? '🖥' : '📱';
    btn.title = (mode === 'mobile' ? 'Switch to desktop layout' : 'Switch to mobile layout') +
      (prefs.ui === 'auto' ? ' (currently auto-detected)' : '');
  }
}
function setPref(key, value) {
  prefs[key] = value;
  localStorage.setItem('mb-' + key, value);
  applyPrefs();
  fetch('/api/prefs', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [key]: value }),
  }).catch(() => {});
}
applyPrefs();
mobileQuery.addEventListener('change', applyPrefs);
window.addEventListener('resize', applyPrefs);
fetch('/api/prefs').then((r) => r.json()).then((saved) => {
  for (const k of Object.keys(prefs)) if (saved[k]) prefs[k] = saved[k];
  for (const k of Object.keys(prefs)) localStorage.setItem('mb-' + k, prefs[k]);
  applyPrefs();
}).catch(() => {});
document.addEventListener('DOMContentLoaded', () => {
  $('uiModeToggle').onclick = () => {
    const next = document.documentElement.dataset.ui === 'mobile' ? 'desktop' : 'mobile';
    setPref('ui', next === (detectMobile() ? 'mobile' : 'desktop') ? 'auto' : next);
  };
  applyPrefs();
});

function periodStart(p) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (p === 'today') return start;
  if (p === 'week') {
    const dow = (start.getDay() + 6) % 7; // Monday start
    start.setDate(start.getDate() - dow);
    return start;
  }
  if (p === 'month') return new Date(now.getFullYear(), now.getMonth(), 1);
  return null; // all
}

function inPeriod(n) {
  const start = periodStart(period);
  if (!start) return true;
  return new Date(n.updatedAt) >= start || new Date(n.createdAt) >= start;
}

function noteCard(n) {
  const card = document.createElement('div');
  card.className = 'note-card' + (n.pinned ? ' pinned-card' : '');
  if (n.color) card.style.borderColor = n.color;
  if (n.textColor) card.style.color = n.textColor;
  const done = n.checklist.filter((c) => c.done).length;
  card.innerHTML = `
    <div class="dates">
      <span>${n.pinned ? '<span class="pin-flag">📌 PINNED · </span>' : ''}${fmtDate(n.createdAt)}</span>
      ${n.updatedAt !== n.createdAt ? `<span title="Last edited">✎ ${fmtDate(n.updatedAt)}</span>` : ''}
    </div>
    ${n.tags.length ? `<div class="card-tags">${n.tags.map((id) => {
      const t = tagById(id);
      return t ? `<span class="card-tag" style="background:${esc(t.color)}">#${esc(t.name)}</span>` : '';
    }).join('')}</div>` : ''}
    ${n.title ? `<h3>${esc(n.title)}</h3>` : ''}
    ${n.text ? `<div class="body-text">${esc(n.text)}</div>` : ''}
    ${n.checklist.length ? `<div class="card-checklist">${n.checklist.map((item) =>
      `<div class="check-item ${item.done ? 'done' : ''}"><input type="checkbox" disabled ${item.done ? 'checked' : ''}/><span>${esc(item.text)}</span></div>`
    ).join('')}</div><div class="check-progress">${done}/${n.checklist.length} done</div>` : ''}
    ${n.images.length ? `<div class="card-images">${n.images.map((u) => `<img src="${esc(u)}" loading="lazy"/>`).join('')}</div>` : ''}
  `;
  return card;
}

function render() {
  document.querySelectorAll('.period-btn').forEach((b) =>
    b.classList.toggle('active', b.dataset.period === period));
  const board = $('board');
  board.innerHTML = '';
  const visible = notes.filter(inPeriod);
  const pinned = visible.filter((n) => n.pinned);
  const rest = visible.filter((n) => !n.pinned);
  if (pinned.length) {
    const lbl = document.createElement('div');
    lbl.className = 'section-label';
    lbl.textContent = '📌 Pinned';
    board.appendChild(lbl);
    pinned.forEach((n) => board.appendChild(noteCard(n)));
    if (rest.length) {
      const lbl2 = document.createElement('div');
      lbl2.className = 'section-label';
      lbl2.textContent = 'Notes';
      board.appendChild(lbl2);
    }
  }
  rest.forEach((n) => board.appendChild(noteCard(n)));
  $('displayEmpty').hidden = visible.length > 0;
  $('displayMeta').textContent =
    `${visible.length} note${visible.length === 1 ? '' : 's'} · updated ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · refreshes every 5 min`;
}

document.querySelectorAll('.period-btn').forEach((b) => {
  b.onclick = () => {
    period = b.dataset.period;
    localStorage.setItem('mb-display-period', period);
    render();
  };
});

async function load() {
  [notes, tags] = await Promise.all([
    (await fetch('/api/notes')).json(),
    (await fetch('/api/tags')).json(),
  ]);
  render();
}

load();
// full reload every 5 minutes so the display device always shows current state
setTimeout(() => location.reload(), 5 * 60 * 1000);

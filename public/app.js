/* ============ MindBoard frontend ============ */

const OUTLINE_COLORS = ['#4ade80', '#60a5fa', '#f87171', '#fbbf24', '#c084fc', '#f472b6', '#34d399', '#fb923c', '#22d3ee', '#a3e635', '#94a3b8', '#e879f9'];
const TEXT_COLORS = ['#4ade80', '#60a5fa', '#f87171', '#fbbf24', '#c084fc', '#f472b6', '#34d399', '#fb923c', '#22d3ee', '#a3e635'];
const TAG_COLORS = ['#4ade80', '#60a5fa', '#f87171', '#fbbf24', '#c084fc', '#f472b6', '#34d399', '#fb923c', '#22d3ee', '#a3e635', '#94a3b8', '#e879f9'];

let notes = [];
let tags = [];
let activeTagIds = new Set();
let searchQuery = '';

// editing state
let editingNote = null; // working copy
let editingIsNew = false;
let editingMode = 'note'; // 'note' | 'list'
let newTagColor = TAG_COLORS[0];

const $ = (id) => document.getElementById(id);

/* ============ api ============ */
const api = {
  async get(url) { return (await fetch(url)).json(); },
  async send(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error((await res.json()).error || 'Request failed');
    return res.json();
  },
};

/* ============ helpers ============ */
function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' · ' +
    d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
function tagById(id) { return tags.find((t) => t.id === id); }
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ============ preferences: theme, font, layout ============ */
// Saved on the server so every device showing this board agrees. localStorage is only a cache,
// so the first paint has the right theme before the server answers.
const PREF_INPUTS = { theme: 'prefTheme', font: 'prefFont', ui: 'prefUi' };
const prefs = { theme: 'dark', font: 'roboto', ui: 'auto' };
for (const k of Object.keys(prefs)) prefs[k] = localStorage.getItem('mb-' + k) || prefs[k];

function applyPrefs() {
  document.documentElement.dataset.theme = prefs.theme;
  document.documentElement.dataset.font = prefs.font;
  applyUiMode();
}
async function loadPrefs() {
  try {
    const saved = await api.get('/api/prefs');
    for (const k of Object.keys(prefs)) if (saved[k]) prefs[k] = saved[k];
  } catch {
    // offline or signed out: keep the cached copy
  }
  for (const k of Object.keys(prefs)) localStorage.setItem('mb-' + k, prefs[k]);
  applyPrefs();
}
function setPref(key, value) {
  prefs[key] = value;
  localStorage.setItem('mb-' + key, value);
  applyPrefs();
  api.send('PUT', '/api/prefs', { [key]: value }).catch(() => {});
}
$('themeToggle').onclick = () => setPref('theme', prefs.theme === 'light' ? 'dark' : 'light');
for (const [k, id] of Object.entries(PREF_INPUTS)) $(id).onchange = (e) => setPref(k, e.target.value);

/* ============ settings ============ */
async function openSettings() {
  for (const [k, id] of Object.entries(PREF_INPUTS)) $(id).value = prefs[k];
  $('settingsAccount').textContent = '';
  $('settingsStatus').innerHTML = '';
  $('tgPairInfo').hidden = true;
  $('settingsModal').hidden = false;
  try {
    const [me, status] = await Promise.all([api.get('/api/me'), api.get('/api/status')]);
    $('settingsAccount').textContent = me.mode === 'none'
      ? 'No sign-in: anyone who can reach this board can use it (AUTH_MODE=none)'
      : `${me.user.displayName} (${me.user.email || me.user.id}), ${me.user.role}`;
    $('signOutForm').hidden = me.mode !== 'oidc';
    renderTelegram(status.telegram);
    const rows = [
      ['Notes', status.counts.notes], ['Tags', status.counts.tags], ['Widgets', status.counts.widgets],
      ['Reminders', status.counts.reminders], ['Images', status.counts.uploads],
      ['Version', status.version + (status.commit ? ` (${status.commit})` : '')],
    ];
    $('settingsStatus').innerHTML = rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
  } catch {
    $('settingsAccount').textContent = 'Could not reach the server';
  }
}
$('settingsBtn').onclick = openSettings;
$('closeSettings').onclick = () => { $('settingsModal').hidden = true; };

/* ============ telegram status ============ */
const TG_LABELS = { disabled: 'off', connecting: 'connecting', connected: 'connected', disconnected: 'disconnected' };
const TG_TEXT = {
  disabled: () => 'Off: set TELEGRAM_BOT_TOKEN on the server to enable the bridge.',
  connecting: () => 'Connecting to the Bot API.',
  connected: (tg) => `Connected as @${tg.bot}.`,
  disconnected: (tg) => `Disconnected: ${tg.detail}. The bridge reconnects on its own, and reminders are retried until it does.`,
};
// the pill shows every state; clicking it opens Settings, where the chat is linked
async function refreshTelegramStatus() {
  try {
    const tg = await api.get('/api/telegram');
    if (!tg.status) return;
    const pill = $('telegramStatus');
    pill.dataset.state = tg.status;
    pill.querySelector('.btn-txt').textContent = 'Telegram ' + (TG_LABELS[tg.status] || tg.status);
    pill.title = (TG_TEXT[tg.status] || (() => tg.status))(tg);
    pill.hidden = false;
  } catch {
    // board server unreachable: leave the indicator as it was
  }
}
refreshTelegramStatus();
setInterval(refreshTelegramStatus, 30 * 1000);
$('telegramStatus').onclick = () => openSettings();

function renderTelegram(tg) {
  $('tgState').textContent = (TG_TEXT[tg.status] || (() => tg.status))(tg);
  const on = tg.status !== 'disabled';
  $('tgLinkRow').hidden = !on;
  if (!on) return;
  const linked = tg.chats.length > 0;
  $('tgLinkText').textContent = linked
    ? `Linked to chat ${tg.chats.join(', ')}: messages land on this board and its reminders go there.`
    : 'Not linked: reminders and timer alerts have nowhere to go.';
  $('tgLinkBtn').hidden = linked;
  $('tgUnlinkBtn').hidden = !linked;
  if (linked) $('tgPairInfo').hidden = true;
}
$('tgLinkBtn').onclick = async () => {
  const info = $('tgPairInfo');
  info.textContent = '';
  info.hidden = false;
  try {
    const { code, bot, expiresAt } = await api.send('POST', '/api/telegram/pair');
    const mins = Math.max(1, Math.round((Date.parse(expiresAt) - Date.now()) / 60000));
    info.append(`In Telegram, send /start ${code} to ${bot ? '@' + bot : 'the bot'} within ${mins} minutes`);
    if (bot) {
      const a = document.createElement('a');
      a.href = `https://t.me/${encodeURIComponent(bot)}?start=${encodeURIComponent(code)}`;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = 'open the chat';
      info.append(', or ', a, ' and press Start.');
    }
    // flip to "linked" as soon as the code arrives from the chat
    const poll = setInterval(async () => {
      if ($('settingsModal').hidden || info.hidden) return clearInterval(poll);
      const status = await api.get('/api/status').catch(() => null);
      if (status && status.telegram.chats.length) {
        clearInterval(poll);
        renderTelegram(status.telegram);
      }
    }, 3000);
  } catch (e) {
    info.textContent = e.message;
  }
};
$('tgUnlinkBtn').onclick = async () => {
  await api.send('DELETE', '/api/telegram/pair').catch(() => {});
  openSettings();
};

/* ============ mobile / desktop layout mode ============ */
const mobileQuery = matchMedia('(max-width: 820px)');
function detectMobile() {
  return mobileQuery.matches;
}
mobileQuery.addEventListener('change', () => applyUiMode());
function applyUiMode() {
  document.documentElement.dataset.ui = prefs.ui === 'auto' ? (detectMobile() ? 'mobile' : 'desktop') : prefs.ui;
}
window.addEventListener('resize', applyUiMode);

/* ============ tag row ============ */
function renderTagRow() {
  const row = $('tagRow');
  row.querySelectorAll('.tag-bubble').forEach((el) => el.remove());
  const sorted = [...tags].sort((a, b) => (b.pinned - a.pinned) || a.name.localeCompare(b.name));
  for (const t of sorted) {
    const btn = document.createElement('button');
    btn.className = 'tag-chip tag-bubble' + (activeTagIds.has(t.id) ? ' active' : '');
    btn.innerHTML = `<span class="dot" style="background:${esc(t.color)}"></span>#${esc(t.name)}${t.pinned ? ' <span class="pin-mark">📌</span>' : ''}`;
    btn.onclick = () => {
      activeTagIds.has(t.id) ? activeTagIds.delete(t.id) : activeTagIds.add(t.id);
      renderTagRow();
      renderBoard();
    };
    row.appendChild(btn);
  }
}

/* ============ board ============ */
function noteMatches(n) {
  if (activeTagIds.size && ![...activeTagIds].every((id) => n.tags.includes(id))) return false;
  if (!searchQuery) return true;
  const q = searchQuery.toLowerCase();
  const tagNames = n.tags.map((id) => tagById(id)?.name.toLowerCase() || '');
  return (
    n.title.toLowerCase().includes(q) ||
    n.text.toLowerCase().includes(q) ||
    n.checklist.some((c) => c.text.toLowerCase().includes(q)) ||
    tagNames.some((name) => name.includes(q) || ('#' + name).includes(q))
  );
}

function noteCard(n) {
  const card = document.createElement('div');
  card.className = 'note-card' + (n.pinned ? ' pinned-card' : '');
  if (n.color) card.style.borderColor = n.color;
  if (n.textColor) card.style.color = n.textColor;

  const done = n.checklist.filter((c) => c.done).length;
  card.dataset.id = n.id;
  card.innerHTML = `
    <div class="dates">
      <span>${n.pinned ? '<span class="pin-flag">📌 PINNED · </span>' : ''}${fmtDate(n.createdAt)}</span>
      ${n.updatedAt !== n.createdAt ? `<span title="Last edited">✎ ${fmtDate(n.updatedAt)}</span>` : ''}
    </div>
    ${n.reminder?.enabled ? `<div class="card-reminder">⏰ ${fmtDate(n.reminder.at)}${n.reminder.freq !== 'once' ? ' · ' + esc(n.reminder.freq) : ''}</div>` : ''}
    ${n.tags.length ? `<div class="card-tags">${n.tags.map((id) => {
      const t = tagById(id);
      return t ? `<span class="card-tag" style="background:${esc(t.color)}">#${esc(t.name)}</span>` : '';
    }).join('')}</div>` : ''}
    ${n.title ? `<h3>${esc(n.title)}</h3>` : ''}
    ${n.text ? `<div class="body-text">${esc(n.text)}</div>` : ''}
  `;

  if (n.checklist.length) {
    const list = document.createElement('div');
    list.className = 'card-checklist';
    n.checklist.forEach((item, idx) => {
      const row = document.createElement('label');
      row.className = 'check-item' + (item.done ? ' done' : '');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = item.done;
      cb.onclick = async (e) => {
        e.stopPropagation();
        n.checklist[idx].done = cb.checked;
        await api.send('PUT', '/api/notes/' + n.id, { checklist: n.checklist });
        renderBoard();
      };
      const span = document.createElement('span');
      span.textContent = item.text;
      row.append(cb, span);
      list.appendChild(row);
    });
    card.appendChild(list);
    const prog = document.createElement('div');
    prog.className = 'check-progress';
    prog.textContent = `${done}/${n.checklist.length} done`;
    card.appendChild(prog);
  }

  if (n.images.length) {
    const imgs = document.createElement('div');
    imgs.className = 'card-images';
    for (const url of n.images) {
      const img = document.createElement('img');
      img.src = url;
      img.loading = 'lazy';
      imgs.appendChild(img);
    }
    card.appendChild(imgs);
  }

  card.onclick = () => openNoteModal(n);
  return card;
}

function renderBoard() {
  const board = $('board');
  board.innerHTML = '';
  const visible = notes.filter(noteMatches);
  $('emptyState').hidden = notes.length > 0;

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

  if (notes.length && !visible.length) {
    const none = document.createElement('p');
    none.className = 'muted';
    none.style.columnSpan = 'all';
    none.textContent = 'No notes match your search.';
    board.appendChild(none);
  }
}

/* ============ search ============ */
$('searchInput').oninput = (e) => {
  searchQuery = e.target.value.trim();
  e.target.parentElement.classList.toggle('has-text', !!searchQuery);
  renderBoard();
};
$('clearSearch').onclick = () => {
  $('searchInput').value = '';
  searchQuery = '';
  $('searchInput').parentElement.classList.remove('has-text');
  renderBoard();
};

/* ============ note modal ============ */
function openNoteModal(n) {
  editingIsNew = !n;
  editingNote = n
    ? JSON.parse(JSON.stringify(n))
    : { title: '', text: '', checklist: [], tags: [], color: '', textColor: '', images: [], pinned: false };
  editingMode = editingNote.checklist.length ? 'list' : 'note';

  $('noteModalDates').textContent = n
    ? `Created ${fmtDate(n.createdAt)}${n.updatedAt !== n.createdAt ? ' · Edited ' + fmtDate(n.updatedAt) : ''}`
    : 'New note';
  $('noteTitle').value = editingNote.title;
  $('noteText').value = editingNote.text;
  $('deleteNoteBtn').style.display = editingIsNew ? 'none' : '';
  updatePinBtn();
  loadReminderEditor();
  setMode(editingMode);
  renderChecklistEditor();
  renderNoteImages();
  renderTagPicker();
  renderSwatches();
  $('noteModal').hidden = false;
  $('noteTitle').focus();
}

function closeNoteModal() {
  $('noteModal').hidden = true;
  editingNote = null;
}

function setMode(mode) {
  editingMode = mode;
  $('modeNote').classList.toggle('active', mode === 'note');
  $('modeList').classList.toggle('active', mode === 'list');
  $('noteText').hidden = false; // text always available
  $('checklistEditor').hidden = mode !== 'list';
  if (mode === 'list' && editingNote.checklist.length === 0) addChecklistItem();
}
$('modeNote').onclick = () => setMode('note');
$('modeList').onclick = () => setMode('list');

function updatePinBtn() {
  $('pinNoteBtn').classList.toggle('pinned-active', editingNote.pinned);
  $('pinNoteBtn').textContent = editingNote.pinned ? '📌 Pinned' : '📌 Pin';
}
$('pinNoteBtn').onclick = () => {
  editingNote.pinned = !editingNote.pinned;
  updatePinBtn();
};

/* --- reminder editor --- */
function loadReminderEditor() {
  const r = editingNote.reminder;
  const on = !!(r && r.enabled);
  $('reminderToggle').classList.toggle('active', on);
  $('reminderEditor').hidden = !on;
  if (on) {
    const d = new Date(r.at);
    $('reminderDate').value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    $('reminderTime').value = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    $('reminderFreq').value = r.freq || 'once';
  }
}
function defaultReminderTime() {
  const d = new Date(Date.now() + 60 * 60 * 1000); // one hour from now
  d.setMinutes(0, 0, 0);
  return d;
}
$('reminderToggle').onclick = () => {
  const on = $('reminderEditor').hidden;
  $('reminderEditor').hidden = !on;
  $('reminderToggle').classList.toggle('active', on);
  if (on && !$('reminderDate').value) {
    const d = defaultReminderTime();
    $('reminderDate').value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    $('reminderTime').value = `${String(d.getHours()).padStart(2, '0')}:00`;
  }
};
$('reminderClear').onclick = () => {
  $('reminderEditor').hidden = true;
  $('reminderToggle').classList.remove('active');
  $('reminderDate').value = '';
  $('reminderTime').value = '';
};
function readReminder() {
  if ($('reminderEditor').hidden || !$('reminderDate').value || !$('reminderTime').value) return null;
  const [y, m, d] = $('reminderDate').value.split('-').map(Number);
  const [hh, mm] = $('reminderTime').value.split(':').map(Number);
  return {
    at: new Date(y, m - 1, d, hh, mm).toISOString(),
    freq: $('reminderFreq').value,
    enabled: true,
  };
}

/* --- checklist editor --- */
function renderChecklistEditor() {
  const wrap = $('checklistItems');
  wrap.innerHTML = '';
  editingNote.checklist.forEach((item, idx) => {
    const row = document.createElement('div');
    row.className = 'checklist-row';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = item.done;
    cb.onchange = () => (editingNote.checklist[idx].done = cb.checked);
    const txt = document.createElement('input');
    txt.type = 'text';
    txt.value = item.text;
    txt.placeholder = 'Item ' + (idx + 1);
    txt.oninput = () => (editingNote.checklist[idx].text = txt.value);
    txt.onkeydown = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); addChecklistItem(); }
    };
    const rm = document.createElement('button');
    rm.className = 'remove-item';
    rm.textContent = '✕';
    rm.onclick = () => {
      editingNote.checklist.splice(idx, 1);
      renderChecklistEditor();
    };
    row.append(cb, txt, rm);
    wrap.appendChild(row);
  });
}
function addChecklistItem() {
  editingNote.checklist.push({ text: '', done: false });
  renderChecklistEditor();
  const inputs = $('checklistItems').querySelectorAll('input[type=text]');
  inputs[inputs.length - 1]?.focus();
}
$('addChecklistItem').onclick = addChecklistItem;

/* --- images --- */
function renderNoteImages() {
  const wrap = $('noteImages');
  wrap.innerHTML = '';
  editingNote.images.forEach((url, idx) => {
    const div = document.createElement('div');
    div.className = 'img-thumb';
    div.innerHTML = `<img src="${esc(url)}" />`;
    const rm = document.createElement('button');
    rm.className = 'remove-img';
    rm.textContent = '✕';
    rm.title = 'Remove image';
    rm.onclick = () => {
      editingNote.images.splice(idx, 1);
      renderNoteImages();
    };
    div.appendChild(rm);
    wrap.appendChild(div);
  });
}
$('imageUpload').onchange = async (e) => {
  for (const file of e.target.files) {
    const fd = new FormData();
    fd.append('image', file);
    try {
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      if (!res.ok) throw new Error('upload failed');
      const { url } = await res.json();
      editingNote.images.push(url);
    } catch {
      alert('Image upload failed: ' + file.name);
    }
  }
  e.target.value = '';
  renderNoteImages();
};

/* --- tag picker --- */
function renderTagPicker() {
  const wrap = $('noteTagPicker');
  wrap.innerHTML = '';
  if (!tags.length) {
    wrap.innerHTML = '<span class="muted small">No tags yet — create one from the dashboard.</span>';
    return;
  }
  for (const t of tags) {
    const btn = document.createElement('button');
    const on = editingNote.tags.includes(t.id);
    btn.className = 'tag-chip' + (on ? ' active' : '');
    btn.innerHTML = `<span class="dot" style="background:${esc(t.color)}"></span>#${esc(t.name)}`;
    btn.onclick = () => {
      const i = editingNote.tags.indexOf(t.id);
      i >= 0 ? editingNote.tags.splice(i, 1) : editingNote.tags.push(t.id);
      renderTagPicker();
    };
    wrap.appendChild(btn);
  }
}

/* --- color swatches --- */
function swatchRow(container, colors, selected, onPick) {
  container.innerHTML = '';
  const none = document.createElement('button');
  none.className = 'swatch none' + (!selected ? ' selected' : '');
  none.textContent = '∅';
  none.title = 'Default';
  none.onclick = () => onPick('');
  container.appendChild(none);
  for (const c of colors) {
    const b = document.createElement('button');
    b.className = 'swatch' + (selected === c ? ' selected' : '');
    b.style.background = c;
    b.onclick = () => onPick(c);
    container.appendChild(b);
  }
}
function renderSwatches() {
  swatchRow($('outlineColors'), OUTLINE_COLORS, editingNote.color, (c) => {
    editingNote.color = c;
    renderSwatches();
  });
  swatchRow($('textColors'), TEXT_COLORS, editingNote.textColor, (c) => {
    editingNote.textColor = c;
    renderSwatches();
  });
}

/* --- save / delete --- */
$('saveNoteBtn').onclick = async () => {
  editingNote.title = $('noteTitle').value.trim();
  editingNote.text = $('noteText').value;
  editingNote.checklist = editingNote.checklist.filter((c) => c.text.trim());
  editingNote.reminder = readReminder();
  if (!editingNote.title && !editingNote.text.trim() && !editingNote.checklist.length && !editingNote.images.length) {
    closeNoteModal();
    return;
  }
  if (editingIsNew) {
    await api.send('POST', '/api/notes', editingNote);
  } else {
    await api.send('PUT', '/api/notes/' + editingNote.id, editingNote);
  }
  closeNoteModal();
  await loadData();
};
$('deleteNoteBtn').onclick = async () => {
  if (!confirm('Delete this note?')) return;
  await api.send('DELETE', '/api/notes/' + editingNote.id);
  closeNoteModal();
  await loadData();
};
$('cancelNoteBtn').onclick = closeNoteModal;
$('closeNoteModal').onclick = closeNoteModal;
$('addNoteBtn').onclick = () => openNoteModal(null);

/* ============ tag modal ============ */
function openTagModal(mode) {
  $('tagModalTitle').textContent = mode === 'create' ? 'Add Tag' : 'Edit Tags';
  $('tagCreateSection').hidden = mode !== 'create';
  $('tagEditSection').hidden = mode !== 'edit';
  if (mode === 'create') {
    $('tagNameInput').value = '';
    newTagColor = TAG_COLORS[0];
    openTagModalColorRefresh();
  } else {
    renderTagEditList();
  }
  $('tagModal').hidden = false;
  if (mode === 'create') $('tagNameInput').focus();
}
function openTagModalColorRefresh() {
  swatchRowSimple($('tagColorRow'), TAG_COLORS, newTagColor, (c) => {
    newTagColor = c;
    openTagModalColorRefresh();
  });
}
function swatchRowSimple(container, colors, selected, onPick) {
  container.innerHTML = '';
  for (const c of colors) {
    const b = document.createElement('button');
    b.className = 'swatch' + (selected === c ? ' selected' : '');
    b.style.background = c;
    b.onclick = () => onPick(c);
    container.appendChild(b);
  }
}
function closeTagModal() { $('tagModal').hidden = true; }
$('closeTagModal').onclick = closeTagModal;
$('addTagBtn').onclick = () => openTagModal('create');
$('editTagsBtn').onclick = () => openTagModal('edit');

$('createTagBtn').onclick = async () => {
  const name = $('tagNameInput').value.trim();
  if (!name) return;
  try {
    await api.send('POST', '/api/tags', { name, color: newTagColor });
    closeTagModal();
    await loadData();
  } catch (err) {
    alert(err.message);
  }
};
$('tagNameInput').onkeydown = (e) => { if (e.key === 'Enter') $('createTagBtn').click(); };

function renderTagEditList() {
  const wrap = $('tagEditList');
  wrap.innerHTML = '';
  if (!tags.length) {
    wrap.innerHTML = '<p class="muted small">No tags yet.</p>';
    return;
  }
  for (const t of tags) {
    const row = document.createElement('div');
    row.className = 'tag-edit-row';

    const color = document.createElement('input');
    color.type = 'color';
    color.value = t.color;
    color.title = 'Tag color';
    color.onchange = async () => {
      await api.send('PUT', '/api/tags/' + t.id, { color: color.value });
      await loadData();
      renderTagEditList();
    };

    const name = document.createElement('input');
    name.type = 'text';
    name.value = '#' + t.name;
    name.onchange = async () => {
      const v = name.value.trim();
      if (!v) { name.value = '#' + t.name; return; }
      await api.send('PUT', '/api/tags/' + t.id, { name: v });
      await loadData();
      renderTagEditList();
    };

    const pin = document.createElement('button');
    pin.className = 'mini-btn' + (t.pinned ? ' pin-on' : '');
    pin.textContent = '📌';
    pin.title = t.pinned ? 'Unpin tag' : 'Pin tag (shows first in the tag bar)';
    pin.onclick = async () => {
      await api.send('PUT', '/api/tags/' + t.id, { pinned: !t.pinned });
      await loadData();
      renderTagEditList();
    };

    const del = document.createElement('button');
    del.className = 'mini-btn danger';
    del.textContent = '🗑';
    del.title = 'Delete tag';
    del.onclick = async () => {
      if (!confirm(`Delete tag #${t.name}? It will be removed from all notes.`)) return;
      await api.send('DELETE', '/api/tags/' + t.id);
      activeTagIds.delete(t.id);
      await loadData();
      renderTagEditList();
    };

    row.append(color, name, pin, del);
    wrap.appendChild(row);
  }
}

/* ============ global ============ */
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closeNoteModal(); closeTagModal(); $('settingsModal').hidden = true; }
});
$('noteModal').addEventListener('mousedown', (e) => { if (e.target === $('noteModal')) closeNoteModal(); });
$('tagModal').addEventListener('mousedown', (e) => { if (e.target === $('tagModal')) closeTagModal(); });
$('settingsModal').addEventListener('mousedown', (e) => { if (e.target === $('settingsModal')) $('settingsModal').hidden = true; });

/* ============ right-click context menus ============ */
const ctxMenu = document.createElement('div');
ctxMenu.className = 'ctx-menu';
ctxMenu.hidden = true;
document.body.appendChild(ctxMenu);

function hideCtx() { ctxMenu.hidden = true; }
document.addEventListener('click', hideCtx);
document.addEventListener('scroll', hideCtx, true);
window.addEventListener('resize', hideCtx);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideCtx(); });

function showCtx(x, y, items) {
  ctxMenu.innerHTML = '';
  for (const item of items) {
    if (item.sep) {
      const s = document.createElement('div');
      s.className = 'ctx-sep';
      ctxMenu.appendChild(s);
      continue;
    }
    if (item.custom) { ctxMenu.appendChild(item.custom); continue; }
    const btn = document.createElement('button');
    btn.className = 'ctx-item' + (item.danger ? ' danger' : '');
    btn.innerHTML = item.label;
    btn.onclick = (e) => { e.stopPropagation(); hideCtx(); item.onclick(); };
    ctxMenu.appendChild(btn);
  }
  ctxMenu.hidden = false;
  const mw = ctxMenu.offsetWidth, mh = ctxMenu.offsetHeight;
  ctxMenu.style.left = Math.min(x, window.innerWidth - mw - 8) + 'px';
  ctxMenu.style.top = Math.min(y, window.innerHeight - mh - 8) + 'px';
}

function colorSwatchMenuRow(current, onPick) {
  const row = document.createElement('div');
  row.className = 'ctx-swatches';
  const none = document.createElement('button');
  none.className = 'swatch none' + (!current ? ' selected' : '');
  none.textContent = '∅';
  none.onclick = (e) => { e.stopPropagation(); hideCtx(); onPick(''); };
  row.appendChild(none);
  for (const c of OUTLINE_COLORS) {
    const b = document.createElement('button');
    b.className = 'swatch' + (current === c ? ' selected' : '');
    b.style.background = c;
    b.onclick = (e) => { e.stopPropagation(); hideCtx(); onPick(c); };
    row.appendChild(b);
  }
  return row;
}

function noteCtxItems(n) {
  return [
    {
      label: n.pinned ? '📌 Unpin note' : '📌 Pin note',
      onclick: async () => {
        await api.send('PUT', '/api/notes/' + n.id, { pinned: !n.pinned });
        await loadData();
      },
    },
    {
      label: '🎨 Outline color…',
      onclick: () => {
        showCtx(parseFloat(ctxMenu.style.left), parseFloat(ctxMenu.style.top), [
          { custom: colorSwatchMenuRow(n.color, async (c) => {
            await api.send('PUT', '/api/notes/' + n.id, { color: c });
            await loadData();
          }) },
        ]);
      },
    },
    {
      label: n.reminder?.enabled ? '⏰ Edit reminder…' : '⏰ Add to calendar / remind…',
      onclick: () => {
        openNoteModal(n);
        if ($('reminderEditor').hidden) $('reminderToggle').click();
        $('reminderEditor').classList.add('flash');
        setTimeout(() => $('reminderEditor').classList.remove('flash'), 1200);
      },
    },
    { label: '✏️ Edit note', onclick: () => openNoteModal(n) },
    { sep: true },
    {
      label: '🗑 Delete note',
      danger: true,
      onclick: async () => {
        if (!confirm('Delete this note?')) return;
        await api.send('DELETE', '/api/notes/' + n.id);
        await loadData();
      },
    },
  ];
}

function widgetCtxItems(id) {
  const items = [];
  if (window.WidgetAPI?.hasConfig(id)) {
    items.push({ label: '⚙ Widget settings…', onclick: () => window.WidgetAPI.openConfig(id) });
  }
  items.push({ label: '⊞ Edit widget layout', onclick: () => window.WidgetAPI?.toggleEdit() });
  items.push({ sep: true });
  items.push({
    label: '✕ Remove widget',
    danger: true,
    onclick: () => window.WidgetAPI?.remove(id),
  });
  return items;
}

function backgroundCtxItems() {
  return [
    { label: '➕ New note', onclick: () => openNoteModal(null) },
    { label: '# New tag', onclick: () => openTagModal('create') },
    { label: '⊞ Edit widgets', onclick: () => window.WidgetAPI?.toggleEdit() },
    { sep: true },
    { label: '◐ Toggle light / dark', onclick: () => $('themeToggle').click() },
    { label: '📺 Display mode', onclick: () => (location.href = 'display.html') },
  ];
}

document.addEventListener('contextmenu', (e) => {
  // keep the native menu inside text fields and on links/images
  if (e.target.closest('input, textarea, select, a, [contenteditable]')) return;
  if (e.target.closest('.modal-overlay, .wb-overlay')) return;
  e.preventDefault();
  const noteEl = e.target.closest('.note-card');
  if (noteEl) {
    const n = notes.find((x) => x.id === noteEl.dataset.id);
    if (n) return showCtx(e.clientX, e.clientY, noteCtxItems(n));
  }
  const widgetEl = e.target.closest('.widget');
  if (widgetEl) return showCtx(e.clientX, e.clientY, widgetCtxItems(widgetEl.dataset.id));
  showCtx(e.clientX, e.clientY, backgroundCtxItems());
});

async function loadData() {
  [notes, tags] = await Promise.all([api.get('/api/notes'), api.get('/api/tags')]);
  renderTagRow();
  renderBoard();
}

applyPrefs();
loadPrefs();
loadData();

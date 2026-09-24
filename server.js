const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const auth = require('./auth');

const app = express();
const PORT = process.env.PORT || 3113;

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'db.json');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
// a data dir the process can't write (e.g. root-owned after an image upgrade) would
// fail every save with a 500; refuse to start instead
for (const dir of [DATA_DIR, UPLOAD_DIR]) {
  try {
    fs.accessSync(dir, fs.constants.W_OK);
  } catch (e) {
    console.error(`Cannot write to ${dir}: ${e.message}`);
    process.exit(1);
  }
}

// ---------- tiny JSON file DB ----------
function loadDb() {
  try {
    const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    db.widgets = db.widgets || [];
    db.settings = db.settings || {};
    db.reminders = db.reminders || [];
    db.users = db.users || [];
    db.uploads = db.uploads || [];
    db.prefs = db.prefs || {};
    return db;
  } catch (e) {
    // corrupt or unreadable: starting empty would let the next save overwrite the real file
    if (e.code !== 'ENOENT') {
      console.error(`Cannot load ${DB_FILE}: ${e.message}`);
      process.exit(1);
    }
    return { notes: [], tags: [], widgets: [], settings: {}, reminders: [], users: [], uploads: [], prefs: {} };
  }
}
function saveDb(db) {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}
let db = loadDb();

const uid = () => crypto.randomBytes(8).toString('hex');

// ---------- input validation ----------
// Every POST/PUT to notes, tags, widgets and reminders is checked here, so the board,
// the widgets and the reminder scheduler only ever see the types they expect.
const FREQS = ['once', 'hourly', 'daily', 'weekly'];
const isStr = (v) => typeof v === 'string';
const isBool = (v) => typeof v === 'boolean';
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isColor = (v) => isStr(v) && /^(#[0-9a-f]{6})?$/i.test(v); // '' means default
const isDate = (v) => isStr(v) && Number.isFinite(Date.parse(v));
const isId = (v) => isStr(v) && /^[0-9a-f]{16}$/.test(v);
const arrayOf = (check) => (v) => Array.isArray(v) && v.every(check);
const oneOf = (...allowed) => (v) => allowed.includes(v);

const WRITE_CHECKS = {
  notes: {
    title: isStr,
    text: isStr,
    checklist: arrayOf((c) => isObj(c) && isStr(c.text) && isBool(c.done)),
    tags: arrayOf(isId),
    color: isColor,
    textColor: isColor,
    images: arrayOf((u) => isStr(u) && /^\/uploads\/[0-9a-f]{16}\.[a-z0-9]+$/.test(u)),
    pinned: isBool,
    reminder: (r) => r === null || (isObj(r) && isDate(r.at) && FREQS.includes(r.freq) && isBool(r.enabled)),
  },
  tags: { name: isStr, color: isColor, pinned: isBool },
  widgets: {
    type: (v) => isStr(v) && /^[A-Za-z]{1,40}$/.test(v),
    x: isNum, y: isNum, w: isNum, h: isNum, z: isNum,
    // only the shape is checked: widgets.js escapes or coerces each config value before it
    // reaches markup, and the CSP header is the backstop if one is missed
    config: isObj,
  },
  reminders: { text: isStr, at: isDate, freq: (v) => FREQS.includes(v), enabled: isBool },
  prefs: { theme: oneOf('dark', 'light'), font: oneOf('roboto', 'mono', 'courier'), ui: oneOf('auto', 'mobile', 'desktop') },
};
const PREF_DEFAULTS = { theme: 'dark', font: 'roboto', ui: 'auto' };

function validateWrite(req, res, next) {
  if ((req.method !== 'POST' && req.method !== 'PUT') || !Object.hasOwn(WRITE_CHECKS, req.params.kind)) return next();
  if (!isObj(req.body)) return res.status(400).json({ error: 'Expected a JSON object' });
  const checks = WRITE_CHECKS[req.params.kind];
  const bad = Object.keys(checks).find((f) => f in req.body && !checks[f](req.body[f]));
  if (bad) return res.status(400).json({ error: `Invalid ${bad}` });
  next();
}

// ---------- middleware ----------
app.disable('x-powered-by');
// the UI has no inline scripts, so markup injected into a page can't run script
// (uploads replace this with their own sandbox policy). frame-ancestors 'none' keeps the board out
// of other sites' frames, so a logged-in session cannot be clickjacked; to embed display.html in a
// dashboard, replace 'none' with the dashboard's origin
app.use((req, res, next) => {
  res.set('Content-Security-Policy', "script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  next();
});
app.use(express.json({ limit: '5mb' }));
// identity, plus the cross-origin write guard. A no-op sign-in when AUTH_MODE is unset, which is
// the default, so existing installs behave exactly as before.
const authCfg = auth.attach(app, {
  getDb: () => db,
  save: () => saveDb(db),
  // the first sign-in creates the admin, who inherits everything saved before anyone signed in
  userAdded: (user) => user.role === 'admin' && claimLegacyRows(),
});

// ---------- ownership ----------
// Notes, tags, widgets, reminders and uploads each record an ownerId. With AUTH_MODE=none there is
// one board and it shows every row, so turning sign-in off never hides anything. With sign-in on,
// each user sees only their own rows; anyone else's answer 404, as if they did not exist.
const OWNED = ['notes', 'tags', 'widgets', 'reminders', 'uploads'];
const ownedBy = (userId, row) => authCfg.mode === 'none' || (!!row && row.ownerId === userId);
const mine = (req) => (row) => ownedBy(req.user.id, row);
const findMine = (req, rows) => rows.find((row) => row.id === req.params.id && mine(req)(row));
// deletes answer the same whether the row was someone else's or never existed
function removeMine(req, kind) {
  const row = findMine(req, db[kind]);
  if (row) db[kind] = db[kind].filter((r) => r !== row);
  return row;
}
// the board that legacy rows and, until Telegram is mapped per user, the Telegram bridge belong to
const adminId = () => (authCfg.mode === 'none' ? auth.LOCAL_USER.id : db.users.find((u) => u.role === 'admin')?.id);

// Rows saved before per-user boards (no ownerId) or while sign-in was off (ownerId 'local') belong
// to the admin once sign-in is on. Old versions ignore ownerId, so this changes nothing for them,
// but db.json is copied first anyway.
function claimLegacyRows() {
  const owner = adminId();
  if (authCfg.mode === 'none' || !owner) return;
  const legacy = (row) => row.ownerId === undefined || row.ownerId === auth.LOCAL_USER.id;
  const recorded = new Set(db.uploads.map((u) => u.file));
  const files = fs.readdirSync(UPLOAD_DIR).filter((f) => !recorded.has(f));
  const counts = Object.fromEntries(OWNED.map((kind) => [kind, db[kind].filter(legacy).length]));
  counts.uploads += files.length;
  if (!Object.values(counts).some(Boolean)) return;
  const backup = `${DB_FILE}.bak_pre_owner_${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}`;
  if (fs.existsSync(DB_FILE)) fs.copyFileSync(DB_FILE, backup);
  for (const kind of OWNED) for (const row of db[kind]) if (legacy(row)) row.ownerId = owner;
  for (const file of files) db.uploads.push({ file, ownerId: owner });
  saveDb(db);
  console.log(`Assigned rows with no owner to user ${owner}: ${JSON.stringify(counts)} (backup: ${backup})`);
}
claimLegacyRows();

app.use('/api/:kind', validateWrite);
app.use(express.static(path.join(__dirname, 'public')));
// an image is served only to the user who uploaded it
app.use('/uploads', (req, res, next) => {
  const entry = db.uploads.find((u) => '/' + u.file === req.path);
  if (!ownedBy(req.user.id, entry)) return res.status(404).json({ error: 'Not found' });
  next();
});
// uploads are user content: never let a browser run one as a page or a script
app.use('/uploads', express.static(UPLOAD_DIR, {
  setHeaders: (res) => res.set({ 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': 'sandbox' }),
}));

// ---------- uploads ----------
// the stored extension comes from the checked mimetype, never the client's filename
const IMAGE_EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp', 'image/avif': '.avif' };
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, uid() + IMAGE_EXT[file.mimetype]),
});
const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = Object.hasOwn(IMAGE_EXT, file.mimetype);
    cb(ok ? null : new Error('Only image files are allowed'), ok);
  },
});

app.post('/api/upload', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  db.uploads.push({ file: req.file.filename, ownerId: req.user.id });
  saveDb(db);
  res.json({ url: '/uploads/' + req.file.filename });
});

// ---------- notes ----------
app.get('/api/notes', (req, res) => res.json(db.notes.filter(mine(req))));

app.post('/api/notes', (req, res) => {
  const now = new Date().toISOString();
  const note = {
    id: uid(),
    ownerId: req.user.id,
    title: req.body.title || '',
    text: req.body.text || '',
    checklist: req.body.checklist || [],
    tags: req.body.tags || [],
    color: req.body.color || '',
    textColor: req.body.textColor || '',
    images: req.body.images || [],
    pinned: !!req.body.pinned,
    reminder: req.body.reminder || null,
    createdAt: now,
    updatedAt: now,
  };
  db.notes.unshift(note);
  saveDb(db);
  res.json(note);
});

app.put('/api/notes/:id', (req, res) => {
  const note = findMine(req, db.notes);
  if (!note) return res.status(404).json({ error: 'Not found' });
  const fields = ['title', 'text', 'checklist', 'tags', 'color', 'textColor', 'images', 'pinned', 'reminder'];
  for (const f of fields) if (f in req.body) note[f] = req.body[f];
  note.updatedAt = new Date().toISOString();
  saveDb(db);
  res.json(note);
});

app.delete('/api/notes/:id', (req, res) => {
  const note = removeMine(req, 'notes');
  if (note) {
    // clean up the note's images, but only ones this user uploaded: a note can name any upload URL
    const files = (note.images || []).map((url) => path.basename(url))
      .filter((file) => ownedBy(req.user.id, db.uploads.find((u) => u.file === file)));
    for (const file of files) fs.rm(path.join(UPLOAD_DIR, file), { force: true }, () => {});
    db.uploads = db.uploads.filter((u) => !files.includes(u.file));
    saveDb(db);
  }
  res.json({ ok: true });
});

// ---------- tags ----------
app.get('/api/tags', (req, res) => res.json(db.tags.filter(mine(req))));

app.post('/api/tags', (req, res) => {
  const name = String(req.body.name || '').trim().replace(/^#/, '').toUpperCase();
  if (!name) return res.status(400).json({ error: 'Name required' });
  if (db.tags.some((t) => t.name === name && mine(req)(t))) return res.status(409).json({ error: 'Tag exists' });
  const tag = { id: uid(), ownerId: req.user.id, name, color: req.body.color || '#4ade80', pinned: !!req.body.pinned };
  db.tags.push(tag);
  saveDb(db);
  res.json(tag);
});

app.put('/api/tags/:id', (req, res) => {
  const tag = findMine(req, db.tags);
  if (!tag) return res.status(404).json({ error: 'Not found' });
  if ('name' in req.body) tag.name = String(req.body.name).trim().replace(/^#/, '').toUpperCase();
  if ('color' in req.body) tag.color = req.body.color;
  if ('pinned' in req.body) tag.pinned = !!req.body.pinned;
  saveDb(db);
  res.json(tag);
});

app.delete('/api/tags/:id', (req, res) => {
  const tag = removeMine(req, 'tags');
  if (tag) {
    for (const n of db.notes) n.tags = n.tags.filter((id) => id !== tag.id);
    saveDb(db);
  }
  res.json({ ok: true });
});

// ---------- widgets ----------
app.get('/api/widgets', (req, res) => res.json(db.widgets.filter(mine(req))));

app.post('/api/widgets', (req, res) => {
  const widget = {
    id: uid(),
    ownerId: req.user.id,
    type: req.body.type || 'clock',
    x: req.body.x ?? 20,
    y: req.body.y ?? 20,
    w: req.body.w ?? 260,
    h: req.body.h ?? 160,
    z: req.body.z ?? 1,
    config: req.body.config || {},
  };
  db.widgets.push(widget);
  saveDb(db);
  res.json(widget);
});

app.put('/api/widgets/:id', (req, res) => {
  const widget = findMine(req, db.widgets);
  if (!widget) return res.status(404).json({ error: 'Not found' });
  const fields = ['x', 'y', 'w', 'h', 'z', 'config'];
  for (const f of fields) if (f in req.body) widget[f] = req.body[f];
  saveDb(db);
  res.json(widget);
});

app.delete('/api/widgets/:id', (req, res) => {
  if (removeMine(req, 'widgets')) saveDb(db);
  res.json({ ok: true });
});

// ---------- standalone reminders ----------
app.get('/api/reminders', (req, res) => res.json(db.reminders.filter(mine(req))));

app.post('/api/reminders', (req, res) => {
  if (!req.body.text || !req.body.at) return res.status(400).json({ error: 'text and at required' });
  const rem = {
    id: uid(),
    ownerId: req.user.id,
    text: String(req.body.text),
    at: req.body.at,
    freq: req.body.freq || 'once',
    enabled: true,
  };
  db.reminders.push(rem);
  saveDb(db);
  res.json(rem);
});

app.put('/api/reminders/:id', (req, res) => {
  const rem = findMine(req, db.reminders);
  if (!rem) return res.status(404).json({ error: 'Not found' });
  for (const f of ['text', 'at', 'freq', 'enabled']) if (f in req.body) rem[f] = req.body[f];
  saveDb(db);
  res.json(rem);
});

app.delete('/api/reminders/:id', (req, res) => {
  if (removeMine(req, 'reminders')) saveDb(db);
  res.json({ ok: true });
});

// ---------- preferences and status ----------
// Theme, font and layout live on the server so every device showing a board agrees. Keyed by
// user id; the AUTH_MODE=none board is the `local` user.
const prefsOf = (userId) => (Object.hasOwn(db.prefs, userId) ? db.prefs[userId] : {});
app.get('/api/prefs', (req, res) => res.json({ ...PREF_DEFAULTS, ...prefsOf(req.user.id) }));

app.put('/api/prefs', (req, res) => {
  const prefs = { ...prefsOf(req.user.id) };
  for (const k of Object.keys(PREF_DEFAULTS)) if (k in req.body) prefs[k] = req.body[k];
  db.prefs[req.user.id] = prefs;
  saveDb(db);
  res.json({ ...PREF_DEFAULTS, ...prefs });
});

// read-only, for the settings screen: what is deployed, whether Telegram works, and how much
// of the caller's own data there is. APP_COMMIT is baked in by the Dockerfile.
const VERSION = require('./package.json').version;
app.get('/api/status', (req, res) => res.json({
  version: VERSION,
  commit: process.env.APP_COMMIT || null,
  telegram: { ...tgStatus, chats: chatsOf(req.user.id) },
  counts: Object.fromEntries(OWNED.map((kind) => [kind, db[kind].filter(mine(req)).length])),
}));

// ---------- ad-hoc notification (used by the timer widget) ----------
app.post('/api/notify', async (req, res) => {
  const text = String(req.body.text || '').slice(0, 500);
  if (!text) return res.status(400).json({ error: 'text required' });
  const sent = await tgNotify(`⏱ <b>${escHtml(text)}</b>`, { ownerId: req.user.id });
  res.json({ ok: true, sent });
});

// ---------- telegram bridge ----------
// Messages sent to the bot become notes tagged #TELEGRAM on the board of the user whose chat sent
// them. A chat is linked to a user with a pairing code from Settings (settings.tgUsers maps chat
// id to user id). TELEGRAM_ALLOWED_CHAT_ID, and without sign-in the first chat that messages
// the bot, mean the admin's board, as they always have.
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TG_ALLOWED = process.env.TELEGRAM_ALLOWED_CHAT_ID || '';
// a self-hosted Bot API server can stand in for api.telegram.org
const TG_API = process.env.TELEGRAM_API_URL || 'https://api.telegram.org';

// chats that reach the admin's board without pairing: the configured chat, or the one that claimed the lock
const legacyChats = () => (TG_ALLOWED ? [TG_ALLOWED] : db.settings.telegramChats || []).map(String);
const tgUsers = () => db.settings.tgUsers || {};
// every chat that belongs to a user's board
function chatsOf(userId) {
  const chats = Object.keys(tgUsers()).filter((chat) => tgUsers()[chat] === userId);
  if (userId === adminId()) chats.push(...legacyChats());
  return [...new Set(chats)];
}
// the board a row belongs to; without sign-in every row is the single board's
const ownerOf = (row) => (authCfg.mode === 'none' ? auth.LOCAL_USER.id : row.ownerId);

// Pairing codes live in memory: they expire in 10 minutes, and a restart simply voids them.
// Sending the code from a chat is what proves the user controls that chat.
const tgPairing = new Map(); // code -> { userId, expires }
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I to misread
app.post('/api/telegram/pair', (req, res) => {
  if (!TG_TOKEN) return res.status(409).json({ error: 'Telegram is not configured' });
  for (const [code, p] of tgPairing) if (p.userId === req.user.id || p.expires < Date.now()) tgPairing.delete(code);
  const code = Array.from(crypto.randomBytes(6), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
  const expires = Date.now() + 10 * 60 * 1000;
  tgPairing.set(code, { userId: req.user.id, expires });
  res.json({ code, expiresAt: new Date(expires).toISOString(), bot: tgStatus.bot });
});
app.delete('/api/telegram/pair', (req, res) => {
  const users = tgUsers();
  for (const chat of Object.keys(users)) if (users[chat] === req.user.id) delete users[chat];
  saveDb(db);
  res.json({ ok: true });
});

async function tg(method, params) {
  const res = await fetch(`${TG_API}/bot${TG_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params || {}),
  });
  return res.json();
}

function telegramTag(owner) {
  let tag = db.tags.find((t) => t.name === 'TELEGRAM' && ownedBy(owner, t));
  if (!tag) {
    tag = { id: uid(), ownerId: owner, name: 'TELEGRAM', color: '#229ED9', pinned: false };
    db.tags.push(tag);
  }
  return tag;
}

async function tgDownloadPhoto(fileId, owner) {
  const info = await tg('getFile', { file_id: fileId });
  if (!info.ok) return null;
  const res = await fetch(`${TG_API}/file/bot${TG_TOKEN}/${info.result.file_path}`);
  if (!res.ok) return null;
  const ext = path.extname(info.result.file_path) || '.jpg';
  const name = uid() + ext;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), Buffer.from(await res.arrayBuffer()));
  db.uploads.push({ file: name, ownerId: owner });
  return '/uploads/' + name;
}

async function tgLinkChat(chatId, code) {
  const pending = tgPairing.get(code);
  if (!pending || pending.expires < Date.now()) return false;
  tgPairing.delete(code);
  (db.settings.tgUsers ||= {})[String(chatId)] = pending.userId;
  saveDb(db);
  const user = db.users.find((u) => u.id === pending.userId);
  const board = user ? `${user.displayName}'s board` : 'the board';
  await tg('sendMessage', { chat_id: chatId, text: `✅ Linked. Anything you send here lands on ${board} tagged #TELEGRAM, and its reminders come to this chat.` });
  return true;
}

// whose board a chat posts to: the linked user, or the admin for the configured or locked chat
const tgBoardOf = (chatId) => tgUsers()[String(chatId)] || (legacyChats().includes(String(chatId)) ? adminId() : null);

async function handleTgMessage(msg) {
  const chatId = msg.chat.id;
  const text = msg.text || msg.caption || '';
  // a pairing code, sent by the t.me deep link as "/start CODE" or typed on its own
  const code = text.trim().match(/^(?:\/start\s+)?([A-Za-z0-9]{6})$/);
  if (code && await tgLinkChat(chatId, code[1].toUpperCase())) return;
  if (/^\/start\b/.test(text.trim())) {
    await tg('sendMessage', { chat_id: chatId, text: 'That pairing code is wrong or has expired. Get a new one from Settings on the board.' });
    return;
  }
  let owner = tgBoardOf(chatId);
  if (!owner && authCfg.mode === 'none' && !legacyChats().length && !Object.keys(tgUsers()).length) {
    // no sign-in and no chat yet: the first chat claims the single board, as it always has
    db.settings.telegramChats = [chatId];
    saveDb(db);
    await tg('sendMessage', { chat_id: chatId, text: '🔒 MindBoard bot is now locked to this chat. Anything you send here lands on the board tagged #TELEGRAM.' });
    owner = adminId();
  }
  if (!owner) {
    console.log(`Telegram: refused a message from chat ${chatId}, which is not linked to any board`);
    await tg('sendMessage', { chat_id: chatId, text: 'This bot is private. To link it to your board, open Settings on the board and choose Link Telegram.' });
    return;
  }
  const images = [];
  if (msg.photo && msg.photo.length) {
    const url = await tgDownloadPhoto(msg.photo[msg.photo.length - 1].file_id, owner);
    if (url) images.push(url);
  }
  if (!text.trim() && !images.length) {
    await tg('sendMessage', { chat_id: chatId, text: 'Send text or a photo and it will be added to the board.' });
    return;
  }
  const now = new Date(msg.date ? msg.date * 1000 : Date.now()).toISOString();
  db.notes.unshift({
    id: uid(),
    ownerId: owner,
    title: '',
    text,
    checklist: [],
    tags: [telegramTag(owner).id],
    color: '#229ED9',
    textColor: '',
    images,
    pinned: false,
    createdAt: now,
    updatedAt: now,
  });
  saveDb(db);
  await tg('sendMessage', { chat_id: chatId, text: `✅ Added to MindBoard${images.length ? ' (with photo)' : ''}` });
}

// bridge state for the board UI: disabled (no token), connecting, connected, or disconnected with a reason
let tgStatus = { status: TG_TOKEN ? 'connecting' : 'disabled', detail: '', bot: null };
const setTgStatus = (status, detail = '') => { tgStatus = { ...tgStatus, status, detail }; };
app.get('/api/telegram', (req, res) => res.json(tgStatus));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// fetch failures keep the useful part in their cause: a code (EAI_AGAIN, ECONNREFUSED) or a message
const failure = (e) => e.cause?.code || e.cause?.message || e.message;

async function tgPollLoop() {
  // Telegram is optional: an unreachable Bot API is retried with backoff instead of taking the board down
  for (let delay = 5000; ; delay = Math.min(delay * 2, 5 * 60 * 1000)) {
    try {
      const me = await tg('getMe');
      if (me.ok) {
        tgStatus.bot = me.result.username;
        console.log(`Telegram bridge active as @${me.result.username}`);
        break;
      }
      if (me.error_code === 401 || me.error_code === 404) {
        setTgStatus('disconnected', 'bot token rejected');
        console.error('Telegram: bot token rejected, bridge disabled');
        return;
      }
      setTgStatus('disconnected', me.description || 'Bot API error');
    } catch (e) {
      setTgStatus('disconnected', failure(e));
    }
    console.error(`Telegram: cannot reach the Bot API (${tgStatus.detail}), retrying in ${delay / 1000}s`);
    await sleep(delay);
  }
  setTgStatus('connected');
  for (;;) {
    try {
      const updates = await tg('getUpdates', {
        offset: (db.settings.tgOffset || 0) + 1,
        timeout: 30,
        allowed_updates: ['message'],
      });
      if (updates.ok) {
        setTgStatus('connected');
        for (const u of updates.result) {
          db.settings.tgOffset = u.update_id;
          if (u.message) await handleTgMessage(u.message).catch((e) => console.error('Telegram message error:', e.message));
          saveDb(db);
        }
      } else if (updates.error_code === 409) {
        setTgStatus('disconnected', 'another poller is using this bot token');
        console.error('Telegram: another poller is using this token (409), retrying in 60s');
        await sleep(60000);
      } else {
        setTgStatus('disconnected', updates.description || 'Bot API error');
        console.error('Telegram getUpdates error:', updates.description);
        await sleep(10000);
      }
    } catch (e) {
      setTgStatus('disconnected', failure(e));
      console.error('Telegram poll error:', failure(e));
      await sleep(5000);
    }
  }
}

if (TG_TOKEN) {
  if (!TG_ALLOWED) {
    console.log(authCfg.mode === 'none'
      ? 'Telegram: TELEGRAM_ALLOWED_CHAT_ID is not set, so the bot locks to the first chat that messages it'
      : 'Telegram: chats are linked to users with a pairing code from Settings');
  }
  // nothing in the bridge may crash the server
  tgPollLoop().catch((e) => {
    setTgStatus('disconnected', failure(e));
    console.error('Telegram bridge stopped:', e.message);
  });
} else {
  console.log('Telegram bridge disabled (set TELEGRAM_BOT_TOKEN to enable)');
}

// ---------- reminder scheduler ----------
function escHtml(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

// a row's alerts go to the chats linked to its board; a board with no chat has nowhere to send them
const tgChatsFor = (row) => (TG_TOKEN ? chatsOf(ownerOf(row)) : []);
const tgReadyFor = (row) => tgChatsFor(row).length > 0;

// resolves true only when every chat got the message; Telegram's rejections are logged
async function tgNotify(html, row) {
  const chats = tgChatsFor(row);
  if (!chats.length) {
    console.log('Notification (no Telegram chat for this board):', html.replace(/<[^>]+>/g, ''));
    return false;
  }
  let delivered = true;
  for (const chatId of chats) {
    try {
      const res = await tg('sendMessage', { chat_id: chatId, text: html, parse_mode: 'HTML' });
      if (!res.ok) throw new Error(res.description || 'rejected');
    } catch (e) {
      console.error('Telegram notify error:', e.message);
      delivered = false;
    }
  }
  return delivered;
}

// A due item is handled once it is delivered, or when Telegram isn't set up and there is
// nowhere to deliver it. A failed send leaves it due, so the next check retries it.
const notified = async (row, html) => (await tgNotify(html, row)) || !tgReadyFor(row);

function advanceReminder(r) {
  const step = { hourly: 3600e3, daily: 86400e3, weekly: 604800e3 }[r.freq];
  if (!step) {
    r.enabled = false;
    return;
  }
  const t = new Date(r.at).getTime();
  const now = Date.now();
  // jump straight to the first occurrence after now; stepping one interval at a time
  // stalls the server for seconds when the stored date is far in the past
  const next = t > now ? t : t + (Math.floor((now - t) / step) + 1) * step;
  r.at = new Date(next).toISOString();
}

function noteReminderMessage(n) {
  const title = n.title || (n.text || '').split('\n')[0].slice(0, 60) || 'Note';
  const tagNames = (n.tags || []).map((id) => db.tags.find((t) => t.id === id)?.name).filter(Boolean);
  let msg = `🔔 <b>${escHtml(title)}</b>`;
  const body = (n.text || '').trim();
  if (body && body !== title) msg += `\n${escHtml(body.slice(0, 800))}`;
  const openItems = (n.checklist || []).filter((c) => !c.done);
  if (openItems.length) msg += '\n' + openItems.map((c) => `☐ ${escHtml(c.text)}`).join('\n');
  if (tagNames.length) msg += `\n🏷 ${tagNames.map((t) => '#' + escHtml(t)).join(' ')}`;
  if (n.reminder.freq !== 'once') msg += `\n🔁 repeats ${escHtml(n.reminder.freq)}`;
  return msg;
}

async function checkReminders() {
  const now = Date.now();
  let changed = false;
  for (const n of db.notes) {
    const r = n.reminder;
    if (r && r.enabled && new Date(r.at).getTime() <= now) {
      if (!(await notified(n, noteReminderMessage(n)))) continue;
      advanceReminder(r);
      changed = true;
    }
  }
  for (const rem of db.reminders) {
    if (rem.enabled && new Date(rem.at).getTime() <= now) {
      let msg = `⏰ <b>${escHtml(rem.text)}</b>`;
      if (rem.freq !== 'once') msg += `\n🔁 repeats ${escHtml(rem.freq)}`;
      if (!(await notified(rem, msg))) continue;
      advanceReminder(rem);
      changed = true;
    }
  }
  // hydration widgets: nudge every 2h of inactivity during the active window
  const nowD = new Date();
  const hr = nowD.getHours();
  const TWO_H = 2 * 3600 * 1000;
  for (const wdg of db.widgets) {
    if (wdg.type !== 'water') continue;
    const c = wdg.config || (wdg.config = {});
    const today = nowD.toDateString();
    if (c.date !== today) { c.date = today; c.cups = 0; c.lastDrink = null; c.lastReminded = null; changed = true; }
    const startHour = c.startHour ?? 7, endHour = c.endHour ?? 23;
    if (hr < startHour || hr >= endHour) continue;
    if ((c.cups || 0) >= (c.goal || 8)) continue; // goal met — stop nagging
    const windowStart = new Date(nowD); windowStart.setHours(startHour, 0, 0, 0);
    const lastActivity = c.lastDrink ? new Date(c.lastDrink).getTime() : windowStart.getTime();
    const lastRem = c.lastReminded ? new Date(c.lastReminded).getTime() : 0;
    if (now - lastActivity >= TWO_H && now - lastRem >= TWO_H) {
      if (!(await notified(wdg, `💧 <b>Time to drink water!</b>\nYou've had ${escHtml(c.cups || 0)} of ${escHtml(c.goal || 8)} cups today.`))) continue;
      c.lastReminded = new Date(now).toISOString();
      changed = true;
    }
  }
  if (changed) saveDb(db);
}
const runReminderCheck = () => checkReminders().catch((e) => console.error('Reminder check error:', e.message));
runReminderCheck(); // reminders that came due while the server was down go out now, not 30 s later
setInterval(runReminderCheck, 30 * 1000);

const server = app.listen(PORT, () => console.log(`MindBoard running at http://localhost:${server.address().port}`));

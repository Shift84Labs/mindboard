const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3113;

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'db.json');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ---------- tiny JSON file DB ----------
function loadDb() {
  try {
    const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    db.widgets = db.widgets || [];
    db.settings = db.settings || {};
    db.reminders = db.reminders || [];
    return db;
  } catch (e) {
    // corrupt or unreadable: starting empty would let the next save overwrite the real file
    if (e.code !== 'ENOENT') {
      console.error(`Cannot load ${DB_FILE}: ${e.message}`);
      process.exit(1);
    }
    return { notes: [], tags: [], widgets: [], settings: {}, reminders: [] };
  }
}
function saveDb(db) {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}
let db = loadDb();

const uid = () => crypto.randomBytes(8).toString('hex');

// ---------- middleware ----------
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR));

// ---------- uploads ----------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, uid() + ext);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /^image\/(png|jpe?g|gif|webp|svg\+xml|avif)$/.test(file.mimetype);
    cb(ok ? null : new Error('Only image files are allowed'), ok);
  },
});

app.post('/api/upload', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  res.json({ url: '/uploads/' + req.file.filename });
});

// ---------- notes ----------
app.get('/api/notes', (req, res) => res.json(db.notes));

app.post('/api/notes', (req, res) => {
  const now = new Date().toISOString();
  const note = {
    id: uid(),
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
  const note = db.notes.find((n) => n.id === req.params.id);
  if (!note) return res.status(404).json({ error: 'Not found' });
  const fields = ['title', 'text', 'checklist', 'tags', 'color', 'textColor', 'images', 'pinned', 'reminder'];
  for (const f of fields) if (f in req.body) note[f] = req.body[f];
  note.updatedAt = new Date().toISOString();
  saveDb(db);
  res.json(note);
});

app.delete('/api/notes/:id', (req, res) => {
  const note = db.notes.find((n) => n.id === req.params.id);
  if (note) {
    // clean up uploaded images belonging to this note
    for (const url of note.images || []) {
      const f = path.join(UPLOAD_DIR, path.basename(url));
      fs.rm(f, { force: true }, () => {});
    }
  }
  db.notes = db.notes.filter((n) => n.id !== req.params.id);
  saveDb(db);
  res.json({ ok: true });
});

// ---------- tags ----------
app.get('/api/tags', (req, res) => res.json(db.tags));

app.post('/api/tags', (req, res) => {
  const name = String(req.body.name || '').trim().replace(/^#/, '').toUpperCase();
  if (!name) return res.status(400).json({ error: 'Name required' });
  if (db.tags.some((t) => t.name === name)) return res.status(409).json({ error: 'Tag exists' });
  const tag = { id: uid(), name, color: req.body.color || '#4ade80', pinned: !!req.body.pinned };
  db.tags.push(tag);
  saveDb(db);
  res.json(tag);
});

app.put('/api/tags/:id', (req, res) => {
  const tag = db.tags.find((t) => t.id === req.params.id);
  if (!tag) return res.status(404).json({ error: 'Not found' });
  if ('name' in req.body) tag.name = String(req.body.name).trim().replace(/^#/, '').toUpperCase();
  if ('color' in req.body) tag.color = req.body.color;
  if ('pinned' in req.body) tag.pinned = !!req.body.pinned;
  saveDb(db);
  res.json(tag);
});

app.delete('/api/tags/:id', (req, res) => {
  db.tags = db.tags.filter((t) => t.id !== req.params.id);
  for (const n of db.notes) n.tags = n.tags.filter((id) => id !== req.params.id);
  saveDb(db);
  res.json({ ok: true });
});

// ---------- widgets ----------
app.get('/api/widgets', (req, res) => res.json(db.widgets));

app.post('/api/widgets', (req, res) => {
  const widget = {
    id: uid(),
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
  const widget = db.widgets.find((w) => w.id === req.params.id);
  if (!widget) return res.status(404).json({ error: 'Not found' });
  const fields = ['x', 'y', 'w', 'h', 'z', 'config'];
  for (const f of fields) if (f in req.body) widget[f] = req.body[f];
  saveDb(db);
  res.json(widget);
});

app.delete('/api/widgets/:id', (req, res) => {
  db.widgets = db.widgets.filter((w) => w.id !== req.params.id);
  saveDb(db);
  res.json({ ok: true });
});

// ---------- standalone reminders ----------
app.get('/api/reminders', (req, res) => res.json(db.reminders));

app.post('/api/reminders', (req, res) => {
  if (!req.body.text || !req.body.at) return res.status(400).json({ error: 'text and at required' });
  const rem = {
    id: uid(),
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
  const rem = db.reminders.find((r) => r.id === req.params.id);
  if (!rem) return res.status(404).json({ error: 'Not found' });
  for (const f of ['text', 'at', 'freq', 'enabled']) if (f in req.body) rem[f] = req.body[f];
  saveDb(db);
  res.json(rem);
});

app.delete('/api/reminders/:id', (req, res) => {
  db.reminders = db.reminders.filter((r) => r.id !== req.params.id);
  saveDb(db);
  res.json({ ok: true });
});

// ---------- ad-hoc notification (used by the timer widget) ----------
app.post('/api/notify', async (req, res) => {
  const text = String(req.body.text || '').slice(0, 500);
  if (!text) return res.status(400).json({ error: 'text required' });
  const sent = await tgNotify(`⏱ <b>${escHtml(text)}</b>`);
  res.json({ ok: true, sent });
});

// ---------- telegram bridge ----------
// Messages sent to the bot become notes tagged #TELEGRAM. The bot locks itself
// to the first chat that messages it; other chats are rejected.
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';

async function tg(method, params) {
  const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params || {}),
  });
  return res.json();
}

function telegramTag() {
  let tag = db.tags.find((t) => t.name === 'TELEGRAM');
  if (!tag) {
    tag = { id: uid(), name: 'TELEGRAM', color: '#229ED9', pinned: false };
    db.tags.push(tag);
  }
  return tag;
}

async function tgDownloadPhoto(fileId) {
  const info = await tg('getFile', { file_id: fileId });
  if (!info.ok) return null;
  const res = await fetch(`https://api.telegram.org/file/bot${TG_TOKEN}/${info.result.file_path}`);
  if (!res.ok) return null;
  const ext = path.extname(info.result.file_path) || '.jpg';
  const name = uid() + ext;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), Buffer.from(await res.arrayBuffer()));
  return '/uploads/' + name;
}

async function handleTgMessage(msg) {
  const chatId = msg.chat.id;
  db.settings.telegramChats = db.settings.telegramChats || [];
  if (!db.settings.telegramChats.length) {
    db.settings.telegramChats.push(chatId);
    saveDb(db);
    await tg('sendMessage', { chat_id: chatId, text: '🔒 MindBoard bot is now locked to this chat. Anything you send here lands on the board tagged #TELEGRAM.' });
  }
  if (!db.settings.telegramChats.includes(chatId)) {
    await tg('sendMessage', { chat_id: chatId, text: 'This bot is private.' });
    return;
  }
  const text = msg.text || msg.caption || '';
  const images = [];
  if (msg.photo && msg.photo.length) {
    const url = await tgDownloadPhoto(msg.photo[msg.photo.length - 1].file_id);
    if (url) images.push(url);
  }
  if (!text.trim() && !images.length) {
    await tg('sendMessage', { chat_id: chatId, text: 'Send text or a photo and it will be added to the board.' });
    return;
  }
  const now = new Date(msg.date ? msg.date * 1000 : Date.now()).toISOString();
  db.notes.unshift({
    id: uid(),
    title: '',
    text,
    checklist: [],
    tags: [telegramTag().id],
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

async function tgPollLoop() {
  const me = await tg('getMe');
  if (!me.ok) {
    console.error('Telegram: bot token rejected — bridge disabled');
    return;
  }
  console.log(`Telegram bridge active as @${me.result.username}`);
  for (;;) {
    try {
      const updates = await tg('getUpdates', {
        offset: (db.settings.tgOffset || 0) + 1,
        timeout: 30,
        allowed_updates: ['message'],
      });
      if (updates.ok) {
        for (const u of updates.result) {
          db.settings.tgOffset = u.update_id;
          if (u.message) await handleTgMessage(u.message).catch((e) => console.error('Telegram message error:', e.message));
          saveDb(db);
        }
      } else if (updates.error_code === 409) {
        console.error('Telegram: another poller is using this token (409), retrying in 60s');
        await new Promise((r) => setTimeout(r, 60000));
      } else {
        console.error('Telegram getUpdates error:', updates.description);
        await new Promise((r) => setTimeout(r, 10000));
      }
    } catch (e) {
      console.error('Telegram poll error:', e.message);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

if (TG_TOKEN) tgPollLoop();
else console.log('Telegram bridge disabled (set TELEGRAM_BOT_TOKEN to enable)');

// ---------- reminder scheduler ----------
function escHtml(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

async function tgNotify(html) {
  const chats = db.settings.telegramChats || [];
  if (!TG_TOKEN || !chats.length) {
    console.log('Notification (telegram not configured):', html.replace(/<[^>]+>/g, ''));
    return false;
  }
  for (const chatId of chats) {
    try {
      await tg('sendMessage', { chat_id: chatId, text: html, parse_mode: 'HTML' });
    } catch (e) {
      console.error('Telegram notify error:', e.message);
    }
  }
  return true;
}

function advanceReminder(r) {
  const step = { hourly: 3600e3, daily: 86400e3, weekly: 604800e3 }[r.freq];
  if (!step) {
    r.enabled = false;
    return;
  }
  let t = new Date(r.at).getTime();
  const now = Date.now();
  while (t <= now) t += step;
  r.at = new Date(t).toISOString();
}

function noteReminderMessage(n) {
  const title = n.title || (n.text || '').split('\n')[0].slice(0, 60) || 'Note';
  const tagNames = (n.tags || []).map((id) => db.tags.find((t) => t.id === id)?.name).filter(Boolean);
  let msg = `🔔 <b>${escHtml(title)}</b>`;
  const body = (n.text || '').trim();
  if (body && body !== title) msg += `\n${escHtml(body.slice(0, 800))}`;
  const openItems = (n.checklist || []).filter((c) => !c.done);
  if (openItems.length) msg += '\n' + openItems.map((c) => `☐ ${escHtml(c.text)}`).join('\n');
  if (tagNames.length) msg += `\n🏷 ${tagNames.map((t) => '#' + t).join(' ')}`;
  if (n.reminder.freq !== 'once') msg += `\n🔁 repeats ${n.reminder.freq}`;
  return msg;
}

async function checkReminders() {
  const now = Date.now();
  let changed = false;
  for (const n of db.notes) {
    const r = n.reminder;
    if (r && r.enabled && new Date(r.at).getTime() <= now) {
      await tgNotify(noteReminderMessage(n));
      advanceReminder(r);
      changed = true;
    }
  }
  for (const rem of db.reminders) {
    if (rem.enabled && new Date(rem.at).getTime() <= now) {
      let msg = `⏰ <b>${escHtml(rem.text)}</b>`;
      if (rem.freq !== 'once') msg += `\n🔁 repeats ${rem.freq}`;
      await tgNotify(msg);
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
      await tgNotify(`💧 <b>Time to drink water!</b>\nYou've had ${c.cups || 0} of ${c.goal || 8} cups today.`);
      c.lastReminded = new Date(now).toISOString();
      changed = true;
    }
  }
  if (changed) saveDb(db);
}
setInterval(() => checkReminders().catch((e) => console.error('Reminder check error:', e.message)), 30 * 1000);

app.listen(PORT, () => console.log(`MindBoard running at http://localhost:${PORT}`));

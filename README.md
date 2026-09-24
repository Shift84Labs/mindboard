# 🧠 MindBoard

A self-hosted, MindChuk-inspired note & project board. One lightweight Node.js
server, zero database service, dark-mode-first design — built to run on a
Raspberry Pi, a home-lab Docker host, or your laptop.

![MindBoard dashboard](design/dashboard-dark.png)

## Features

**Notes**
- Masonry card board with created / edited timestamps on every card
- Tags with colors — quick-filter bubbles under the search bar, pinnable tags
- Full-text search across titles, note text, checklist items and tag names
- To-do lists inside notes with checkboxes and progress counters
- Image attachments (uploaded and stored server-side)
- Colored note outlines + per-note text color
- Pin notes to a dedicated section at the top of the board
- Right-click context menus (pin, recolor, remind, edit, delete)

**Widgets** — drag-and-drop dashboard widgets, freely positionable and resizable
- ✍️ **Whiteboard** — full-screen handwriting canvas, optimized for iPad +
  Apple Pencil (pressure-sensitive ink, palm rejection, pen/highlighter/eraser,
  undo/redo, 9 colors)
- 🕐 **Clock** — big local time plus world-clock rows for cities you choose
- ⏱ **Timer** — scroll-wheel adjustable HH:MM:SS, named timers, presets,
  progress ring, optional Telegram notification when done
- 📅 **Calendar** — month grid with today highlighted, days-left-this-year ring,
  dot markers on days that have reminders
- 🌤 **Weather** — Open-Meteo powered (no API key needed), city search, °F/°C
- ⏰ **Reminders** — quick standalone reminders with once/hourly/daily/weekly
  recurrence
- 📖 **Word of the Day** — a built-in vocabulary set with definitions and
  examples; a new word daily, mark words as learned
- 🎴 **Flashcards** — language decks (Spanish, French, German, Italian,
  Japanese) with tap-to-flip and shuffle
- 🍅 **Pomodoro** — focus/break cycles with a progress ring, daily session
  count, and Telegram alerts on each phase change
- 🧩 **Memory Trainer** — a digit-span brain-training game that grows with you
  and tracks your best score
- 🔥 **Habits** — daily habit checklist with automatic streak counting
- 💧 **Hydration** — tap to log a cup of water; nudges you via Telegram after
  2 hours idle (only 7am–11pm)
- 💻 🔌 ➗ ⚡ 🖥️ **Knowledge quizzes** — flip-to-reveal Q&A decks for
  Programming, Computer Engineering, Mathematics, Electrical Engineering, and
  Computer Science
- ⏳ **Countdown** — live days/hours/minutes to any event you set
- 🌬️ **Breathing** — animated box-breathing coach for a quick focus reset
- 💭 **Quote** — a daily dose of motivation
- 🎲 **Dice & Coin** — quick d6/d20 roller and coin flip
- 🔢 **Base Converter** — decimal ↔ hex / binary / octal, handy for dev work

![Learning & productivity widgets](design/widgets-learning.png)
![More widgets — hydration, quizzes, tools](design/widgets-learning-2.png)

**Reminders & Telegram**
- Attach reminders to notes (date, time, frequency) or create standalone ones
- A Telegram bot bridge delivers reminder notifications, timer-done alerts, and
  lets you **text notes onto the board** — messages (and photos) sent to your
  bot appear as notes tagged `#TELEGRAM`
- The bot locks itself to the first chat that messages it — nobody else can
  post to your board

**UI**
- ⚙ **Settings**: dark & light mode, font (Roboto, Roboto Mono, Courier) and
  mobile/desktop layout, saved with the board so every device agrees; your
  account; and a status panel with the Telegram bridge state, item counts,
  version and deployed commit
- 📺 **Display mode** — a read-only page that auto-refreshes every 5 minutes
  with Today / This Week / This Month / All filters, made for wall-mounted
  tablets and status screens

More screenshots and walkthrough demos live in [`/design`](design/).

## Quick start

```bash
git clone https://github.com/tjbmoose09/mindboard.git
cd mindboard
npm install
npm start
```

Open http://localhost:3113. That's it — data lives in `./data/db.json`,
uploads in `./data/uploads/`.

### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3113` | HTTP port |
| `DATA_DIR` | `./data` | Where notes, uploads and settings are stored |
| `TELEGRAM_BOT_TOKEN` | *(unset)* | Enables the Telegram bridge when set |
| `TELEGRAM_ALLOWED_CHAT_ID` | *(unset)* | The only chat the bot accepts and notifies. If unset, the bot locks to the first chat that messages it |
| `TELEGRAM_API_URL` | `https://api.telegram.org` | Bot API base URL, for a self-hosted Bot API server |
| `AUTH_MODE` | `none` | `none` keeps the board open (unchanged behaviour), `proxy` trusts an identity header from your reverse proxy, `oidc` signs people in with an OIDC provider |
| `AUTH_TRUSTED_PROXIES` | *(unset)* | **Required for `proxy`**: comma-separated CIDRs allowed to set the identity header. Without it the server refuses to start |
| `AUTH_PROXY_HEADER` | `x-auth-request-email` | Header carrying the signed-in user in `proxy` mode |
| `AUTH_ALLOWED_EMAILS` | *(unset)* | Optional allowlist of email addresses |
| `AUTH_ALLOWED_GROUPS` | *(unset)* | Optional allowlist matched against the OIDC `groups` claim |
| `OIDC_ISSUER_URL` | *(unset)* | Required for `oidc`, e.g. `https://id.example.com` |
| `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` | *(unset)* | Required for `oidc` |
| `OIDC_REDIRECT_URI` | *(unset)* | Required for `oidc`: must be `https://your-host/auth/callback` |
| `OIDC_SCOPE` | `openid email profile` | Scopes requested at login. Add `groups` to use `AUTH_ALLOWED_GROUPS` |
| `SESSION_SECRET` | *(unset)* | Required for `oidc`: signs the session cookie. Changing it signs everyone out |
| `SESSION_COOKIE_SECURE` | `true` | Set to `false` only when testing over plain HTTP |

### Signing in

Login is **off by default**, so upgrading changes nothing. Turn it on one of two ways:

- **`proxy`**: you already run oauth2-proxy, Authelia or similar. It authenticates, and MindBoard reads the user from a header. The header counts only when the request comes from `AUTH_TRUSTED_PROXIES`, because otherwise any client could claim to be anyone.
- **`oidc`**: MindBoard itself redirects to your provider (authorization code with PKCE) and keeps a signed session cookie for 7 days.

`GET /healthz` never requires a login, so uptime checks can tell "down" apart from "not signed in". `GET /api/me` reports the current mode and user.

### Per-user boards

With sign-in on, every account gets its own board: notes, tags, widgets, reminders and uploaded images. Another account's items answer 404, images included. The first account to sign in is the admin. With `AUTH_MODE=none` there is a single board that shows everything, so turning sign-in off never hides data.

**Upgrading with sign-in on:** at startup, or at the first sign-in if nobody has signed in yet, everything saved before per-user boards (or while sign-in was off) is given to the admin. `db.json` is copied to `db.json.bak_pre_owner_<timestamp>` first, and the log line lists what moved. Rolling back loses nothing, but an older version ignores `ownerId` and shows every account's items on one board.

**Telegram serves the admin's board for now.** Messages to the bot land on the admin's board, and only the admin's reminders and timer alerts are sent. Other accounts' alerts are skipped, as if no bot were configured.

## Docker

```bash
docker build -t mindboard --build-arg APP_COMMIT=$(git rev-parse --short HEAD) .   # the commit shows in Settings
docker run -d --name mindboard \
  -p 3113:3113 \
  -v mindboard_data:/app/data \
  -e TELEGRAM_BOT_TOKEN=your_token_here \
  mindboard
```

Or with compose:

```yaml
services:
  mindboard:
    build: .
    container_name: mindboard
    restart: unless-stopped
    ports:
      - "3113:3113"
    volumes:
      - mindboard_data:/app/data
    environment:
      TELEGRAM_BOT_TOKEN: your_token_here   # optional
volumes:
  mindboard_data:
```

### Upgrading an existing install

The image runs as the unprivileged `node` user (uid 1000). Data written by
older images is owned by root, so the new image exits at startup with
`Cannot write to /app/data: EACCES`. Fix ownership once, then start it
again:

```bash
docker run --rm -v mindboard_data:/app/data alpine chown -R 1000:1000 /app/data
```

For a bind mount, run `sudo chown -R 1000:1000 ./data` on the host instead.

## Telegram setup (optional)

1. Talk to [@BotFather](https://t.me/BotFather) in Telegram → `/newbot` →
   copy the API token.
2. Start MindBoard with `TELEGRAM_BOT_TOKEN` set (env var, or an `env_file` in
   your compose setup — don't commit the token).
3. Set `TELEGRAM_ALLOWED_CHAT_ID` to your chat id so nobody else can use the
   bot. To find the id, start MindBoard once with `TELEGRAM_ALLOWED_CHAT_ID=0`,
   send the bot any message, and copy the id from the server log line
   `Telegram: ignored a message from chat <id>`. Restart with the real id; from
   then on only your chat can post to the board, and reminders and timer alerts
   are delivered there.

   Without `TELEGRAM_ALLOWED_CHAT_ID`, the bot locks itself to the first chat
   that messages it, which is whoever finds the bot first.

The bridge uses long polling, so it works behind NAT with **no public webhook,
open ports, or reverse proxy required**.

## Security notes

- **Sign-in is off by default.** With `AUTH_MODE=none`, anyone who can reach
  the port has the whole board. Keep it on a trusted network or a VPN
  (Tailscale/WireGuard), or turn on `proxy` or `oidc` sign-in before exposing it.
- The `data/` directory contains all of your notes, uploaded images, and your
  Telegram chat id. It is gitignored for a reason — never commit it.

## Tech

Vanilla JS + CSS front end (no framework, no build step), Express + Multer on
the back end, JSON file storage with atomic writes. The whiteboard uses pointer
events with coalescing and pressure support; widget text scales with CSS
container queries.

## License

[MIT](LICENSE)

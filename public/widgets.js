/* ============ MindBoard widget engine ============
   Runs on index.html (editable) and display.html (read-only). */

(() => {
  const el = (id) => document.getElementById(id);
  const canvas = el('widgetCanvas');
  if (!canvas) return;

  const EDITABLE = !document.body.classList.contains('display-page');
  const GRID = 10;
  const snap = (v) => Math.max(0, Math.round(v / GRID) * GRID);

  let widgets = [];
  let editMode = false;

  const wapi = {
    async get() { return (await fetch('/api/widgets')).json(); },
    async post(body) {
      return (await fetch('/api/widgets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
    },
    async put(id, body) {
      return (await fetch('/api/widgets/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
    },
    async del(id) { return (await fetch('/api/widgets/' + id, { method: 'DELETE' })).json(); },
  };

  const escw = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ================= widget type registry ================= */

  const COMMON_ZONES = [
    ['America/New_York', 'New York'], ['America/Chicago', 'Chicago'], ['America/Denver', 'Denver'],
    ['America/Phoenix', 'Phoenix'], ['America/Los_Angeles', 'Los Angeles'], ['Europe/London', 'London'],
    ['Europe/Paris', 'Paris'], ['Europe/Berlin', 'Berlin'], ['Asia/Dubai', 'Dubai'], ['Asia/Kolkata', 'Mumbai'],
    ['Asia/Shanghai', 'Shanghai'], ['Asia/Tokyo', 'Tokyo'], ['Australia/Sydney', 'Sydney'], ['UTC', 'UTC'],
  ];

  const WMO = {
    0: ['☀️', 'Clear'], 1: ['🌤', 'Mostly clear'], 2: ['⛅', 'Partly cloudy'], 3: ['☁️', 'Overcast'],
    45: ['🌫', 'Fog'], 48: ['🌫', 'Rime fog'], 51: ['🌦', 'Light drizzle'], 53: ['🌦', 'Drizzle'],
    55: ['🌧', 'Heavy drizzle'], 61: ['🌦', 'Light rain'], 63: ['🌧', 'Rain'], 65: ['🌧', 'Heavy rain'],
    66: ['🌧', 'Freezing rain'], 67: ['🌧', 'Freezing rain'], 71: ['🌨', 'Light snow'], 73: ['🌨', 'Snow'],
    75: ['❄️', 'Heavy snow'], 77: ['🌨', 'Snow grains'], 80: ['🌦', 'Showers'], 81: ['🌧', 'Showers'],
    82: ['⛈', 'Heavy showers'], 85: ['🌨', 'Snow showers'], 86: ['🌨', 'Snow showers'],
    95: ['⛈', 'Thunderstorm'], 96: ['⛈', 'Storm w/ hail'], 99: ['⛈', 'Storm w/ hail'],
  };

  const TYPES = {
    /* ---------- clock ---------- */
    clock: {
      label: 'Clock',
      defaults: { w: 280, h: 170, config: { zones: [], showSeconds: false } },
      render(body, w) {
        body.innerHTML = `
          <div class="wg-clock">
            <div class="wg-clock-time"></div>
            <div class="wg-clock-date"></div>
            <div class="wg-clock-zones"></div>
          </div>`;
        this.tick(body, w);
      },
      tick(body, w) {
        const now = new Date();
        const t = body.querySelector('.wg-clock-time');
        if (!t) return;
        const opts = { hour: 'numeric', minute: '2-digit' };
        if (w.config.showSeconds) opts.second = '2-digit';
        t.textContent = now.toLocaleTimeString([], opts);
        body.querySelector('.wg-clock-date').textContent =
          now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
        const zones = (w.config.zones || []).map(([tz, label]) => {
          let zt = '--';
          try { zt = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone: tz }); } catch {}
          return `<div class="wg-zone-row"><span>${escw(label)}</span><span>${zt}</span></div>`;
        }).join('');
        body.querySelector('.wg-clock-zones').innerHTML = zones;
      },
      configUI(wrap, w, save) {
        wrap.innerHTML = `
          <label class="cfg-row"><input type="checkbox" id="cfgSeconds" ${w.config.showSeconds ? 'checked' : ''}/> Show seconds</label>
          <span class="edit-label">World clocks</span>
          <div id="cfgZoneList" class="cfg-zone-list"></div>
          <div class="cfg-row">
            <select id="cfgZoneSelect" class="font-select">
              ${COMMON_ZONES.map(([tz, l]) => `<option value="${tz}|${l}">${l}</option>`).join('')}
            </select>
            <button id="cfgZoneAdd" class="tool-btn">+ Add</button>
          </div>`;
        const renderList = () => {
          el('cfgZoneList').innerHTML = (w.config.zones || []).map(([tz, l], i) =>
            `<span class="tag-chip">${escw(l)} <button data-i="${i}" class="cfg-zone-rm">✕</button></span>`).join('') || '<span class="muted small">None added</span>';
          el('cfgZoneList').querySelectorAll('.cfg-zone-rm').forEach((b) => {
            b.onclick = () => { w.config.zones.splice(+b.dataset.i, 1); save(); renderList(); };
          });
        };
        renderList();
        el('cfgSeconds').onchange = (e) => { w.config.showSeconds = e.target.checked; save(); };
        el('cfgZoneAdd').onclick = () => {
          const [tz, l] = el('cfgZoneSelect').value.split('|');
          w.config.zones = w.config.zones || [];
          if (!w.config.zones.some((z) => z[0] === tz)) { w.config.zones.push([tz, l]); save(); renderList(); }
        };
      },
    },

    /* ---------- timer ---------- */
    timer: {
      label: 'Timer',
      defaults: { w: 240, h: 260, config: { presets: [5, 10, 25, 45], name: '' } },
      render(body, w) {
        w._t = w._t || { total: (w.config.presets?.[2] || 25) * 60, left: (w.config.presets?.[2] || 25) * 60, running: false };
        body.innerHTML = `
          <div class="wg-timer">
            <input class="wg-timer-name" type="text" placeholder="Name this timer…" maxlength="60" value="${escw(w.config.name || '')}" />
            <svg class="wg-timer-ring" viewBox="0 0 100 100">
              <circle class="ring-bg" cx="50" cy="50" r="44"/>
              <circle class="ring-fg" cx="50" cy="50" r="44"/>
            </svg>
            <div class="wg-timer-mid">
              <div class="wg-timer-time" title="Scroll (or drag up/down) on hours, minutes or seconds to adjust">
                <span data-u="h">00</span><i>:</i><span data-u="m">25</span><i>:</i><span data-u="s">00</span>
              </div>
              <div class="wg-timer-btns">
                <button class="wg-timer-start" title="Start / pause">▶</button>
                <button class="wg-timer-reset" title="Reset">↺</button>
              </div>
            </div>
            <div class="wg-timer-presets">
              ${(w.config.presets || [5, 10, 25, 45]).map((m) => `<button data-m="${m}">${m}m</button>`).join('')}
            </div>
          </div>`;
        const nameInput = body.querySelector('.wg-timer-name');
        nameInput.onchange = () => {
          w.config.name = nameInput.value.trim();
          wapi.put(w.id, { config: w.config });
        };
        nameInput.onpointerdown = (e) => e.stopPropagation();

        // scroll-wheel / drag adjustable time segments (hours, minutes, seconds)
        const STEP = { h: 3600, m: 60, s: 1 };
        const adjust = (u, dir) => {
          const t = w._t;
          if (t.running) return;
          const v = Math.max(0, Math.min(99 * 3600 + 59 * 60 + 59, t.left + STEP[u] * dir));
          t.left = t.total = v;
          TYPES.timer.tick(body, w);
        };
        body.querySelectorAll('.wg-timer-time [data-u]').forEach((seg) => {
          seg.addEventListener('wheel', (e) => {
            e.preventDefault();
            e.stopPropagation();
            adjust(seg.dataset.u, e.deltaY < 0 ? 1 : -1);
          }, { passive: false });
          // vertical drag for touch / pen
          let py = null, acc = 0;
          seg.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            py = e.clientY;
            acc = 0;
            try { seg.setPointerCapture(e.pointerId); } catch {}
          });
          seg.addEventListener('pointermove', (e) => {
            if (py == null) return;
            acc += py - e.clientY;
            py = e.clientY;
            while (acc >= 12) { adjust(seg.dataset.u, 1); acc -= 12; }
            while (acc <= -12) { adjust(seg.dataset.u, -1); acc += 12; }
          });
          seg.addEventListener('pointerup', () => { py = null; });
          seg.addEventListener('pointercancel', () => { py = null; });
        });
        const t = w._t;
        body.querySelector('.wg-timer-start').onclick = (e) => {
          e.stopPropagation();
          if (t.left <= 0) t.left = t.total;
          if (t.left <= 0) return; // nothing to count down
          t.running = !t.running;
          TYPES.timer.tick(body, w);
        };
        body.querySelector('.wg-timer-reset').onclick = (e) => {
          e.stopPropagation();
          t.running = false;
          t.left = t.total;
          TYPES.timer.tick(body, w);
        };
        body.querySelectorAll('.wg-timer-presets button').forEach((b) => {
          b.onclick = (e) => {
            e.stopPropagation();
            t.total = t.left = +b.dataset.m * 60;
            t.running = false;
            TYPES.timer.tick(body, w);
          };
        });
        this.tick(body, w);
      },
      tick(body, w) {
        const t = w._t;
        const timeEl = body.querySelector('.wg-timer-time');
        if (!t || !timeEl) return;
        if (t.running && t.left > 0) {
          t.left--;
          if (t.left === 0) {
            t.running = false;
            body.closest('.widget')?.classList.add('timer-done');
            setTimeout(() => body.closest('.widget')?.classList.remove('timer-done'), 6000);
            // telegram notification (server no-ops if telegram isn't configured)
            const fmtDur = (sec) => {
              const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
              return [h ? h + 'h' : '', m ? m + 'm' : '', s && !h ? s + 's' : ''].filter(Boolean).join(' ') || '0s';
            };
            fetch('/api/notify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ text: `Timer done: ${w.config.name || 'Timer'} (${fmtDur(t.total)})` }),
            }).catch(() => {});
            try {
              const ac = new (window.AudioContext || window.webkitAudioContext)();
              const o = ac.createOscillator(); const g = ac.createGain();
              o.connect(g); g.connect(ac.destination);
              o.frequency.value = 880; g.gain.value = 0.08;
              o.start(); o.stop(ac.currentTime + 0.6);
            } catch {}
          }
        }
        const pad = (v) => String(v).padStart(2, '0');
        timeEl.querySelector('[data-u=h]').textContent = pad(Math.floor(t.left / 3600));
        timeEl.querySelector('[data-u=m]').textContent = pad(Math.floor((t.left % 3600) / 60));
        timeEl.querySelector('[data-u=s]').textContent = pad(t.left % 60);
        body.querySelector('.wg-timer-start').textContent = t.running ? '⏸' : '▶';
        const ring = body.querySelector('.ring-fg');
        const C = 2 * Math.PI * 44;
        ring.style.strokeDasharray = C;
        ring.style.strokeDashoffset = C * (1 - (t.total ? t.left / t.total : 0));
      },
    },

    /* ---------- calendar ---------- */
    calendar: {
      label: 'Calendar',
      defaults: { w: 400, h: 220, config: {} },
      render(body, w) { this.tick(body, w, true); },
      tick(body, w, force) {
        const now = new Date();
        const key = now.toDateString();
        if (!force && body.dataset.day === key) {
          if (Date.now() - (w._calT || 0) > 60000) this.marks(body, w);
          return;
        }
        body.dataset.day = key;
        const year = now.getFullYear(), month = now.getMonth(), today = now.getDate();
        const first = new Date(year, month, 1).getDay();
        const days = new Date(year, month + 1, 0).getDate();
        let cells = '';
        for (let i = 0; i < first; i++) cells += '<span></span>';
        for (let d = 1; d <= days; d++) cells += `<span class="${d === today ? 'cal-today' : ''}">${d}</span>`;
        const end = new Date(year, 11, 31);
        const dayOfYear = Math.floor((now - new Date(year, 0, 0)) / 864e5);
        const total = Math.floor((end - new Date(year, 0, 0)) / 864e5);
        const left = total - dayOfYear;
        const C = 2 * Math.PI * 15;
        body.innerHTML = `
          <div class="wg-cal">
            <div class="wg-cal-left">
              <div class="wg-cal-day">${today}</div>
              <div class="wg-cal-month">${now.toLocaleDateString([], { month: 'short' })}<br><span>${now.toLocaleDateString([], { weekday: 'short' })}</span></div>
              <div class="wg-cal-ring">
                <svg viewBox="0 0 36 36"><circle class="ring-bg" cx="18" cy="18" r="15"/><circle class="ring-fg" cx="18" cy="18" r="15" style="stroke-dasharray:${C};stroke-dashoffset:${C * (1 - dayOfYear / total)}"/></svg>
                <div class="wg-cal-left-txt"><b>${left}</b> days left<br>${dayOfYear}/${total}</div>
              </div>
            </div>
            <div class="wg-cal-grid">
              ${['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d) => `<span class="cal-head">${d}</span>`).join('')}
              ${cells}
            </div>
          </div>`;
        this.marks(body, w);
      },
      // dot-mark days that have a note reminder or standalone reminder
      async marks(body, w) {
        try {
          w._calT = Date.now();
          const [notes, rems] = await Promise.all([
            (await fetch('/api/notes')).json(),
            (await fetch('/api/reminders')).json(),
          ]);
          const dates = [
            ...notes.filter((n) => n.reminder?.enabled).map((n) => n.reminder.at),
            ...rems.filter((r) => r.enabled).map((r) => r.at),
          ];
          const now = new Date();
          const days = new Set(
            dates.map((iso) => new Date(iso))
              .filter((d) => d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear())
              .map((d) => d.getDate())
          );
          body.querySelectorAll('.wg-cal-grid span:not(.cal-head)').forEach((cell) => {
            cell.classList.toggle('cal-rem', !!cell.textContent && days.has(+cell.textContent));
          });
        } catch {}
      },
    },

    /* ---------- reminders ---------- */
    reminders: {
      label: 'Reminders',
      defaults: { w: 320, h: 250, config: {} },
      render(body, w) {
        body.innerHTML = `
          <div class="wg-rem">
            <div class="wg-rem-head">
              <span>⏰ Reminders</span>
              ${EDITABLE ? '<button class="wg-rem-add" title="New reminder">＋</button>' : ''}
            </div>
            <form class="wg-rem-form" hidden>
              <input type="text" class="wg-rem-text" placeholder="Remind me to…" maxlength="200" required />
              <div class="wg-rem-form-row">
                <input type="datetime-local" class="wg-rem-when" required />
                <select class="wg-rem-freq">
                  <option value="once">Once</option>
                  <option value="hourly">Hourly</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                </select>
                <button type="submit" class="wg-rem-save">Add</button>
              </div>
            </form>
            <div class="wg-rem-list"><span class="muted small">Loading…</span></div>
          </div>`;
        body.querySelectorAll('input, select, button, form').forEach((n) => {
          n.addEventListener('pointerdown', (e) => e.stopPropagation());
        });
        const form = body.querySelector('.wg-rem-form');
        if (EDITABLE) {
          body.querySelector('.wg-rem-add').onclick = (e) => {
            e.stopPropagation();
            form.hidden = !form.hidden;
            if (!form.hidden) {
              const d = new Date(Date.now() + 3600e3);
              d.setMinutes(0, 0, 0);
              const pad = (v) => String(v).padStart(2, '0');
              body.querySelector('.wg-rem-when').value =
                `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`;
              body.querySelector('.wg-rem-text').focus();
            }
          };
          form.onsubmit = async (e) => {
            e.preventDefault();
            const text = body.querySelector('.wg-rem-text').value.trim();
            const when = body.querySelector('.wg-rem-when').value;
            if (!text || !when) return;
            await fetch('/api/reminders', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ text, at: new Date(when).toISOString(), freq: body.querySelector('.wg-rem-freq').value }),
            });
            form.hidden = true;
            body.querySelector('.wg-rem-text').value = '';
            this.refresh(body, w);
          };
        }
        this.refresh(body, w);
      },
      async refresh(body, w) {
        w._remT = Date.now();
        try {
          const rems = (await (await fetch('/api/reminders')).json())
            .filter((r) => r.enabled)
            .sort((a, b) => new Date(a.at) - new Date(b.at));
          const list = body.querySelector('.wg-rem-list');
          if (!list) return;
          if (!rems.length) {
            list.innerHTML = '<span class="muted small">No reminders — hit ＋ to add one.</span>';
            return;
          }
          list.innerHTML = rems.map((r) => {
            const d = new Date(r.at);
            const when = d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' +
              d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
            return `<div class="wg-rem-row" data-id="${r.id}">
              <div class="wg-rem-info"><span class="wg-rem-txt">${escw(r.text)}</span>
              <span class="wg-rem-when-txt">${when}${r.freq !== 'once' ? ' · ' + r.freq : ''}</span></div>
              ${EDITABLE ? '<button class="wg-rem-del" title="Delete reminder">✕</button>' : ''}
            </div>`;
          }).join('');
          if (EDITABLE) {
            list.querySelectorAll('.wg-rem-del').forEach((b) => {
              b.addEventListener('pointerdown', (e) => e.stopPropagation());
              b.onclick = async (e) => {
                e.stopPropagation();
                await fetch('/api/reminders/' + b.closest('.wg-rem-row').dataset.id, { method: 'DELETE' });
                this.refresh(body, w);
              };
            });
          }
        } catch {}
      },
      tick(body, w) {
        if (Date.now() - (w._remT || 0) > 60000) this.refresh(body, w);
      },
    },

    /* ---------- weather ---------- */
    weather: {
      label: 'Weather',
      defaults: { w: 280, h: 180, config: { name: '', lat: null, lon: null, unit: 'F' } },
      render(body, w) {
        if (w.config.lat == null) {
          body.innerHTML = '<div class="wg-weather-empty">🌤<br>Set a location in<br>⚙ widget settings</div>';
          return;
        }
        body.innerHTML = '<div class="wg-weather"><div class="wg-weather-load">Loading weather…</div></div>';
        this.fetchWeather(body, w);
      },
      tick(body, w) {
        if (w.config.lat == null) return;
        if (!w._wx || Date.now() - w._wx > 15 * 60 * 1000) this.fetchWeather(body, w);
      },
      async fetchWeather(body, w) {
        w._wx = Date.now();
        const unit = w.config.unit === 'C' ? 'celsius' : 'fahrenheit';
        try {
          const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${w.config.lat}&longitude=${w.config.lon}&current=temperature_2m,weather_code,apparent_temperature&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&temperature_unit=${unit}&timezone=auto&forecast_days=1`);
          const d = await r.json();
          const [icon, label] = WMO[d.current.weather_code] || ['🌡', '—'];
          const wrap = body.querySelector('.wg-weather');
          if (!wrap) return;
          wrap.innerHTML = `
            <div class="wg-weather-top"><span class="wg-weather-city">${escw(w.config.name)} ➤</span></div>
            <div class="wg-weather-main">
              <span class="wg-weather-temp">${Math.round(d.current.temperature_2m)}°</span>
              <span class="wg-weather-icon">${icon}</span>
            </div>
            <div class="wg-weather-sub">${label} · feels ${Math.round(d.current.apparent_temperature)}°</div>
            <div class="wg-weather-sub">H ${Math.round(d.daily.temperature_2m_max[0])}° · L ${Math.round(d.daily.temperature_2m_min[0])}° · ☔ ${d.daily.precipitation_probability_max[0] ?? 0}%</div>`;
        } catch {
          const wrap = body.querySelector('.wg-weather');
          if (wrap) wrap.innerHTML = '<div class="wg-weather-load">Weather unavailable</div>';
        }
      },
      configUI(wrap, w, save) {
        wrap.innerHTML = `
          <span class="edit-label">Location</span>
          <div class="cfg-row">
            <input id="cfgWxSearch" class="note-title-input" style="margin:0" type="text" placeholder="Search city…" value="" />
            <button id="cfgWxGo" class="tool-btn">Search</button>
          </div>
          <div id="cfgWxResults" class="cfg-zone-list"></div>
          <p class="muted small">Current: ${w.config.name ? escw(w.config.name) : 'not set'}</p>
          <span class="edit-label">Units</span>
          <div class="cfg-row">
            <button id="cfgWxF" class="tool-btn ${w.config.unit !== 'C' ? 'pinned-active' : ''}">°F</button>
            <button id="cfgWxC" class="tool-btn ${w.config.unit === 'C' ? 'pinned-active' : ''}">°C</button>
          </div>`;
        const search = async () => {
          const q = el('cfgWxSearch').value.trim();
          if (!q) return;
          el('cfgWxResults').innerHTML = '<span class="muted small">Searching…</span>';
          try {
            const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6`);
            const d = await r.json();
            el('cfgWxResults').innerHTML = (d.results || []).map((res, i) =>
              `<button class="tag-chip cfg-wx-pick" data-i="${i}">${escw(res.name)}, ${escw(res.admin1 || res.country || '')}</button>`).join('') || '<span class="muted small">No results</span>';
            el('cfgWxResults').querySelectorAll('.cfg-wx-pick').forEach((b) => {
              b.onclick = () => {
                const res = d.results[+b.dataset.i];
                w.config.name = res.name;
                w.config.lat = res.latitude;
                w.config.lon = res.longitude;
                w._wx = 0;
                save();
                closeConfig();
              };
            });
          } catch { el('cfgWxResults').innerHTML = '<span class="muted small">Search failed</span>'; }
        };
        el('cfgWxGo').onclick = search;
        el('cfgWxSearch').onkeydown = (e) => { if (e.key === 'Enter') search(); };
        el('cfgWxF').onclick = () => { w.config.unit = 'F'; w._wx = 0; save(); closeConfig(); };
        el('cfgWxC').onclick = () => { w.config.unit = 'C'; w._wx = 0; save(); closeConfig(); };
      },
    },

    /* ---------- whiteboard ---------- */
    whiteboard: {
      label: 'Whiteboard',
      defaults: { w: 400, h: 260, config: { strokes: [] } },
      render(body, w) {
        body.innerHTML = `<div class="wg-wb"><canvas></canvas><div class="wg-wb-hint">${(w.config.strokes || []).length ? '' : '✍️ Tap to write'}</div></div>`;
        const cv = body.querySelector('canvas');
        requestAnimationFrame(() => {
          const r = body.getBoundingClientRect();
          cv.width = r.width * devicePixelRatio;
          cv.height = r.height * devicePixelRatio;
          drawStrokes(cv, w.config.strokes || []);
        });
        if (EDITABLE) {
          body.querySelector('.wg-wb').onclick = () => { if (!editMode) openWhiteboard(w); };
        }
      },
    },
  };

  /* ================= whiteboard drawing ================= */
  const WB_LOGICAL = { w: 1600, h: 1000 };

  function themeInk() {
    return getComputedStyle(document.documentElement).getPropertyValue('--text').trim() || '#e6e8e4';
  }

  function drawStrokes(cv, strokes) {
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cv.width, cv.height);
    const scale = Math.min(cv.width / WB_LOGICAL.w, cv.height / WB_LOGICAL.h);
    for (const st of strokes) {
      ctx.globalCompositeOperation = st.c === 'erase' ? 'destination-out' : 'source-over';
      ctx.strokeStyle = st.c === 'auto' ? themeInk() : (st.c === 'erase' ? '#000' : st.c);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const pts = st.pts;
      if (st.hl) {
        // highlighter: one translucent constant-width path (no pressure, no dark overlaps)
        ctx.globalAlpha = 0.35;
        ctx.lineWidth = Math.max(1, st.s * 4 * scale);
        ctx.beginPath();
        ctx.moveTo(pts[0][0] * scale, pts[0][1] * scale);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0] * scale, pts[i][1] * scale);
        ctx.stroke();
        ctx.globalAlpha = 1;
        continue;
      }
      for (let i = 1; i < pts.length; i++) {
        const p = pts[i][2] ?? 0.5;
        ctx.lineWidth = Math.max(0.5, st.s * (0.4 + p) * scale * (st.c === 'erase' ? 3 : 1));
        ctx.beginPath();
        ctx.moveTo(pts[i - 1][0] * scale, pts[i - 1][1] * scale);
        ctx.lineTo(pts[i][0] * scale, pts[i][1] * scale);
        ctx.stroke();
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  let wbWidget = null;
  let wbColor = 'auto';
  let wbTool = 'pen'; // 'pen' | 'hl' | 'erase'
  let wbDirty = false;
  let wbRedo = [];
  let penSeen = localStorage.getItem('mb-wb-pen') === '1';

  // touch drawing policy: explicit on/off, or auto (fingers draw until a pen is first seen)
  function touchAllowed() {
    const pref = localStorage.getItem('mb-wb-touch');
    if (pref === 'on') return true;
    if (pref === 'off') return false;
    return !penSeen;
  }
  function updateTouchModeBtn() {
    const btn = el('wbTouchMode');
    if (!btn) return;
    btn.textContent = touchAllowed() ? '👆 Touch draws' : '✍️ Pen only';
    btn.title = touchAllowed()
      ? 'Fingers can draw — tap to switch to pen-only (palm rejection)'
      : 'Palm rejection on: only the pen/mouse draws — tap to let fingers draw';
  }

  function openWhiteboard(w) {
    const overlay = el('wbOverlay');
    if (!overlay) return;
    wbWidget = w;
    wbDirty = false;
    wbRedo = [];
    overlay.hidden = false;
    document.body.style.overflow = 'hidden';
    sizeWbCanvas();
    el('wbStatus').textContent = '';
    updateTouchModeBtn();
  }

  function sizeWbCanvas() {
    const cv = el('wbCanvas');
    const rect = cv.getBoundingClientRect();
    cv.width = rect.width * devicePixelRatio;
    cv.height = rect.height * devicePixelRatio;
    drawStrokes(cv, wbWidget.config.strokes || []);
  }

  async function closeWhiteboard() {
    const overlay = el('wbOverlay');
    if (wbWidget && wbDirty) {
      await wapi.put(wbWidget.id, { config: wbWidget.config });
    }
    overlay.hidden = true;
    document.body.style.overflow = '';
    const inst = widgets.find((x) => x.id === wbWidget?.id);
    if (inst?._el) TYPES.whiteboard.render(inst._el.querySelector('.widget-body'), inst);
    wbWidget = null;
  }

  function setupWhiteboard() {
    const cv = el('wbCanvas');
    if (!cv) return;
    let stroke = null;

    // iOS: block long-press text selection, callout menus and gestures on the drawing surface.
    // Palm touches generate touch events — killing their defaults stops the "highlight/right-click"
    // behavior when a hand rests on the screen while writing with the Apple Pencil.
    for (const evt of ['touchstart', 'touchmove', 'touchend']) {
      cv.addEventListener(evt, (e) => e.preventDefault(), { passive: false });
    }
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    el('wbOverlay').addEventListener('gesturestart', (e) => e.preventDefault());

    const toLogical = (e) => {
      const r = cv.getBoundingClientRect();
      const scale = Math.min((r.width * devicePixelRatio) / WB_LOGICAL.w, (r.height * devicePixelRatio) / WB_LOGICAL.h);
      return [
        ((e.clientX - r.left) * devicePixelRatio) / scale,
        ((e.clientY - r.top) * devicePixelRatio) / scale,
        e.pressure || 0.5,
      ];
    };

    cv.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'pen' && !penSeen) {
        penSeen = true;
        localStorage.setItem('mb-wb-pen', '1');
        updateTouchModeBtn();
      }
      if (e.pointerType === 'touch' && !touchAllowed()) return; // palm rejection
      if (!e.isPrimary) return;
      try { cv.setPointerCapture(e.pointerId); } catch {}
      stroke = {
        c: wbTool === 'erase' ? 'erase' : wbColor,
        s: +el('wbSize').value,
        hl: wbTool === 'hl',
        pts: [toLogical(e)],
      };
    });
    cv.addEventListener('pointermove', (e) => {
      if (!stroke) return;
      if (e.pointerType === 'touch' && !touchAllowed()) return;
      let events = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
      if (!events.length) events = [e];
      for (const ev of events) stroke.pts.push(toLogical(ev));
      wbWidget.config.strokes = wbWidget.config.strokes || [];
      drawStrokes(cv, [...wbWidget.config.strokes, stroke]);
    });
    const finish = () => {
      if (!stroke) return;
      if (stroke.pts.length > 1) {
        wbWidget.config.strokes.push(stroke);
        wbRedo = []; // a new stroke invalidates the redo history
        wbDirty = true;
        el('wbStatus').textContent = 'unsaved changes';
      }
      stroke = null;
    };
    cv.addEventListener('pointerup', finish);
    cv.addEventListener('pointercancel', () => { stroke = null; });

    /* tools */
    const setTool = (tool) => {
      wbTool = tool;
      el('wbPen').classList.toggle('pinned-active', tool === 'pen');
      el('wbHl').classList.toggle('pinned-active', tool === 'hl');
      el('wbEraser').classList.toggle('pinned-active', tool === 'erase');
    };
    el('wbPen').onclick = () => setTool('pen');
    el('wbHl').onclick = () => setTool('hl');
    el('wbEraser').onclick = () => setTool(wbTool === 'erase' ? 'pen' : 'erase');

    document.querySelectorAll('.wb-color').forEach((b) => {
      b.onclick = () => {
        document.querySelectorAll('.wb-color').forEach((x) => x.classList.remove('selected'));
        b.classList.add('selected');
        wbColor = b.dataset.color;
        if (wbTool === 'erase') setTool('pen');
      };
    });

    const markDirty = () => {
      wbDirty = true;
      el('wbStatus').textContent = 'unsaved changes';
    };
    const undo = () => {
      const st = (wbWidget.config.strokes || []).pop();
      if (!st) return;
      wbRedo.push(st);
      markDirty();
      drawStrokes(cv, wbWidget.config.strokes);
    };
    const redo = () => {
      const st = wbRedo.pop();
      if (!st) return;
      wbWidget.config.strokes.push(st);
      markDirty();
      drawStrokes(cv, wbWidget.config.strokes);
    };
    el('wbUndo').onclick = undo;
    el('wbRedo').onclick = redo;
    document.addEventListener('keydown', (e) => {
      if (!wbWidget || el('wbOverlay').hidden) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
    });

    el('wbClear').onclick = () => {
      if (!confirm('Clear the whole whiteboard?')) return;
      wbRedo = [];
      wbWidget.config.strokes = [];
      markDirty();
      drawStrokes(cv, []);
    };

    el('wbTouchMode').onclick = () => {
      localStorage.setItem('mb-wb-touch', touchAllowed() ? 'off' : 'on');
      updateTouchModeBtn();
    };

    el('wbClose').onclick = closeWhiteboard;
    window.addEventListener('resize', () => { if (wbWidget) sizeWbCanvas(); });
    // periodic autosave while open
    setInterval(async () => {
      if (wbWidget && wbDirty) {
        await wapi.put(wbWidget.id, { config: wbWidget.config });
        wbDirty = false;
        el('wbStatus').textContent = 'saved ✓';
      }
    }, 15000);
  }

  /* ================= canvas & widget DOM ================= */

  function layoutCanvas() {
    const maxBottom = widgets.reduce((m, w) => Math.max(m, w.y + w.h), 0);
    canvas.style.height = (widgets.length || editMode ? Math.max(maxBottom + 20, editMode ? 300 : 0) : 0) + 'px';
    canvas.classList.toggle('empty', !widgets.length && !editMode);
  }

  function renderAll() {
    canvas.innerHTML = '';
    // mount in visual order (top-to-bottom, left-to-right) so the
    // stacked mobile layout mirrors the desktop arrangement
    widgets.sort((a, b) => (a.y - b.y) || (a.x - b.x));
    for (const w of widgets) mountWidget(w);
    layoutCanvas();
  }

  function mountWidget(w) {
    const div = document.createElement('div');
    div.className = 'widget wg-type-' + w.type;
    div.style.left = w.x + 'px';
    div.style.top = w.y + 'px';
    div.style.width = w.w + 'px';
    div.style.height = w.h + 'px';
    div.style.zIndex = w.z || 1;
    div.dataset.id = w.id;

    const body = document.createElement('div');
    body.className = 'widget-body';
    div.appendChild(body);

    if (EDITABLE) {
      const bar = document.createElement('div');
      bar.className = 'widget-editbar';
      bar.innerHTML = `<span class="widget-type-label">${TYPES[w.type]?.label || w.type}</span>`;
      if (TYPES[w.type]?.configUI) {
        const cfg = document.createElement('button');
        cfg.textContent = '⚙';
        cfg.title = 'Widget settings';
        cfg.onclick = (e) => { e.stopPropagation(); openConfig(w); };
        bar.appendChild(cfg);
      }
      const rm = document.createElement('button');
      rm.textContent = '✕';
      rm.title = 'Remove widget';
      rm.onclick = async (e) => {
        e.stopPropagation();
        if (!confirm('Remove this widget?')) return;
        await wapi.del(w.id);
        widgets = widgets.filter((x) => x.id !== w.id);
        renderAll();
      };
      bar.appendChild(rm);
      div.appendChild(bar);

      const handle = document.createElement('div');
      handle.className = 'widget-resize';
      div.appendChild(handle);
      attachDragResize(div, handle, w);
    }

    canvas.appendChild(div);
    w._el = div;
    TYPES[w.type]?.render(body, w);
  }

  function attachDragResize(div, handle, w) {
    let mode = null; // 'drag' | 'resize'
    let start = null;

    const down = (e, m) => {
      if (!editMode) return;
      // stacked mobile layout has no free positioning
      if (document.documentElement.dataset.ui === 'mobile') return;
      mode = m;
      start = { px: e.clientX, py: e.clientY, x: w.x, y: w.y, w: w.w, h: w.h };
      w.z = Math.max(0, ...widgets.map((x) => x.z || 1)) + 1;
      div.style.zIndex = w.z;
      try { div.setPointerCapture(e.pointerId); } catch {}
      div.classList.add('dragging');
      e.preventDefault();
    };
    div.addEventListener('pointerdown', (e) => {
      if (e.target === handle) return down(e, 'resize');
      if (e.target.closest('button')) return;
      down(e, 'drag');
    });
    div.addEventListener('pointermove', (e) => {
      if (!mode) return;
      const dx = e.clientX - start.px, dy = e.clientY - start.py;
      if (mode === 'drag') {
        w.x = snap(Math.min(Math.max(0, start.x + dx), canvas.clientWidth - 60));
        w.y = snap(Math.max(0, start.y + dy));
        div.style.left = w.x + 'px';
        div.style.top = w.y + 'px';
      } else {
        w.w = snap(Math.max(140, start.w + dx));
        w.h = snap(Math.max(110, start.h + dy));
        div.style.width = w.w + 'px';
        div.style.height = w.h + 'px';
      }
      layoutCanvas();
    });
    div.addEventListener('pointerup', async () => {
      if (!mode) return;
      div.classList.remove('dragging');
      const wasResize = mode === 'resize';
      mode = null;
      await wapi.put(w.id, { x: w.x, y: w.y, w: w.w, h: w.h, z: w.z });
      if (wasResize) TYPES[w.type]?.render(div.querySelector('.widget-body'), w);
    });
  }

  /* ================= config modal ================= */
  function openConfig(w) {
    const modal = el('widgetConfigModal');
    el('widgetConfigTitle').textContent = (TYPES[w.type]?.label || 'Widget') + ' settings';
    const save = async () => {
      await wapi.put(w.id, { config: w.config });
      TYPES[w.type]?.render(w._el.querySelector('.widget-body'), w);
    };
    TYPES[w.type].configUI(el('widgetConfigBody'), w, save);
    modal.hidden = false;
  }
  function closeConfig() { const m = el('widgetConfigModal'); if (m) m.hidden = true; }
  if (el('closeWidgetConfig')) {
    el('closeWidgetConfig').onclick = closeConfig;
    el('widgetConfigModal').addEventListener('mousedown', (e) => { if (e.target === el('widgetConfigModal')) closeConfig(); });
  }

  /* ================= edit mode & palette ================= */
  async function addWidget(type, x, y) {
    const d = TYPES[type].defaults;
    if (x == null) {
      x = 20;
      y = snap(widgets.reduce((m, w) => Math.max(m, w.y + w.h), 0) + 20);
    }
    const w = await wapi.post({ type, x: snap(x), y: snap(y), w: d.w, h: d.h, config: JSON.parse(JSON.stringify(d.config)) });
    widgets.push(w);
    mountWidget(w);
    layoutCanvas();
  }

  function setupEditMode() {
    const btn = el('widgetEditBtn');
    if (!btn) return;
    btn.onclick = () => {
      editMode = !editMode;
      document.body.classList.toggle('widget-edit', editMode);
      btn.classList.toggle('pinned-active', editMode);
      btn.innerHTML = editMode ? '✓ <span class="btn-txt">Done Editing</span>' : '⊞ <span class="btn-txt">Edit Widgets</span>';
      el('widgetPalette').hidden = !editMode;
      layoutCanvas();
    };

    // palette: click to add, or drag onto the canvas
    document.querySelectorAll('.palette-item').forEach((item) => {
      let ghost = null, moved = false, sx = 0, sy = 0;
      item.addEventListener('pointerdown', (e) => {
        moved = false; sx = e.clientX; sy = e.clientY;
        item.setPointerCapture(e.pointerId);
      });
      item.addEventListener('pointermove', (e) => {
        if (!item.hasPointerCapture(e.pointerId)) return;
        if (!moved && Math.hypot(e.clientX - sx, e.clientY - sy) < 6) return;
        moved = true;
        if (!ghost) {
          ghost = document.createElement('div');
          ghost.className = 'widget-ghost';
          ghost.textContent = item.textContent;
          document.body.appendChild(ghost);
        }
        ghost.style.left = e.clientX + 8 + 'px';
        ghost.style.top = e.clientY + 8 + 'px';
      });
      item.addEventListener('pointerup', async (e) => {
        if (ghost) { ghost.remove(); ghost = null; }
        const type = item.dataset.type;
        if (!moved) return addWidget(type);
        const r = canvas.getBoundingClientRect();
        if (e.clientY >= r.top - 40 && e.clientX >= r.left && e.clientX <= r.right) {
          addWidget(type, e.clientX - r.left, Math.max(0, e.clientY - r.top));
        }
      });
    });
  }

  /* ================= external API (context menus in app.js) ================= */
  window.WidgetAPI = {
    hasConfig(id) {
      const w = widgets.find((x) => x.id === id);
      return !!(w && TYPES[w.type]?.configUI);
    },
    openConfig(id) {
      const w = widgets.find((x) => x.id === id);
      if (w && TYPES[w.type]?.configUI) openConfig(w);
    },
    async remove(id) {
      if (!confirm('Remove this widget?')) return;
      await wapi.del(id);
      widgets = widgets.filter((x) => x.id !== id);
      renderAll();
    },
    toggleEdit() {
      el('widgetEditBtn')?.click();
    },
  };

  /* ================= tick loop ================= */
  setInterval(() => {
    for (const w of widgets) {
      const body = w._el?.querySelector('.widget-body');
      if (body && TYPES[w.type]?.tick) TYPES[w.type].tick(body, w);
    }
  }, 1000);

  /* ================= init ================= */
  (async () => {
    widgets = await wapi.get();
    renderAll();
    setupEditMode();
    setupWhiteboard();
  })();
})();

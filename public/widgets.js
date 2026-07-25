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

  /* ================= learning-widget data & helpers ================= */
  function dayIndex(n) {
    const d = new Date();
    const doy = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 864e5);
    return ((doy % n) + n) % n;
  }
  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  function ymd(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
  function beep(freq = 880, dur = 0.5) {
    try {
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      const o = ac.createOscillator(), g = ac.createGain();
      o.connect(g); g.connect(ac.destination);
      o.frequency.value = freq; g.gain.value = 0.07;
      o.start(); o.stop(ac.currentTime + dur);
    } catch {}
  }
  function tgPing(text) {
    fetch('/api/notify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) }).catch(() => {});
  }

  const WORDS = [
    { w: 'Petrichor', pos: 'noun', def: 'The pleasant, earthy smell after rain falls on dry ground.', ex: 'The petrichor drifted in as the first spring storm arrived.' },
    { w: 'Sonder', pos: 'noun', def: 'The realization that each passerby is living a life as vivid and complex as your own.', ex: 'A wave of sonder hit her on the crowded train.' },
    { w: 'Ephemeral', pos: 'adj', def: 'Lasting for a very short time.', ex: 'Fame can be ephemeral — here today, gone tomorrow.' },
    { w: 'Serendipity', pos: 'noun', def: 'The occurrence of happy or beneficial events by chance.', ex: 'Finding that book was pure serendipity.' },
    { w: 'Ineffable', pos: 'adj', def: 'Too great or extreme to be expressed in words.', ex: 'The view from the summit was ineffable.' },
    { w: 'Mellifluous', pos: 'adj', def: 'Sweet or musical; pleasant to hear.', ex: 'Her mellifluous voice calmed the room.' },
    { w: 'Quixotic', pos: 'adj', def: 'Extremely idealistic; unrealistic and impractical.', ex: 'A quixotic plan to end all traffic overnight.' },
    { w: 'Halcyon', pos: 'adj', def: 'Denoting a past time that was idyllically happy and peaceful.', ex: 'The halcyon days of summer.' },
    { w: 'Ubiquitous', pos: 'adj', def: 'Present, appearing, or found everywhere.', ex: 'Smartphones are now ubiquitous.' },
    { w: 'Susurrus', pos: 'noun', def: 'A whispering or rustling sound.', ex: 'The susurrus of leaves in the wind.' },
    { w: 'Eloquent', pos: 'adj', def: 'Fluent or persuasive in speaking or writing.', ex: 'An eloquent plea for kindness.' },
    { w: 'Resilience', pos: 'noun', def: 'The capacity to recover quickly from difficulties.', ex: 'Her resilience carried the team through.' },
    { w: 'Nascent', pos: 'adj', def: 'Just coming into existence and beginning to show potential.', ex: 'A nascent industry with huge promise.' },
    { w: 'Pragmatic', pos: 'adj', def: 'Dealing with things sensibly and realistically.', ex: 'A pragmatic approach to the budget.' },
    { w: 'Luminous', pos: 'adj', def: 'Full of or shedding light; radiant.', ex: 'A luminous full moon.' },
    { w: 'Solitude', pos: 'noun', def: 'The state of being alone, often by choice and at peace.', ex: 'He found clarity in solitude.' },
    { w: 'Tenacity', pos: 'noun', def: 'The quality of being determined and persistent.', ex: 'Her tenacity won the marathon.' },
    { w: 'Zenith', pos: 'noun', def: 'The time at which something is most powerful or successful.', ex: 'At the zenith of her career.' },
    { w: 'Cathartic', pos: 'adj', def: 'Providing psychological relief through the release of emotions.', ex: 'A cathartic good cry.' },
    { w: 'Diligent', pos: 'adj', def: 'Having or showing care and effort in work.', ex: 'A diligent student who never skips.' },
    { w: 'Empathy', pos: 'noun', def: 'The ability to understand and share the feelings of another.', ex: 'She listened with real empathy.' },
    { w: 'Fortitude', pos: 'noun', def: 'Courage in pain or adversity.', ex: 'He faced the news with fortitude.' },
    { w: 'Gregarious', pos: 'adj', def: 'Fond of company; sociable.', ex: 'A gregarious host who knew everyone.' },
    { w: 'Meticulous', pos: 'adj', def: 'Showing great attention to detail; very careful.', ex: 'Meticulous notes filled the margins.' },
    { w: 'Panacea', pos: 'noun', def: 'A supposed remedy for all difficulties or diseases.', ex: 'Money is no panacea for unhappiness.' },
    { w: 'Wanderlust', pos: 'noun', def: 'A strong desire to travel and explore the world.', ex: 'Her wanderlust took her to six continents.' },
    { w: 'Equanimity', pos: 'noun', def: 'Mental calmness and composure, especially in difficulty.', ex: 'She handled the crisis with equanimity.' },
    { w: 'Sagacious', pos: 'adj', def: 'Having keen mental discernment and good judgment; wise.', ex: 'A sagacious investor who saw the crash coming.' },
    { w: 'Ardent', pos: 'adj', def: 'Very enthusiastic or passionate.', ex: 'An ardent supporter of the cause.' },
    { w: 'Lucid', pos: 'adj', def: 'Expressed clearly; easy to understand.', ex: 'A lucid explanation of a hard idea.' },
  ];

  const FLASHCARDS = {
    es: { name: 'Spanish', cards: [
      { f: 'Hola', b: 'Hello' }, { f: 'Gracias', b: 'Thank you' }, { f: 'Por favor', b: 'Please' },
      { f: 'Buenos días', b: 'Good morning' }, { f: '¿Cómo estás?', b: 'How are you?' }, { f: 'Lo siento', b: "I'm sorry" },
      { f: '¿Cuánto cuesta?', b: 'How much is it?' }, { f: 'No entiendo', b: "I don't understand" },
      { f: '¿Dónde está el baño?', b: 'Where is the bathroom?' }, { f: 'Salud', b: 'Cheers / Bless you' },
      { f: 'Hasta luego', b: 'See you later' }, { f: 'Me gusta', b: 'I like it' },
    ] },
    fr: { name: 'French', cards: [
      { f: 'Bonjour', b: 'Hello / Good day' }, { f: 'Merci', b: 'Thank you' }, { f: "S'il vous plaît", b: 'Please' },
      { f: 'Excusez-moi', b: 'Excuse me' }, { f: 'Comment ça va?', b: 'How are you?' }, { f: 'Je ne sais pas', b: "I don't know" },
      { f: 'Où sont les toilettes?', b: 'Where is the toilet?' }, { f: "C'est combien?", b: 'How much is it?' },
      { f: 'Je voudrais…', b: 'I would like…' }, { f: 'À bientôt', b: 'See you soon' },
      { f: "Je t'aime", b: 'I love you' }, { f: 'Santé', b: 'Cheers' },
    ] },
    de: { name: 'German', cards: [
      { f: 'Hallo', b: 'Hello' }, { f: 'Danke', b: 'Thank you' }, { f: 'Bitte', b: "Please / You're welcome" },
      { f: 'Guten Morgen', b: 'Good morning' }, { f: 'Wie geht es dir?', b: 'How are you?' }, { f: 'Entschuldigung', b: 'Excuse me / Sorry' },
      { f: 'Ich verstehe nicht', b: "I don't understand" }, { f: 'Wie viel kostet das?', b: 'How much is it?' },
      { f: 'Wo ist die Toilette?', b: 'Where is the toilet?' }, { f: 'Prost', b: 'Cheers' },
      { f: 'Bis später', b: 'See you later' }, { f: 'Ich mag das', b: 'I like it' },
    ] },
    it: { name: 'Italian', cards: [
      { f: 'Ciao', b: 'Hi / Bye' }, { f: 'Grazie', b: 'Thank you' }, { f: 'Per favore', b: 'Please' },
      { f: 'Buongiorno', b: 'Good morning' }, { f: 'Come stai?', b: 'How are you?' }, { f: 'Mi dispiace', b: "I'm sorry" },
      { f: 'Non capisco', b: "I don't understand" }, { f: 'Quanto costa?', b: 'How much is it?' },
      { f: "Dov'è il bagno?", b: 'Where is the bathroom?' }, { f: 'Salute', b: 'Cheers' },
      { f: 'A dopo', b: 'See you later' }, { f: 'Mi piace', b: 'I like it' },
    ] },
    ja: { name: 'Japanese', cards: [
      { f: 'Konnichiwa', b: 'Hello', p: 'こんにちは' }, { f: 'Arigatou', b: 'Thank you', p: 'ありがとう' },
      { f: 'Onegaishimasu', b: 'Please', p: 'お願いします' }, { f: 'Ohayou', b: 'Good morning', p: 'おはよう' },
      { f: 'Genki desu ka?', b: 'How are you?', p: '元気ですか' }, { f: 'Sumimasen', b: 'Excuse me / Sorry', p: 'すみません' },
      { f: 'Wakarimasen', b: "I don't understand", p: 'わかりません' }, { f: 'Ikura desu ka?', b: 'How much is it?', p: 'いくらですか' },
      { f: 'Toire wa doko desu ka?', b: 'Where is the toilet?', p: 'トイレはどこですか' }, { f: 'Kanpai', b: 'Cheers', p: '乾杯' },
      { f: 'Mata ne', b: 'See you', p: 'またね' }, { f: 'Suki desu', b: 'I like it', p: '好きです' },
    ] },
  };

  const QUOTES = [
    { t: 'The secret of getting ahead is getting started.', a: 'Mark Twain' },
    { t: 'It always seems impossible until it’s done.', a: 'Nelson Mandela' },
    { t: 'Simplicity is the soul of efficiency.', a: 'Austin Freeman' },
    { t: 'The only way to learn a new programming language is by writing programs in it.', a: 'Dennis Ritchie' },
    { t: 'Premature optimization is the root of all evil.', a: 'Donald Knuth' },
    { t: 'Talk is cheap. Show me the code.', a: 'Linus Torvalds' },
    { t: 'Whether you think you can, or you think you can’t — you’re right.', a: 'Henry Ford' },
    { t: 'Discipline is choosing between what you want now and what you want most.', a: 'Abraham Lincoln' },
    { t: 'We suffer more often in imagination than in reality.', a: 'Seneca' },
    { t: 'The impediment to action advances action. What stands in the way becomes the way.', a: 'Marcus Aurelius' },
    { t: 'Knowledge is of no value unless you put it into practice.', a: 'Anton Chekhov' },
    { t: 'Success is the sum of small efforts repeated day in and day out.', a: 'Robert Collier' },
    { t: 'First, solve the problem. Then, write the code.', a: 'John Johnson' },
    { t: 'The best way to predict the future is to invent it.', a: 'Alan Kay' },
    { t: 'An investment in knowledge pays the best interest.', a: 'Benjamin Franklin' },
  ];

  const QUIZ = {
    prog: [
      { q: 'What is the time complexity of binary search?', a: 'O(log n) — it halves the search space each step.' },
      { q: 'What does "idempotent" mean for an API endpoint?', a: 'Calling it multiple times has the same effect as calling it once (e.g. PUT, DELETE).' },
      { q: 'Difference between a process and a thread?', a: 'Processes have isolated memory; threads share the process memory and are lighter to create.' },
      { q: 'What is a race condition?', a: 'A bug where the result depends on the non-deterministic timing of concurrent operations.' },
      { q: 'What is a pure function?', a: 'A function with no side effects whose output depends only on its inputs.' },
      { q: 'What does ACID stand for in databases?', a: 'Atomicity, Consistency, Isolation, Durability.' },
      { q: 'What is the CAP theorem?', a: 'A distributed store can guarantee at most two of Consistency, Availability, Partition-tolerance.' },
      { q: 'What is dependency injection?', a: 'Supplying an object’s dependencies from outside rather than constructing them internally.' },
      { q: 'Compiled vs interpreted language?', a: 'Compiled is translated to machine code ahead of time; interpreted is executed by a runtime at run time.' },
      { q: 'What is a memory leak?', a: 'Memory that is no longer needed but never freed, so usage grows over time.' },
    ],
    compeng: [
      { q: 'What is pipelining in a CPU?', a: 'Overlapping instruction stages (fetch, decode, execute…) so several are in flight at once.' },
      { q: 'What is a cache miss?', a: 'When requested data isn’t in the cache and must be fetched from slower memory.' },
      { q: 'Describe the memory hierarchy.', a: 'Registers → L1/L2/L3 cache → RAM → disk, trading speed for capacity going down.' },
      { q: 'What does a branch predictor do?', a: 'Guesses a branch’s outcome to keep the pipeline full; a misprediction causes a flush.' },
      { q: 'What is DMA?', a: 'Direct Memory Access — devices move data to/from RAM without the CPU handling each byte.' },
      { q: 'RISC vs CISC?', a: 'RISC: many simple fixed-length instructions. CISC: fewer complex variable-length ones.' },
      { q: 'What is virtual memory?', a: 'A per-process abstraction of a large contiguous address space, mapped to RAM + disk via paging.' },
      { q: 'What is an interrupt?', a: 'A signal that pauses the CPU to handle an event, saving state and jumping to a handler.' },
      { q: 'What is endianness?', a: 'Byte order of multi-byte values — big-endian stores the most-significant byte first, little-endian last.' },
      { q: 'What is a pipeline hazard?', a: 'A data, control, or structural conflict that stops the next instruction running in its slot.' },
    ],
    math: [
      { q: 'What is the derivative of sin(x)?', a: 'cos(x).' },
      { q: 'State the Pythagorean theorem.', a: 'In a right triangle, a² + b² = c², where c is the hypotenuse.' },
      { q: 'What is Euler’s identity?', a: 'e^(iπ) + 1 = 0.' },
      { q: 'What is the integral of 1/x?', a: 'ln|x| + C.' },
      { q: 'What does a matrix determinant of 0 mean?', a: 'The matrix is singular — non-invertible; the linear map collapses volume.' },
      { q: 'State Bayes’ theorem.', a: 'P(A|B) = P(B|A)·P(A) / P(B).' },
      { q: 'Sum of the first n integers?', a: 'n(n + 1) / 2.' },
      { q: 'What is an eigenvector?', a: 'A nonzero vector that only scales (not rotates) under a linear map; its factor is the eigenvalue.' },
      { q: 'Geometric meaning of the dot product?', a: '|a||b|cos(θ) — how much two vectors point the same way.' },
      { q: 'What is a limit?', a: 'The value a function approaches as its input approaches a given point.' },
    ],
    ee: [
      { q: 'State Ohm’s law.', a: 'V = I·R (voltage = current × resistance).' },
      { q: 'What is Kirchhoff’s current law?', a: 'Current into a node equals current out of it (charge is conserved).' },
      { q: 'What does a capacitor do?', a: 'Stores energy in an electric field, resists voltage change; blocks DC, passes AC.' },
      { q: 'What does an inductor do?', a: 'Stores energy in a magnetic field, resists current change; passes DC, impedes AC.' },
      { q: 'What is impedance?', a: 'AC resistance including reactance: Z = R + jX (complex, frequency-dependent).' },
      { q: 'Define RMS voltage.', a: 'The equivalent DC voltage delivering equal power; for a sine wave, Vpeak/√2.' },
      { q: 'What is the RC time constant?', a: 'τ = R·C — time to charge/discharge to ~63% of the final value.' },
      { q: 'What is a diode?', a: 'A component that lets current flow in only one direction.' },
      { q: 'AC vs DC?', a: 'DC flows one constant direction; AC periodically reverses direction.' },
      { q: 'What is a decibel (power)?', a: 'A log ratio: dB = 10·log₁₀(P₁/P₂).' },
    ],
    cs: [
      { q: 'Average hash-table lookup time?', a: 'O(1) amortized, with a good hash and low load factor.' },
      { q: 'Big-O of quicksort?', a: 'O(n log n) average, O(n²) worst case.' },
      { q: 'What is a deadlock?', a: 'Processes each waiting for resources the others hold, so none can proceed.' },
      { q: 'Stack vs queue?', a: 'Stack is LIFO (last-in-first-out); queue is FIFO (first-in-first-out).' },
      { q: 'What is P vs NP?', a: 'Whether every problem verifiable quickly (NP) can also be solved quickly (P). Still open.' },
      { q: 'What is dynamic programming?', a: 'Solving overlapping subproblems once and reusing results (memoization/tabulation).' },
      { q: 'What is BFS good for?', a: 'Level-by-level graph traversal; finds shortest paths in unweighted graphs.' },
      { q: 'Array index access time?', a: 'O(1) — constant time.' },
      { q: 'What does DRY mean?', a: 'Don’t Repeat Yourself — avoid duplicating logic.' },
      { q: 'What is recursion?', a: 'A function calling itself on smaller subproblems down to a base case.' },
    ],
  };

  // factory: builds a self-contained "flip to reveal" quiz widget for a topic bank
  function quizType(key, label, emoji) {
    const t = {
      label,
      defaults: { w: 320, h: 220, config: {} },
      render(body, w) {
        const bank = QUIZ[key];
        if (!w._q) w._q = { order: shuffle([...bank.keys()]), pos: 0, show: false };
        const st = w._q;
        const item = bank[st.order[st.pos]];
        body.innerHTML = `
          <div class="wg-quiz">
            <div class="wg-quiz-head"><span>${emoji} ${escw(label)}</span><span>${st.pos + 1}/${bank.length}</span></div>
            <div class="wg-quiz-q">${escw(item.q)}</div>
            <div class="wg-quiz-a"${st.show ? '' : ' hidden'}>${escw(item.a)}</div>
            <div class="wg-quiz-foot">
              <button class="wg-btn wg-quiz-reveal">${st.show ? 'Hide' : 'Reveal'}</button>
              <button class="wg-btn wg-quiz-next">Next ›</button>
            </div>
          </div>`;
        const stop = (e2) => e2 && e2.addEventListener('pointerdown', (e) => e.stopPropagation());
        const rev = body.querySelector('.wg-quiz-reveal'); stop(rev);
        rev.onclick = (e) => { e.stopPropagation(); st.show = !st.show; t.render(body, w); };
        const nx = body.querySelector('.wg-quiz-next'); stop(nx);
        nx.onclick = (e) => {
          e.stopPropagation();
          st.show = false; st.pos++;
          if (st.pos >= bank.length) { st.pos = 0; st.order = shuffle([...bank.keys()]); }
          t.render(body, w);
        };
      },
    };
    return t;
  }

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

    /* ---------- word of the day ---------- */
    wotd: {
      label: 'Word of the Day',
      defaults: { w: 320, h: 210, config: { learned: [], pick: null, day: null } },
      render(body, w) {
        const today = new Date().toDateString();
        body.dataset.d = today;
        let idx = (w.config.pick != null && w.config.day === today) ? w.config.pick : dayIndex(WORDS.length);
        idx = ((idx % WORDS.length) + WORDS.length) % WORDS.length;
        const word = WORDS[idx];
        const learned = (w.config.learned || []).includes(word.w);
        body.innerHTML = `
          <div class="wg-wotd">
            <div class="wg-wotd-head">
              <span class="wg-wotd-word">${escw(word.w)}</span>
              <span class="wg-wotd-pos">${escw(word.pos)}</span>
            </div>
            <div class="wg-wotd-def">${escw(word.def)}</div>
            <div class="wg-wotd-ex">&ldquo;${escw(word.ex)}&rdquo;</div>
            <div class="wg-wotd-foot">
              <button class="wg-btn wg-wotd-learned ${learned ? 'on' : ''}">${learned ? '✓ Learned' : '＋ Learned'}</button>
              <span class="wg-wotd-count">${(w.config.learned || []).length} learned</span>
              <button class="wg-btn wg-wotd-new">↻ New</button>
            </div>
          </div>`;
        const stop = (e2) => e2 && e2.addEventListener('pointerdown', (e) => e.stopPropagation());
        const nb = body.querySelector('.wg-wotd-new'); stop(nb);
        const lb = body.querySelector('.wg-wotd-learned'); stop(lb);
        nb.onclick = (e) => {
          e.stopPropagation();
          let n; do { n = Math.floor(Math.random() * WORDS.length); } while (n === idx && WORDS.length > 1);
          w.config.pick = n; w.config.day = today;
          wapi.put(w.id, { config: w.config });
          this.render(body, w);
        };
        lb.onclick = (e) => {
          e.stopPropagation();
          w.config.learned = w.config.learned || [];
          const i = w.config.learned.indexOf(word.w);
          if (i >= 0) w.config.learned.splice(i, 1); else w.config.learned.push(word.w);
          wapi.put(w.id, { config: w.config });
          this.render(body, w);
        };
      },
      tick(body, w) {
        const today = new Date().toDateString();
        if (body.dataset.d && body.dataset.d !== today) this.render(body, w);
      },
    },

    /* ---------- language flashcards ---------- */
    flashcards: {
      label: 'Flashcards',
      defaults: { w: 300, h: 230, config: { deck: 'es' } },
      render(body, w) {
        const deck = FLASHCARDS[w.config.deck] || FLASHCARDS.es;
        if (!w._fc || w._fc.key !== w.config.deck) {
          w._fc = { key: w.config.deck, order: shuffle([...deck.cards.keys()]), pos: 0, flip: false, known: 0 };
        }
        const st = w._fc;
        const card = deck.cards[st.order[st.pos]];
        body.innerHTML = `
          <div class="wg-fc">
            <div class="wg-fc-head"><span>🎴 ${escw(deck.name)}</span><span>${st.pos + 1}/${deck.cards.length} · ✓ ${st.known}</span></div>
            <div class="wg-fc-card ${st.flip ? 'flipped' : ''}">
              ${st.flip
                ? `<div class="wg-fc-face">${escw(card.b)}</div>`
                : `<div class="wg-fc-face">${escw(card.f)}${card.p ? `<span class="wg-fc-pron">${escw(card.p)}</span>` : ''}</div>`}
            </div>
            <div class="wg-fc-foot">
              <button class="wg-btn wg-fc-again">↻ Again</button>
              <button class="wg-btn wg-fc-flip">${st.flip ? 'Front' : 'Flip'}</button>
              <button class="wg-btn wg-fc-got">✓ Got it</button>
            </div>
          </div>`;
        const stop = (e2) => e2 && e2.addEventListener('pointerdown', (e) => e.stopPropagation());
        const cardEl = body.querySelector('.wg-fc-card'); stop(cardEl);
        cardEl.onclick = (e) => { e.stopPropagation(); st.flip = !st.flip; this.render(body, w); };
        const flip = body.querySelector('.wg-fc-flip'); stop(flip);
        flip.onclick = (e) => { e.stopPropagation(); st.flip = !st.flip; this.render(body, w); };
        const again = body.querySelector('.wg-fc-again'); stop(again);
        again.onclick = (e) => { e.stopPropagation(); this.advance(body, w, false); };
        const got = body.querySelector('.wg-fc-got'); stop(got);
        got.onclick = (e) => { e.stopPropagation(); this.advance(body, w, true); };
      },
      advance(body, w, knew) {
        const deck = FLASHCARDS[w.config.deck] || FLASHCARDS.es;
        const st = w._fc;
        if (knew) st.known++;
        st.flip = false;
        st.pos++;
        if (st.pos >= deck.cards.length) { st.pos = 0; st.known = 0; st.order = shuffle([...deck.cards.keys()]); }
        this.render(body, w);
      },
      configUI(wrap, w, save) {
        wrap.innerHTML = `<span class="edit-label">Deck</span><div class="cfg-row" style="flex-wrap:wrap">` +
          Object.entries(FLASHCARDS).map(([k, d]) => `<button class="tag-chip fc-pick ${w.config.deck === k ? 'active' : ''}" data-k="${k}">${escw(d.name)}</button>`).join('') +
          `</div>`;
        wrap.querySelectorAll('.fc-pick').forEach((b) => (b.onclick = () => { w.config.deck = b.dataset.k; w._fc = null; save(); closeConfig(); }));
      },
    },

    /* ---------- pomodoro focus ---------- */
    pomodoro: {
      label: 'Pomodoro',
      defaults: { w: 240, h: 270, config: { work: 25, brk: 5, longBrk: 15, done: 0, date: null } },
      total(w, p) { return ((p.phase === 'work' ? w.config.work : p.phase === 'long' ? w.config.longBrk : w.config.brk) || 25) * 60; },
      render(body, w) {
        if (!w._pomo) w._pomo = { phase: 'work', left: (w.config.work || 25) * 60, running: false, round: 0 };
        const p = w._pomo;
        const label = p.phase === 'work' ? '🎯 Focus' : p.phase === 'long' ? '🌙 Long break' : '☕ Break';
        const today = new Date().toDateString();
        const doneToday = w.config.date === today ? (w.config.done || 0) : 0;
        body.innerHTML = `
          <div class="wg-pomo phase-${p.phase}">
            <svg class="wg-pomo-ring" viewBox="0 0 100 100"><circle class="ring-bg" cx="50" cy="50" r="44"/><circle class="ring-fg" cx="50" cy="50" r="44"/></svg>
            <div class="wg-pomo-mid">
              <div class="wg-pomo-phase">${label}</div>
              <div class="wg-pomo-time"></div>
              <div class="wg-pomo-btns">
                <button class="wg-pomo-start" title="Start / pause">▶</button>
                <button class="wg-pomo-skip" title="Skip phase">⏭</button>
                <button class="wg-pomo-reset" title="Reset">↺</button>
              </div>
            </div>
            <div class="wg-pomo-foot">🍅 ${doneToday} today · round ${(p.round % 4) + 1}/4</div>
          </div>`;
        const stop = (e2) => e2 && e2.addEventListener('pointerdown', (e) => e.stopPropagation());
        const s = body.querySelector('.wg-pomo-start'), sk = body.querySelector('.wg-pomo-skip'), rs = body.querySelector('.wg-pomo-reset');
        stop(s); stop(sk); stop(rs);
        s.onclick = (e) => { e.stopPropagation(); if (p.left <= 0) p.left = this.total(w, p); p.running = !p.running; this.paint(body, w); };
        sk.onclick = (e) => { e.stopPropagation(); this.complete(body, w, true); };
        rs.onclick = (e) => { e.stopPropagation(); w._pomo = { phase: 'work', left: (w.config.work || 25) * 60, running: false, round: 0 }; this.render(body, w); };
        this.paint(body, w);
      },
      paint(body, w) {
        const p = w._pomo; if (!p) return;
        const timeEl = body.querySelector('.wg-pomo-time'); if (!timeEl) return;
        timeEl.textContent = `${String(Math.floor(p.left / 60)).padStart(2, '0')}:${String(p.left % 60).padStart(2, '0')}`;
        const s = body.querySelector('.wg-pomo-start'); if (s) s.textContent = p.running ? '⏸' : '▶';
        const total = this.total(w, p);
        const ring = body.querySelector('.ring-fg');
        if (ring) { const C = 2 * Math.PI * 44; ring.style.strokeDasharray = C; ring.style.strokeDashoffset = C * (1 - (total ? p.left / total : 0)); }
      },
      tick(body, w) {
        const p = w._pomo; if (!p || !p.running) { return; }
        if (p.left > 0) { p.left--; if (p.left === 0) { this.complete(body, w, false); return; } }
        this.paint(body, w);
      },
      complete(body, w, skipped) {
        const p = w._pomo;
        beep(p.phase === 'work' ? 660 : 880);
        if (p.phase === 'work') {
          if (!skipped) {
            const today = new Date().toDateString();
            if (w.config.date !== today) { w.config.date = today; w.config.done = 0; }
            w.config.done = (w.config.done || 0) + 1;
            wapi.put(w.id, { config: w.config });
          }
          p.round++;
          if (p.round % 4 === 0) { p.phase = 'long'; if (!skipped) tgPing('🍅 Four focus sessions done — take a long break!'); }
          else { p.phase = 'brk'; if (!skipped) tgPing('🎯 Focus session complete — time for a break.'); }
        } else {
          p.phase = 'work'; if (!skipped) tgPing('☕ Break over — back to focus.');
        }
        p.left = this.total(w, p);
        this.render(body, w);
      },
    },

    /* ---------- memory trainer (digit span) ---------- */
    memory: {
      label: 'Memory Trainer',
      defaults: { w: 280, h: 220, config: { best: 0 } },
      render(body, w) {
        const m = w._mem || (w._mem = { state: 'idle', len: 3, seq: [] });
        if (m.timer) { clearTimeout(m.timer); m.timer = null; }
        const best = w.config.best || 0;
        let mid = '';
        if (m.state === 'idle') mid = `<div class="wg-mem-hint">Watch the number, then type it back.</div><button class="wg-btn wg-mem-start">▶ Start</button>`;
        else if (m.state === 'show') mid = `<div class="wg-mem-seq">${m.seq.join(' ')}</div>`;
        else if (m.state === 'input') mid = `<input class="wg-mem-input" inputmode="numeric" autocomplete="off" placeholder="type the number" /><button class="wg-btn wg-mem-go">Check</button>`;
        else if (m.state === 'good') mid = `<div class="wg-mem-msg ok">✓ Correct!</div>`;
        else if (m.state === 'over') mid = `<div class="wg-mem-msg bad">✗ It was ${m.seq.join(' ')}</div><button class="wg-btn wg-mem-start">↻ Try again</button>`;
        body.innerHTML = `
          <div class="wg-mem">
            <div class="wg-mem-head"><span>🧩 Memory</span><span>length ${m.len} · best ${best}</span></div>
            <div class="wg-mem-mid">${mid}</div>
          </div>`;
        const stop = (e2) => e2 && e2.addEventListener('pointerdown', (e) => e.stopPropagation());
        const startBtn = body.querySelector('.wg-mem-start');
        if (startBtn) { stop(startBtn); startBtn.onclick = (e) => { e.stopPropagation(); this.begin(body, w); }; }
        const inp = body.querySelector('.wg-mem-input');
        const goBtn = body.querySelector('.wg-mem-go');
        if (inp) { stop(inp); inp.focus(); inp.onkeydown = (e) => { if (e.key === 'Enter') this.check(body, w, inp.value); }; }
        if (goBtn) { stop(goBtn); goBtn.onclick = (e) => { e.stopPropagation(); this.check(body, w, inp.value); }; }
        if (m.state === 'show') {
          m.timer = setTimeout(() => { if (!body.isConnected) return; m.state = 'input'; this.render(body, w); }, 700 * m.len + 600);
        } else if (m.state === 'good') {
          m.timer = setTimeout(() => { if (!body.isConnected) return; this.next(body, w); }, 800);
        }
      },
      begin(body, w) { w._mem.len = 3; this.next(body, w); },
      next(body, w) {
        const m = w._mem;
        m.seq = Array.from({ length: m.len }, () => Math.floor(Math.random() * 10));
        m.state = 'show';
        this.render(body, w);
      },
      check(body, w, val) {
        const m = w._mem;
        if ((val || '').replace(/\D/g, '') === m.seq.join('')) {
          w.config.best = Math.max(w.config.best || 0, m.len);
          wapi.put(w.id, { config: w.config });
          m.len++;
          m.state = 'good';
        } else {
          m.state = 'over';
        }
        this.render(body, w);
      },
    },

    /* ---------- habit streaks ---------- */
    habits: {
      label: 'Habits',
      defaults: { w: 300, h: 250, config: { items: [] } },
      render(body, w) {
        const today = ymd(new Date());
        body.dataset.d = new Date().toDateString();
        const items = w.config.items || (w.config.items = []);
        body.innerHTML = `
          <div class="wg-hab">
            <div class="wg-hab-head"><span>🔥 Habits</span>${EDITABLE ? '<button class="wg-hab-add" title="Add habit">＋</button>' : ''}</div>
            <form class="wg-hab-form" hidden><input class="wg-hab-name" placeholder="New habit…" maxlength="40" /><button class="wg-btn" type="submit">Add</button></form>
            <div class="wg-hab-list">${items.length ? '' : '<span class="muted small">No habits yet — hit ＋ to add one.</span>'}</div>
          </div>`;
        const list = body.querySelector('.wg-hab-list');
        const stop = (e2) => e2 && e2.addEventListener('pointerdown', (e) => e.stopPropagation());
        items.forEach((it) => {
          const done = it.lastDone === today;
          const row = document.createElement('div');
          row.className = 'wg-hab-row';
          row.innerHTML = `<input type="checkbox" ${done ? 'checked' : ''}/><span class="wg-hab-name-txt ${done ? 'done' : ''}">${escw(it.name)}</span><span class="wg-hab-streak">${it.streak ? '🔥 ' + it.streak : ''}</span>${EDITABLE ? '<button class="wg-hab-del" title="Remove">✕</button>' : ''}`;
          const cb = row.querySelector('input'); stop(cb);
          cb.onclick = (e) => { e.stopPropagation(); this.toggle(w, it); this.render(body, w); };
          const del = row.querySelector('.wg-hab-del');
          if (del) { stop(del); del.onclick = (e) => { e.stopPropagation(); w.config.items = items.filter((x) => x !== it); wapi.put(w.id, { config: w.config }); this.render(body, w); }; }
          list.appendChild(row);
        });
        const addBtn = body.querySelector('.wg-hab-add');
        const form = body.querySelector('.wg-hab-form');
        if (addBtn && form) {
          stop(addBtn); stop(form.querySelector('input'));
          addBtn.onclick = (e) => { e.stopPropagation(); form.hidden = !form.hidden; if (!form.hidden) form.querySelector('input').focus(); };
          form.onsubmit = (e) => {
            e.preventDefault();
            const name = form.querySelector('input').value.trim();
            if (!name) return;
            items.push({ id: Math.random().toString(36).slice(2, 8), name, lastDone: null, streak: 0, prevDone: null, prevStreak: 0 });
            wapi.put(w.id, { config: w.config });
            form.querySelector('input').value = '';
            form.hidden = true;
            this.render(body, w);
          };
        }
      },
      toggle(w, it) {
        const today = ymd(new Date());
        if (it.lastDone === today) {
          it.lastDone = it.prevDone ?? null;
          it.streak = it.prevStreak ?? 0;
        } else {
          const y = new Date(); y.setDate(y.getDate() - 1);
          it.prevDone = it.lastDone ?? null;
          it.prevStreak = it.streak || 0;
          it.streak = (it.lastDone === ymd(y)) ? (it.streak || 0) + 1 : 1;
          it.lastDone = today;
        }
        wapi.put(w.id, { config: w.config });
      },
      tick(body, w) {
        if (body.dataset.d && body.dataset.d !== new Date().toDateString()) this.render(body, w);
      },
    },

    /* ---------- hydration (drink water) ---------- */
    water: {
      label: 'Hydration',
      defaults: { w: 260, h: 200, config: { cups: 0, goal: 8, date: null, lastDrink: null, lastReminded: null, startHour: 7, endHour: 23 } },
      render(body, w) {
        const today = new Date().toDateString();
        if (w.config.date !== today) { w.config.date = today; w.config.cups = 0; w.config.lastDrink = null; w.config.lastReminded = null; }
        body.dataset.d = today;
        const cups = w.config.cups || 0, goal = w.config.goal || 8;
        let icons = '';
        for (let i = 0; i < goal; i++) icons += `<span class="wg-water-cup ${i < cups ? 'full' : ''}"></span>`;
        body.innerHTML = `
          <div class="wg-water">
            <div class="wg-water-head"><span>💧 Hydration</span><span>${cups}/${goal}</span></div>
            <div class="wg-water-cups">${icons}</div>
            <button class="wg-btn wg-water-add">＋ Drank a cup</button>
            <div class="wg-water-sub">${cups >= goal ? '🎉 Goal reached — nice!' : 'Nudges 7am–11pm every 2h idle'}</div>
          </div>`;
        const stop = (e2) => e2 && e2.addEventListener('pointerdown', (e) => e.stopPropagation());
        const add = () => {
          const t2 = new Date().toDateString();
          if (w.config.date !== t2) { w.config.date = t2; w.config.cups = 0; }
          w.config.cups = (w.config.cups || 0) + 1;
          w.config.lastDrink = new Date().toISOString();
          w.config.lastReminded = null;
          wapi.put(w.id, { config: w.config });
          this.render(body, w);
        };
        const btn = body.querySelector('.wg-water-add'); stop(btn); btn.onclick = (e) => { e.stopPropagation(); add(); };
        const cupsEl = body.querySelector('.wg-water-cups'); stop(cupsEl); cupsEl.onclick = (e) => { e.stopPropagation(); add(); };
      },
      tick(body, w) {
        if (body.dataset.d && body.dataset.d !== new Date().toDateString()) this.render(body, w);
      },
      configUI(wrap, w, save) {
        wrap.innerHTML = `<span class="edit-label">Daily goal (cups)</span>
          <div class="cfg-row"><input id="wgGoal" type="number" min="1" max="20" value="${w.config.goal || 8}" class="note-title-input" style="margin:0;width:100px"/></div>`;
        el('wgGoal').onchange = (e) => { w.config.goal = Math.max(1, Math.min(20, +e.target.value || 8)); save(); };
      },
    },

    /* ---------- knowledge quizzes ---------- */
    quizProg: quizType('prog', 'Programming', '💻'),
    quizCompEng: quizType('compeng', 'Computer Eng', '🔌'),
    quizMath: quizType('math', 'Mathematics', '➗'),
    quizEE: quizType('ee', 'Electrical Eng', '⚡'),
    quizCS: quizType('cs', 'Computer Science', '🖥️'),

    /* ---------- countdown ---------- */
    countdown: {
      label: 'Countdown',
      defaults: { w: 260, h: 180, config: { label: 'New Year', target: null } },
      render(body, w) {
        body.innerHTML = `
          <div class="wg-cd">
            <div class="wg-cd-label">${escw(w.config.label || 'Countdown')}</div>
            <div class="wg-cd-main"></div>
            <div class="wg-cd-sub"></div>
          </div>`;
        this.tick(body, w);
      },
      targetTime(w) {
        if (w.config.target) return new Date(w.config.target).getTime();
        return new Date(new Date().getFullYear() + 1, 0, 1).getTime();
      },
      tick(body, w) {
        const main = body.querySelector('.wg-cd-main'); if (!main) return;
        const sub = body.querySelector('.wg-cd-sub');
        const diff = this.targetTime(w) - Date.now();
        if (diff <= 0) { main.innerHTML = '<span class="wg-cd-days">🎉</span>'; if (sub) sub.textContent = 'The day is here!'; return; }
        const d = Math.floor(diff / 864e5), h = Math.floor((diff % 864e5) / 36e5), m = Math.floor((diff % 36e5) / 6e4), s = Math.floor((diff % 6e4) / 1e3);
        main.innerHTML = `<span class="wg-cd-days">${d}</span><span class="wg-cd-dl">days</span>`;
        if (sub) sub.textContent = `${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
      },
      configUI(wrap, w, save) {
        const cur = w.config.target ? new Date(w.config.target) : null;
        const pad = (v) => String(v).padStart(2, '0');
        const val = cur ? `${cur.getFullYear()}-${pad(cur.getMonth() + 1)}-${pad(cur.getDate())}T${pad(cur.getHours())}:${pad(cur.getMinutes())}` : '';
        wrap.innerHTML = `<span class="edit-label">Event name</span>
          <div class="cfg-row"><input id="cdLabel" class="note-title-input" style="margin:0" value="${escw(w.config.label || '')}"/></div>
          <span class="edit-label">Target date &amp; time</span>
          <div class="cfg-row"><input id="cdDate" type="datetime-local" class="reminder-input" value="${val}"/></div>`;
        el('cdLabel').onchange = (e) => { w.config.label = e.target.value.trim() || 'Countdown'; save(); };
        el('cdDate').onchange = (e) => { w.config.target = e.target.value ? new Date(e.target.value).toISOString() : null; save(); };
      },
    },

    /* ---------- breathing coach ---------- */
    breathing: {
      label: 'Breathing',
      defaults: { w: 240, h: 240, config: {} },
      render(body, w) {
        if (!w._br) w._br = { running: false, sec: 0 };
        body.innerHTML = `
          <div class="wg-br">
            <div class="wg-br-circle"><span class="wg-br-count"></span></div>
            <div class="wg-br-phase">Box breathing · 4-4-4-4</div>
            <button class="wg-btn wg-br-toggle">▶ Start</button>
          </div>`;
        const btn = body.querySelector('.wg-br-toggle');
        btn.addEventListener('pointerdown', (e) => e.stopPropagation());
        btn.onclick = (e) => { e.stopPropagation(); w._br.running = !w._br.running; w._br.sec = 0; this.paint(body, w, true); };
        this.paint(body, w, true);
      },
      paint(body, w, boundary) {
        const br = w._br; const circle = body.querySelector('.wg-br-circle'); if (!circle) return;
        const phases = ['Inhale', 'Hold', 'Exhale', 'Hold'];
        const phase = Math.floor((br.sec % 16) / 4);
        const countEl = body.querySelector('.wg-br-count'), phaseEl = body.querySelector('.wg-br-phase'), btn = body.querySelector('.wg-br-toggle');
        if (btn) btn.textContent = br.running ? '⏸ Pause' : '▶ Start';
        if (!br.running) { circle.style.transform = 'scale(0.7)'; if (countEl) countEl.textContent = ''; if (phaseEl) phaseEl.textContent = 'Box breathing · 4-4-4-4'; return; }
        if (phaseEl) phaseEl.textContent = phases[phase];
        if (countEl) countEl.textContent = 4 - (br.sec % 4);
        if (boundary || br.sec % 4 === 0) {
          if (phase === 0) circle.style.transform = 'scale(1)';
          else if (phase === 2) circle.style.transform = 'scale(0.6)';
        }
      },
      tick(body, w) {
        const br = w._br; if (!br || !br.running) return;
        br.sec++;
        this.paint(body, w, false);
      },
    },

    /* ---------- quote of the day ---------- */
    quote: {
      label: 'Quote',
      defaults: { w: 320, h: 180, config: { pick: null, day: null } },
      render(body, w) {
        const today = new Date().toDateString();
        body.dataset.d = today;
        let idx = (w.config.pick != null && w.config.day === today) ? w.config.pick : dayIndex(QUOTES.length);
        idx = ((idx % QUOTES.length) + QUOTES.length) % QUOTES.length;
        const q = QUOTES[idx];
        body.innerHTML = `
          <div class="wg-quote">
            <div class="wg-quote-t">&ldquo;${escw(q.t)}&rdquo;</div>
            <div class="wg-quote-a">— ${escw(q.a)}</div>
            <button class="wg-btn wg-quote-new">↻ New</button>
          </div>`;
        const b = body.querySelector('.wg-quote-new');
        b.addEventListener('pointerdown', (e) => e.stopPropagation());
        b.onclick = (e) => {
          e.stopPropagation();
          let n; do { n = Math.floor(Math.random() * QUOTES.length); } while (n === idx && QUOTES.length > 1);
          w.config.pick = n; w.config.day = today;
          wapi.put(w.id, { config: w.config });
          this.render(body, w);
        };
      },
      tick(body, w) {
        if (body.dataset.d && body.dataset.d !== new Date().toDateString()) this.render(body, w);
      },
    },

    /* ---------- dice & coin ---------- */
    dice: {
      label: 'Dice & Coin',
      defaults: { w: 240, h: 200, config: {} },
      render(body, w) {
        if (!w._d) w._d = { result: '🎲', label: 'Tap a button' };
        body.innerHTML = `
          <div class="wg-dice">
            <div class="wg-dice-result">${escw(w._d.result)}</div>
            <div class="wg-dice-label">${escw(w._d.label)}</div>
            <div class="wg-dice-btns">
              <button class="wg-btn" data-roll="6">🎲 d6</button>
              <button class="wg-btn" data-roll="20">🎲 d20</button>
              <button class="wg-btn" data-coin="1">🪙 Coin</button>
            </div>
          </div>`;
        body.querySelectorAll('.wg-dice-btns button').forEach((b) => {
          b.addEventListener('pointerdown', (e) => e.stopPropagation());
          b.onclick = (e) => {
            e.stopPropagation();
            if (b.dataset.roll) { const n = +b.dataset.roll; w._d = { result: '' + (1 + Math.floor(Math.random() * n)), label: 'd' + n }; }
            else { w._d = { result: Math.random() < 0.5 ? 'Heads' : 'Tails', label: 'Coin flip' }; }
            const res = body.querySelector('.wg-dice-result');
            res.textContent = w._d.result;
            res.classList.remove('pop'); void res.offsetWidth; res.classList.add('pop');
            body.querySelector('.wg-dice-label').textContent = w._d.label;
          };
        });
      },
    },

    /* ---------- base converter (dec / hex / bin / oct) ---------- */
    baseconv: {
      label: 'Base Converter',
      defaults: { w: 280, h: 200, config: {} },
      render(body, w) {
        body.innerHTML = `
          <div class="wg-base">
            <div class="wg-base-head">🔢 Base Converter</div>
            <input class="wg-base-in" inputmode="numeric" autocomplete="off" placeholder="decimal number" value="${w.config.last != null ? escw('' + w.config.last) : ''}"/>
            <div class="wg-base-out">
              <div><span>HEX</span><b class="wg-base-hex">—</b></div>
              <div><span>BIN</span><b class="wg-base-bin">—</b></div>
              <div><span>OCT</span><b class="wg-base-oct">—</b></div>
            </div>
          </div>`;
        const inp = body.querySelector('.wg-base-in');
        inp.addEventListener('pointerdown', (e) => e.stopPropagation());
        const compute = () => {
          const raw = inp.value.trim();
          const n = parseInt(raw, 10);
          const hex = body.querySelector('.wg-base-hex'), bin = body.querySelector('.wg-base-bin'), oct = body.querySelector('.wg-base-oct');
          if (raw === '' || Number.isNaN(n)) { hex.textContent = bin.textContent = oct.textContent = '—'; return; }
          hex.textContent = '0x' + Math.abs(n).toString(16).toUpperCase();
          bin.textContent = '0b' + Math.abs(n).toString(2);
          oct.textContent = '0o' + Math.abs(n).toString(8);
        };
        inp.oninput = compute;
        inp.onchange = () => { const n = parseInt(inp.value, 10); if (!Number.isNaN(n)) { w.config.last = n; wapi.put(w.id, { config: w.config }); } };
        compute();
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

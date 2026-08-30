'use strict';

/* ============================== Tauri bridge ============================== */
const invoke = (...a) => window.__TAURI__.core.invoke(...a);
const tauriWindow = () => window.__TAURI__.window.getCurrentWindow();
const dialogApi = () => window.__TAURI__.dialog;

/* ============================== Small helpers ============================== */
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmt(d) {
  if (!d) return '—';
  const p = d.split('-');
  return `${p[2]} ${MON[+p[1] - 1]} '${p[0].slice(2)}`;
}
function shift(d, n) {
  const t = new Date(d + 'T00:00:00Z');
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function startOfMonth(d) { return d.slice(0, 7) + '-01'; }
function inr(n) { return (n || 0).toLocaleString('en-IN'); }
function nowTimeStr() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function errText(e) {
  if (typeof e === 'string') return e;
  if (e && e.message) return e.message;
  try { return JSON.stringify(e); } catch { return 'Something went wrong.'; }
}

const PALETTE = [
  { dot: 'oklch(0.60 0.15 285)', bg: 'oklch(0.95 0.035 285)', fg: 'oklch(0.42 0.15 285)' },
  { dot: 'oklch(0.62 0.13 60)', bg: 'oklch(0.95 0.045 70)', fg: 'oklch(0.44 0.11 60)' },
  { dot: 'oklch(0.62 0.12 195)', bg: 'oklch(0.95 0.035 195)', fg: 'oklch(0.42 0.1 200)' },
  { dot: 'oklch(0.60 0.15 15)', bg: 'oklch(0.95 0.035 15)', fg: 'oklch(0.44 0.15 15)' },
  { dot: 'oklch(0.58 0.12 150)', bg: 'oklch(0.94 0.04 155)', fg: 'oklch(0.4 0.1 155)' },
  { dot: 'oklch(0.60 0.14 230)', bg: 'oklch(0.95 0.035 230)', fg: 'oklch(0.42 0.14 230)' },
  { dot: 'oklch(0.60 0.15 340)', bg: 'oklch(0.95 0.035 340)', fg: 'oklch(0.44 0.15 340)' },
  { dot: 'oklch(0.68 0.14 95)', bg: 'oklch(0.95 0.04 95)', fg: 'oklch(0.46 0.12 90)' },
  { dot: 'oklch(0.55 0.16 265)', bg: 'oklch(0.95 0.035 265)', fg: 'oklch(0.4 0.15 265)' },
  { dot: 'oklch(0.55 0.02 270)', bg: 'oklch(0.95 0.01 270)', fg: 'oklch(0.4 0.02 270)' },
];
function paletteFor(idx) { return PALETTE[((idx % PALETTE.length) + PALETTE.length) % PALETTE.length]; }

const NAV = [
  { key: 'stock', label: 'Stock on hand', hi: 'स्टॉक में कितना', glyph: '▤', accent: 'oklch(0.60 0.15 285)' },
  { key: 'moves', label: 'Movements', hi: 'आवाजाही', glyph: '⇅', accent: 'oklch(0.62 0.13 60)', badge: 'movements' },
  { key: 'items', label: 'Item master', hi: 'आइटम सूची', glyph: '☰', accent: 'oklch(0.62 0.12 195)', badge: 'items' },
  { key: 'out', label: 'Record out', hi: 'बाहर गया', glyph: '↗', accent: 'oklch(0.63 0.16 40)' },
  { key: 'in', label: 'Record in', hi: 'वापस आया', glyph: '↙', accent: 'oklch(0.58 0.12 163)' },
];
const UNIT_SUGGESTIONS = ['pcs', 'sq ft', 'nos', 'ft', 'kg', 'bundle', 'set'];
function defaultUnitForCategory(categoryId) {
  const c = catById(categoryId);
  return c && c.name === 'Fiber Sheet' ? 'sq ft' : 'pcs';
}
function availableFor(itemId) {
  const it = itemById(itemId);
  if (!it) return 0;
  const { out } = computeOutLast();
  return it.ownedQty - (out[itemId] || 0);
}

/* ============================== DOM builder ============================== */
function h(tag, props, children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'className') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  }
  if (children != null) {
    const arr = Array.isArray(children) ? children.flat(Infinity) : [children];
    for (const c of arr) {
      if (c == null || c === false) continue;
      el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    }
  }
  return el;
}
const hiSpan = (text) => h('span', { className: 'hi' }, text);

/* ============================== State ============================== */
const state = {
  loading: true,
  loadError: '',
  categories: [],
  items: [],
  movements: [],
  dbPath: '',

  screen: 'stock',
  layout: 'cards',
  entry: 'quick',

  cat: 'All',
  range: 'month',
  from: startOfMonth(todayStr()),
  to: todayStr(),
  mtype: 'All',
  itemFilter: 'All',

  draftDate: todayStr(),
  draftLines: [{ itemId: null, qty: '' }],
  quickItem: null,
  quickQty: '',
  savedAt: null,

  modal: null,
  toasts: [],
  busy: false,
  busyAction: null, // which backup/restore action is in flight, for button loading labels
  localBackupOpen: false,

  update: null, // the Tauri Update object once one is found
  updateStatus: 'idle', // idle | downloading | error
  google: { configured: false, connected: false, email: null },
};

function busyLabel(action, loadingText, idleContent) {
  return state.busyAction === action ? [h('span', { className: 'btn-spinner' }), loadingText] : idleContent;
}

let toastSeq = 1;
function pushToast(kind, text) {
  const id = toastSeq++;
  state.toasts.push({ id, kind, text });
  render();
  setTimeout(() => {
    state.toasts = state.toasts.filter((t) => t.id !== id);
    render();
  }, 4500);
}

/* ============================== Data loading ============================== */
async function loadAll() {
  try {
    const data = await invoke('get_all_data');
    state.categories = data.categories;
    state.items = data.items;
    state.movements = data.movements;
    state.dbPath = data.dbPath;
    const firstActive = state.items.find((i) => !i.archived);
    if (firstActive) {
      if (state.quickItem == null || !state.items.some((i) => i.id === state.quickItem)) {
        state.quickItem = firstActive.id;
      }
      if (!state.draftLines.length || state.draftLines[0].itemId == null) {
        state.draftLines = [{ itemId: firstActive.id, qty: '' }];
      }
    }
    state.loading = false;
    state.loadError = '';
  } catch (e) {
    state.loading = false;
    state.loadError = errText(e);
  }
  render();
}

/* ============================== Focus-preserving render ============================== */
function render() {
  const root = document.getElementById('app');
  const active = document.activeElement;
  let savedId = null, selStart = null, selEnd = null;
  if (active && root.contains(active) && active.id) {
    savedId = active.id;
    if (typeof active.selectionStart === 'number') {
      selStart = active.selectionStart;
      selEnd = active.selectionEnd;
    }
  }

  root.innerHTML = '';
  root.appendChild(buildTitlebar());
  const bodyRow = h('div', { className: 'body-row' }, [buildSidebar(), buildMain()]);
  root.appendChild(bodyRow);
  if (state.modal) root.appendChild(buildModal());
  root.appendChild(buildToastStack());

  if (savedId) {
    const el = document.getElementById(savedId);
    if (el) {
      el.focus({ preventScroll: true });
      if (selStart != null && typeof el.setSelectionRange === 'function') {
        try { el.setSelectionRange(selStart, selEnd); } catch { /* not a text-range input */ }
      }
    }
  }
}

/* ============================== Titlebar ============================== */
function buildTitlebar() {
  const dragArea = (extra) => h('div', Object.assign({ 'data-tauri-drag-region': true }, extra || {}));

  const brand = dragArea({ style: { display: 'flex', alignItems: 'center', gap: '10px' } });
  brand.appendChild(h('div', { className: 'titlebar-dots' }, [h('span'), h('span'), h('span')]));
  brand.appendChild(h('div', { className: 'titlebar-title' }, 'GODOWN — Shuttering Stock Register'));
  brand.appendChild(h('div', { className: 'titlebar-sub' }, 'OFFLINE · THIS PC ONLY'));

  const controls = h('div', { className: 'titlebar-controls' }, [
    h('button', { title: 'Minimize', onClick: () => tauriWindow().minimize() }, '—'),
    h('button', { title: 'Maximize / Restore', onClick: () => tauriWindow().toggleMaximize() }, '◻'),
    h('button', { className: 'close-btn', title: 'Close', onClick: () => tauriWindow().close() }, '✕'),
  ]);

  return h('div', { className: 'titlebar' }, [
    brand,
    dragArea({ className: 'titlebar-drag' }),
    controls,
  ]);
}

/* ============================== Sidebar ============================== */
function buildSidebar() {
  const nav = h('div');
  NAV.forEach((n) => {
    const on = state.screen === n.key;
    const badgeVal = n.badge === 'movements' ? state.movements.length : n.badge === 'items' ? state.items.filter((i) => !i.archived).length : '';
    const glyph = h('div', { className: 'nav-glyph' }, n.glyph);
    if (on) glyph.style.background = n.accent;
    if (on) glyph.style.color = '#fff';
    nav.appendChild(
      h('button', { className: 'nav-item' + (on ? ' active' : ''), onClick: () => setScreen(n.key) }, [
        glyph,
        h('div', { className: 'nav-text' }, [
          h('div', { className: 'nav-label' }, n.label),
          h('div', { className: 'nav-hi hi' }, n.hi),
        ]),
        h('div', { className: 'nav-badge' }, String(badgeVal)),
      ])
    );
  });

  const localBackupSection = state.google.configured
    ? h('div', { style: { marginTop: '9px' } }, [
        h('button', {
          className: 'accordion-toggle',
          onClick: () => { state.localBackupOpen = !state.localBackupOpen; render(); },
        }, [h('span', {}, 'Local backup'), h('span', { className: 'accordion-caret' }, state.localBackupOpen ? '▾' : '▸')]),
        state.localBackupOpen ? h('div', { className: 'sidebar-tools', style: { marginTop: '7px' } }, [
          h('button', { className: 'sidebar-tool-btn', onClick: doBackup, disabled: state.busy }, busyLabel('backup', 'Backing up…', 'Backup ⭳')),
          h('button', { className: 'sidebar-tool-btn', onClick: doRestore, disabled: state.busy }, busyLabel('restore', 'Restoring…', 'Restore ⭱')),
        ]) : null,
      ])
    : h('div', { className: 'sidebar-tools', style: { marginTop: '9px' } }, [
        h('button', { className: 'sidebar-tool-btn', onClick: doBackup, disabled: state.busy }, busyLabel('backup', 'Backing up…', 'Backup ⭳')),
        h('button', { className: 'sidebar-tool-btn', onClick: doRestore, disabled: state.busy }, busyLabel('restore', 'Restoring…', 'Restore ⭱')),
      ]);

  const footer = h('div', { className: 'sidebar-footer' }, [
    h('div', { className: 'today' }, fmt(todayStr())),
    h('div', {}, `Saved ${state.savedAt || '—'}`),
    state.google.configured ? buildGoogleDriveTools() : null,
    localBackupSection,
    h('button', { className: 'sidebar-tool-btn danger', style: { width: '100%', marginTop: '9px' }, onClick: doResetAllData, disabled: state.busy }, busyLabel('reset', 'Resetting…', 'Reset all data ⟲')),
  ]);

  return h('div', { className: 'sidebar' }, [
    h('div', { className: 'sidebar-label' }, ['REGISTER · ', hiSpan('रजिस्टर')]),
    nav,
    h('div', { className: 'sidebar-spacer' }),
    footer,
  ]);
}

function buildGoogleDriveTools() {
  if (!state.google.connected) {
    return h('div', { style: { marginTop: '9px' } }, [
      h('button', { className: 'sidebar-tool-btn', style: { width: '100%' }, onClick: doGoogleConnect, disabled: state.busy }, busyLabel('googleConnect', 'Connecting…', 'Connect Google Drive ☁')),
    ]);
  }
  return h('div', { style: { marginTop: '9px' } }, [
    h('div', { style: { fontSize: '10.5px', color: '#8d83ac', marginBottom: '6px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, `☁ ${state.google.email || 'Connected'}`),
    h('div', { className: 'sidebar-tools' }, [
      h('button', { className: 'sidebar-tool-btn', onClick: doGoogleBackup, disabled: state.busy }, busyLabel('googleBackup', 'Uploading…', 'Backup ☁')),
      h('button', { className: 'sidebar-tool-btn', onClick: openGoogleRestoreModal, disabled: state.busy }, 'Restore ☁'),
    ]),
    h('button', { className: 'sidebar-tool-btn', style: { width: '100%', marginTop: '6px', opacity: 0.75 }, onClick: doGoogleDisconnect }, 'Disconnect'),
  ]);
}

function setScreen(key) {
  if ((key === 'out' || key === 'in') && state.screen !== key) state.entry = 'quick';
  state.screen = key;
  render();
}

/* ============================== Main / header ============================== */
function buildMain() {
  const main = h('div', { className: 'main' });
  main.appendChild(buildHeader());
  const banner = buildUpdateBanner();
  if (banner) main.appendChild(banner);
  main.appendChild(buildContent());
  main.appendChild(buildStatusbar());
  return main;
}

function buildUpdateBanner() {
  if (!state.update) return null;
  const downloading = state.updateStatus === 'downloading';
  return h('div', { className: 'update-banner' }, [
    h('div', {}, [
      h('span', { style: { fontWeight: 600 } }, `Update available: v${state.update.version}`),
      h('span', { style: { color: 'var(--muted)', marginLeft: '8px' } }, `(you have v${state.update.currentVersion})`),
    ]),
    h('div', { className: 'spacer' }),
    h('button', { className: 'btn-primary sm', style: { background: 'var(--acc)' }, onClick: installUpdate, disabled: downloading }, downloading ? 'Downloading…' : 'Install & restart'),
  ]);
}

function buildHeader() {
  const activeItems = state.items.filter((i) => !i.archived);
  const titles = {
    stock: ['Stock on hand', 'What is in the godown right now.', 'गोदाम में क्या है'],
    moves: ['Movement register', 'Every out and in, by date.', 'तारीख के अनुसार'],
    items: ['Item master', `${activeItems.length} items in ${state.categories.length} categories.`, 'आइटम और श्रेणी'],
    out: ['Record material going out', 'Enter the date it actually left.', 'बाहर गया माल'],
    in: ['Record material coming in', 'Enter the date it actually came back.', 'वापस आया माल'],
  }[state.screen];

  const titleBlock = h('div', { className: 'main-title-block' }, [
    h('div', { className: 'main-title' }, titles[0]),
    h('div', { className: 'main-subtitle' }, [titles[1] + ' ', hiSpan(titles[2])]),
  ]);

  const parts = [titleBlock, h('div', { className: 'spacer' })];

  if (state.screen === 'stock') {
    const seg = h('div', { className: 'seg' }, [
      h('button', { className: state.layout === 'cards' ? 'on' : '', onClick: () => { state.layout = 'cards'; render(); } }, 'Table + totals'),
      h('button', { className: state.layout === 'board' ? 'on' : '', onClick: () => { state.layout = 'board'; render(); } }, 'Category board'),
    ]);
    parts.push(h('div', { className: 'layout-toggle-wrap' }, [h('div', { className: 'layout-toggle-label' }, 'LAYOUT'), seg]));
  }

  parts.push(
    h('div', { className: 'header-actions' }, [
      h('button', { className: 'btn-out', onClick: () => setScreen('out') }, 'Out ↗'),
      h('button', { className: 'btn-in', onClick: () => setScreen('in') }, 'In ↙'),
    ])
  );

  return h('div', { className: 'main-header' }, parts);
}

/* ============================== Content dispatch ============================== */
function buildContent() {
  const wrap = h('div', { className: 'main-content' });
  if (state.loading) {
    wrap.appendChild(h('div', { className: 'empty-row' }, 'Loading the register…'));
    return wrap;
  }
  if (state.loadError) {
    wrap.appendChild(h('div', { className: 'empty-row' }, `Couldn't load the database: ${state.loadError}`));
    return wrap;
  }
  if (state.screen === 'stock' && state.layout === 'cards') wrap.appendChild(buildStockCards());
  else if (state.screen === 'stock' && state.layout === 'board') wrap.appendChild(buildStockBoard());
  else if (state.screen === 'moves') wrap.appendChild(buildMoves());
  else if (state.screen === 'items') wrap.appendChild(buildItemsScreen());
  else if (state.screen === 'out' || state.screen === 'in') wrap.appendChild(buildEntryForm());
  return wrap;
}

/* ============================== Shared computations ============================== */
function computeOutLast() {
  const out = {}, last = {};
  state.movements.forEach((m) => {
    out[m.itemId] = (out[m.itemId] || 0) + (m.type === 'OUT' ? m.qty : -m.qty);
    if (!last[m.itemId] || m.date > last[m.itemId]) last[m.itemId] = m.date;
  });
  return { out, last };
}
function catById(id) { return state.categories.find((c) => c.id === id); }
function itemById(id) { return state.items.find((i) => i.id === id); }

/* ============================== Stock: cards ============================== */
function buildStockCards() {
  const { out, last } = computeOutLast();
  const activeItems = state.items.filter((i) => !i.archived);
  const monthStart = startOfMonth(todayStr());
  const monthMoves = state.movements.filter((m) => m.date >= monthStart);
  const monthOut = monthMoves.filter((m) => m.type === 'OUT').length;
  const monthIn = monthMoves.filter((m) => m.type === 'IN').length;
  const lastEntry = state.movements.length ? state.movements.reduce((a, m) => (m.date > a ? m.date : a), state.movements[0].date) : null;
  const itemsInStock = activeItems.filter((i) => i.ownedQty - (out[i.id] || 0) > 0);
  const categoriesStocked = new Set(itemsInStock.map((i) => i.categoryId)).size;
  const itemsOnRent = Object.keys(out).filter((k) => out[k] > 0).length;

  const statColors = [
    { bg: 'oklch(0.96 0.025 285)', bd: 'oklch(0.90 0.05 285)', dot: 'oklch(0.60 0.15 285)', labelFg: 'oklch(0.45 0.09 285)', valueFg: 'oklch(0.32 0.11 285)' },
    { bg: 'oklch(0.96 0.03 45)', bd: 'oklch(0.90 0.06 45)', dot: 'oklch(0.63 0.16 40)', labelFg: 'oklch(0.47 0.09 40)', valueFg: 'oklch(0.36 0.12 38)' },
    { bg: 'oklch(0.96 0.03 195)', bd: 'oklch(0.90 0.05 195)', dot: 'oklch(0.62 0.12 195)', labelFg: 'oklch(0.44 0.07 200)', valueFg: 'oklch(0.33 0.08 200)' },
    { bg: 'oklch(0.96 0.03 160)', bd: 'oklch(0.90 0.05 160)', dot: 'oklch(0.58 0.12 160)', labelFg: 'oklch(0.43 0.08 160)', valueFg: 'oklch(0.32 0.09 160)' },
  ];
  const statData = [
    { label: 'ITEMS IN STOCK', value: inr(itemsInStock.length), sub: `across ${categoriesStocked} categor${categoriesStocked === 1 ? 'y' : 'ies'}` },
    { label: 'ITEMS ON RENT', value: inr(itemsOnRent), sub: `of ${activeItems.length} items total` },
    { label: 'ENTRIES THIS MONTH', value: inr(monthMoves.length), sub: `${monthOut} out · ${monthIn} in` },
    { label: 'LAST ENTRY', value: lastEntry ? fmt(lastEntry) : '—', sub: `${state.movements.length} entries total` },
  ];

  const statGrid = h('div', { className: 'stat-grid' }, statData.map((d, i) => {
    const c = statColors[i];
    const card = h('div', { className: 'stat-card', style: { background: c.bg, borderColor: c.bd } }, [
      h('div', { className: 'stat-head' }, [h('div', { className: 'stat-dot', style: { background: c.dot } }), h('div', { className: 'stat-label', style: { color: c.labelFg } }, d.label)]),
      h('div', { className: 'stat-value num', style: { color: c.valueFg } }, d.value),
      h('div', { className: 'stat-sub', style: { color: c.labelFg } }, d.sub),
    ]);
    return card;
  }));

  const catChips = h('div', { className: 'chip-row' }, [
    h('div', { className: 'chip' + (state.cat === 'All' ? ' on' : ''), onClick: () => { state.cat = 'All'; render(); } }, [h('div', { className: 'chip-dot', style: { background: '#b3a8c9' } }), 'All']),
    ...state.categories.map((c) => {
      const pal = paletteFor(c.palette);
      return h('div', { className: 'chip' + (state.cat === c.name ? ' on' : ''), onClick: () => { state.cat = c.name; render(); } }, [h('div', { className: 'chip-dot', style: { background: pal.dot } }), c.name]);
    }),
  ]);

  const sectionHead = h('div', { className: 'section-head' }, [
    h('div', { className: 'section-title' }, 'Stock on hand'),
    h('div', { className: 'section-note' }, `${state.cat === 'All' ? 'all categories' : state.cat} · as on ${fmt(todayStr())}`),
    h('div', { className: 'spacer' }),
    catChips,
  ]);

  const rows = activeItems
    .filter((i) => state.cat === 'All' || (catById(i.categoryId) || {}).name === state.cat)
    .map((i) => {
      const c = catById(i.categoryId);
      const pal = paletteFor(c ? c.palette : 0);
      const o = out[i.id] || 0;
      return h('div', { className: 'trow body stock-grid' }, [
        h('div', { className: 'name-cell' }, [h('div', { className: 'row-dot', style: { background: pal.dot } }), h('span', {}, i.name)]),
        h('div', { style: { color: 'var(--muted)', fontSize: '12px' } }, c ? c.name : '—'),
        h('div', { className: 'tright num', style: { color: 'var(--muted-2)' } }, inr(i.ownedQty)),
        h('div', { className: 'tright num', style: { fontWeight: 600 } }, inr(i.ownedQty - o)),
        h('div', { className: 'tright num' }, h('span', { className: 'badge-pill out-pill', style: o > 0 ? { background: 'var(--out-bg)', color: 'var(--out-fg)', fontWeight: 600 } : { color: '#c3b9d6', fontWeight: 400 } }, o > 0 ? inr(o) : '—')),
        h('div', { className: 'tright num', style: { color: 'var(--muted)', fontSize: '12px' } }, last[i.id] ? fmt(last[i.id]) : '—'),
      ]);
    });

  const table = h('div', { className: 'table-card' }, [
    h('div', { className: 'trow thead stock-grid' }, [
      h('div', {}, ['ITEM · ', hiSpan('आइटम')]),
      h('div', {}, 'CATEGORY'),
      h('div', { className: 'tright' }, 'OWNED'),
      h('div', { className: 'tright' }, 'IN STORE'),
      h('div', { className: 'tright' }, 'ON RENT'),
      h('div', { className: 'tright' }, 'LAST MOVED'),
    ]),
    ...rows,
  ]);
  if (!rows.length) table.appendChild(h('div', { className: 'empty-row' }, 'No items in this category yet.'));

  return h('div', {}, [statGrid, sectionHead, table]);
}

/* ============================== Stock: board ============================== */
function buildStockBoard() {
  const { out } = computeOutLast();
  const activeItems = state.items.filter((i) => !i.archived);
  const head = h('div', { className: 'section-head' }, [
    h('div', { className: 'section-title' }, 'By category'),
    h('div', { className: 'section-note' }, `as on ${fmt(todayStr())}`),
  ]);

  const cards = state.categories.map((c) => {
    const pal = paletteFor(c.palette);
    const rows = activeItems.filter((i) => i.categoryId === c.id);
    const t = rows.reduce((a, i) => a + i.ownedQty, 0);
    const o = rows.reduce((a, i) => a + (out[i.id] || 0), 0);
    const rowNodes = rows.map((i) => {
      const oo = out[i.id] || 0;
      const pct = i.ownedQty > 0 ? Math.round((oo / i.ownedQty) * 100) : 0;
      return h('div', { className: 'board-row' }, [
        h('div', { className: 'board-row-top' }, [
          h('div', { className: 'board-row-name' }, i.name),
          h('div', { className: 'spacer' }),
          h('div', { className: 'board-row-instore num' }, inr(i.ownedQty - oo)),
          h('div', { className: 'board-row-instore-label' }, 'in store'),
        ]),
        h('div', { className: 'board-row-bottom' }, [
          h('div', { className: 'board-bar-track' }, h('div', { className: 'board-bar-fill', style: { width: pct + '%', background: pal.dot } })),
          h('div', { className: 'board-row-note num' }, oo > 0 ? `${inr(oo)} out` : 'all in'),
        ]),
      ]);
    });
    if (!rowNodes.length) rowNodes.push(h('div', { className: 'board-row', style: { color: 'var(--muted-2)', fontSize: '12px' } }, 'No items yet.'));
    return h('div', { className: 'board-card' }, [
      h('div', { className: 'board-head', style: { background: pal.bg, borderColor: pal.bg } }, [
        h('div', { className: 'board-head-title', style: { color: pal.fg } }, c.name),
        h('div', { className: 'spacer' }),
        h('div', { className: 'board-head-summary num', style: { color: pal.fg } }, `${inr(t - o)} in store · ${inr(o)} out`),
      ]),
      h('div', { className: 'board-rows' }, rowNodes),
    ]);
  });

  return h('div', {}, [head, h('div', { className: 'board-grid' }, cards)]);
}

/* ============================== Movements ============================== */
function applyRange(r) {
  const today = todayStr();
  const map = {
    today: [today, today],
    week: [shift(today, -6), today],
    month: [startOfMonth(today), today],
    single: [state.from || today, state.from || today],
    custom: [state.from, state.to],
  };
  state.range = r;
  [state.from, state.to] = map[r];
  render();
}

function buildMoves() {
  const dateChips = [['today', 'Today'], ['week', 'This week'], ['month', 'This month'], ['single', 'One date'], ['custom', 'Custom range']].map(([key, label]) =>
    h('div', { className: 'filter-chip' + (state.range === key ? ' on' : ''), onClick: () => applyRange(key) }, label)
  );

  const singleMode = state.range === 'single' || state.range === 'today';
  const dateInputs = singleMode
    ? h('input', { type: 'date', id: 'moves-single-date', className: 'date-input sm', value: state.from, onChange: (e) => { state.from = e.target.value; state.to = e.target.value; state.range = 'single'; render(); } })
    : h('div', { className: 'range-row' }, [
        h('input', { type: 'date', id: 'moves-from-date', className: 'date-input sm', value: state.from, onChange: (e) => { state.from = e.target.value; state.range = 'custom'; render(); } }),
        h('div', { className: 'to-label' }, 'to'),
        h('input', { type: 'date', id: 'moves-to-date', className: 'date-input sm', value: state.to, onChange: (e) => { state.to = e.target.value; state.range = 'custom'; render(); } }),
      ]);

  const typeChips = ['All', 'OUT', 'IN'].map((t) =>
    h('div', { className: 'filter-chip' + (state.mtype === t ? ' on' : ''), onClick: () => { state.mtype = t; render(); } }, t === 'All' ? 'Both' : t === 'OUT' ? 'Only out' : 'Only in')
  );

  const filterBar = h('div', { className: 'filter-bar' }, [
    h('div', { className: 'filter-label' }, ['WHEN · ', hiSpan('कब')]),
    ...dateChips,
    h('div', { className: 'vsep' }),
    dateInputs,
    h('div', { className: 'spacer' }),
    ...typeChips,
  ]);

  const filtered = state.movements
    .filter((m) => m.date >= state.from && m.date <= state.to)
    .filter((m) => state.mtype === 'All' || m.type === state.mtype)
    .filter((m) => state.itemFilter === 'All' || String(m.itemId) === String(state.itemFilter));

  const totOut = filtered.filter((m) => m.type === 'OUT').reduce((a, m) => a + m.qty, 0);
  const totIn = filtered.filter((m) => m.type === 'IN').reduce((a, m) => a + m.qty, 0);

  const itemFilterSelect = h(
    'select',
    { id: 'item-filter-select', className: 'select-input', value: state.itemFilter, onChange: (e) => { state.itemFilter = e.target.value; render(); } },
    [h('option', { value: 'All' }, 'All items'), ...state.items.map((i) => h('option', { value: String(i.id) }, i.name))]
  );
  itemFilterSelect.value = state.itemFilter;

  const totalsRow = h('div', { className: 'totals-row' }, [
    h('div', { className: 'section-title' }, state.from === state.to ? fmt(state.from) : `${fmt(state.from)} → ${fmt(state.to)}`),
    h('div', { className: 'total-out num' }, `${inr(totOut)} out`),
    h('div', { className: 'total-in num' }, `${inr(totIn)} in`),
    h('div', { className: 'section-note' }, `${filtered.length} entries`),
    h('div', { className: 'spacer' }),
    itemFilterSelect,
  ]);

  let prevDate = null;
  const rows = filtered.map((m) => {
    const first = m.date !== prevDate;
    prevDate = m.date;
    const it = itemById(m.itemId);
    const c = it ? catById(it.categoryId) : null;
    const pal = paletteFor(c ? c.palette : 0);
    const isOut = m.type === 'OUT';
    return h('div', { className: 'trow body moves-grid', style: { background: first ? '#fcfaff' : '#fff', borderBottomColor: first ? '#ece5f7' : 'var(--border-softer)' } }, [
      h('div', { className: 'num', style: { fontWeight: 600 } }, first ? fmt(m.date) : ''),
      h('div', {}, h('span', { className: 'badge-pill', style: { fontSize: '10.5px', letterSpacing: '0.05em', background: isOut ? 'var(--out-bg)' : 'var(--in-bg)', color: isOut ? 'var(--out-fg)' : 'var(--in-fg)' } }, isOut ? 'OUT ↗' : 'IN ↙')),
      h('div', { className: 'name-cell' }, [h('div', { className: 'row-dot', style: { height: '18px', background: pal.dot } }), h('span', {}, it ? it.name : '(deleted item)')]),
      h('div', { style: { color: 'var(--muted)', fontSize: '12px' } }, c ? c.name : '—'),
      h('div', { className: 'tright num', style: { fontWeight: 600 } }, `${inr(m.qty)}${it ? ' ' + it.unit : ''}`),
      h('button', { className: 'icon-btn danger', title: 'Delete this entry', onClick: () => deleteMovement(m.id) }, '✕'),
    ]);
  });

  const table = h('div', { className: 'table-card' }, [
    h('div', { className: 'trow thead moves-grid' }, [
      h('div', {}, ['DATE · ', hiSpan('दिनांक')]),
      h('div', {}, 'MOVE'),
      h('div', {}, 'ITEM'),
      h('div', {}, 'CATEGORY'),
      h('div', { className: 'tright' }, ['QTY · ', hiSpan('मात्रा')]),
      h('div', {}, ''),
    ]),
    ...rows,
  ]);
  if (!rows.length) table.appendChild(h('div', { className: 'empty-row' }, 'Nothing recorded in this date range.'));

  return h('div', {}, [filterBar, totalsRow, table]);
}

async function deleteMovement(id) {
  const ok = await confirmDialog('Delete this entry? This can\'t be undone.');
  if (!ok) return;
  await runOrToast(() => invoke('delete_movement', { id }), 'Entry deleted.');
}

/* ============================== Items master ============================== */
function buildItemsScreen() {
  const head = h('div', { className: 'section-head' }, [
    h('div', { className: 'section-title' }, 'All items'),
    h('div', { className: 'section-note' }, 'quantities owned are the godown total, not current availability'),
    h('div', { className: 'spacer' }),
    h('div', { className: 'chip add', onClick: () => openItemModal(null) }, '+ New item'),
  ]);

  const catRow = h('div', { className: 'section-head' }, [
    h('div', { className: 'section-title', style: { fontSize: '12px' } }, 'Categories'),
    h('div', { className: 'chip-row' }, [
      ...state.categories.map((c) => {
        const pal = paletteFor(c.palette);
        return h('div', { className: 'chip', onClick: () => openCategoryModal(c) }, [h('div', { className: 'chip-dot', style: { background: pal.dot } }), c.name]);
      }),
      h('div', { className: 'chip add', onClick: () => openCategoryModal(null) }, '+ New category'),
    ]),
  ]);

  const rows = state.items.map((i) => {
    const c = catById(i.categoryId);
    const pal = paletteFor(c ? c.palette : 0);
    return h('div', { className: 'trow body items-grid', style: i.archived ? { opacity: 0.5 } : null }, [
      h('div', { className: 'name-cell' }, [h('div', { className: 'row-dot', style: { background: pal.dot } }), h('span', {}, i.name + (i.archived ? ' (archived)' : ''))]),
      h('div', {}, h('span', { className: 'badge-pill', style: { background: pal.bg, color: pal.fg } }, c ? c.name : '—')),
      h('div', { style: { color: 'var(--muted)', fontSize: '12px' } }, i.unit),
      h('div', { className: 'tright num', style: { fontWeight: 600 } }, inr(i.ownedQty)),
      h('div', { className: 'row-actions' }, [h('button', { className: 'icon-btn', title: 'Edit item', onClick: () => openItemModal(i) }, '✎')]),
    ]);
  });

  const table = h('div', { className: 'table-card' }, [
    h('div', { className: 'trow thead items-grid' }, [
      h('div', {}, ['ITEM NAME · ', hiSpan('नाम')]),
      h('div', {}, ['CATEGORY · ', hiSpan('श्रेणी')]),
      h('div', {}, 'UNIT'),
      h('div', { className: 'tright' }, 'OWNED'),
      h('div', {}, ''),
    ]),
    ...rows,
  ]);
  if (!rows.length) table.appendChild(h('div', { className: 'empty-row' }, 'No items yet — add your first one above.'));

  return h('div', {}, [head, catRow, table]);
}

/* ============================== Out / In entry ============================== */
function buildEntryForm() {
  const type = state.screen === 'out' ? 'OUT' : 'IN';
  const activeItems = state.items.filter((i) => !i.archived);
  const avail = availableFor;
  const accent = type === 'OUT' ? 'var(--out-accent)' : 'var(--in-accent)';
  const tint = type === 'OUT' ? 'var(--out-tint)' : 'var(--in-tint)';

  const entryModeRow = h('div', { className: 'entry-mode-row' }, [
    h('div', { className: 'entry-mode-label' }, 'ENTRY MODE'),
    h('div', { className: 'seg' }, [
      h('button', { className: state.entry === 'quick' ? 'on' : '', onClick: () => { state.entry = 'quick'; render(); } }, 'Quick single'),
      h('button', { className: state.entry === 'bulk' ? 'on' : '', onClick: () => { state.entry = 'bulk'; render(); } }, 'Full lot'),
    ]),
    h('div', { className: 'entry-hint' }, state.entry === 'quick' ? 'one item at a time, rapid fire' : 'many items on one date'),
  ]);

  const quickDates = [['Today', todayStr()], ['Yesterday', shift(todayStr(), -1)], [fmt(shift(todayStr(), -2)), shift(todayStr(), -2)]];
  const dateChipRow = (onPick) =>
    h('div', { className: 'date-chip-row' }, quickDates.map(([label, val]) =>
      h('div', { className: 'filter-chip' + (state.draftDate === val ? ' on' : ''), onClick: () => onPick(val) }, label)
    ));

  let formNode;
  if (!activeItems.length) {
    formNode = h('div', { className: 'form-card' }, [
      h('div', { className: 'form-accent', style: { background: accent } }),
      h('div', { className: 'form-body', style: { textAlign: 'center', padding: '40px 20px' } }, [
        h('div', { style: { fontFamily: "'Work Sans', sans-serif", fontWeight: 600, fontSize: '15px', marginBottom: '6px' } }, 'No items yet'),
        h('div', { className: 'section-note', style: { marginBottom: '16px' } }, 'Add at least one item in Item master before recording an out or in entry.'),
        h('button', { className: 'btn-primary', style: { background: 'var(--acc)' }, onClick: () => setScreen('items') }, 'Go to Item master'),
      ]),
    ]);
  } else if (state.entry === 'quick') {
    const itemSelect = h('select', { id: 'quick-item-select', className: 'full-select', value: String(state.quickItem || ''), onChange: (e) => { state.quickItem = Number(e.target.value); render(); } },
      activeItems.map((i) => h('option', { value: String(i.id) }, `${i.name} (${(catById(i.categoryId) || {}).name || ''})`)));
    itemSelect.value = String(state.quickItem || '');

    formNode = h('div', { className: 'form-card' }, [
      h('div', { className: 'form-accent', style: { background: accent } }),
      h('div', { className: 'form-body' }, [
        h('div', { className: 'quick-grid' }, [
          h('div', {}, [h('div', { className: 'field-label' }, ['ITEM · ', hiSpan('आइटम')]), itemSelect]),
          h('div', {}, [
            h('div', { className: 'field-label' }, type === 'OUT' ? 'QTY OUT' : 'QTY IN'),
            h('input', { id: 'quick-qty-input', type: 'number', min: '0', className: 'quick-qty-input', style: { background: tint }, value: state.quickQty, onInput: (e) => { state.quickQty = e.target.value; renderQuickSummary(); }, onKeydown: (e) => { if (e.key === 'Enter') saveQuick(type); } }),
          ]),
          h('div', {}, [
            h('div', { className: 'field-label' }, 'AVAILABLE'),
            h('div', { id: 'quick-avail-value', className: 'quick-avail-value' }, `${inr(avail(state.quickItem))} in store`),
          ]),
        ]),
        h('div', { className: 'date-row' }, [
          h('div', { className: 'field-label tight' }, type === 'OUT' ? ['DATE WENT OUT · ', hiSpan('दिनांक')] : ['DATE CAME IN · ', hiSpan('दिनांक')]),
          h('div', { className: 'date-chip-row' }, [
            h('input', { id: 'quick-date-input', type: 'date', className: 'date-input', value: state.draftDate, onChange: (e) => { state.draftDate = e.target.value; render(); } }),
            ...quickDates.map(([label, val]) => h('div', { className: 'filter-chip' + (state.draftDate === val ? ' on' : ''), onClick: () => { state.draftDate = val; render(); } }, label)),
          ]),
        ]),
        h('div', { className: 'form-footer' }, [
          h('div', { id: 'quick-summary', className: 'form-summary num' }, quickSummaryText(type, avail)),
          h('div', { className: 'spacer' }),
          h('button', { id: 'quick-save-btn', className: 'btn-primary', style: { background: accent }, onClick: () => saveQuick(type), disabled: type === 'OUT' && Number(state.quickQty) > avail(state.quickItem) }, [type === 'OUT' ? 'Save out entry ' : 'Save in entry ', h('span', { style: { opacity: 0.75, fontWeight: 500 } }, '↵')]),
        ]),
      ]),
    ]);
  } else {
    const rows = state.draftLines.map((line, ix) => {
      const it = itemById(line.itemId);
      const a = avail(line.itemId);
      const over = type === 'OUT' && Number(line.qty) > a;
      const select = h('select', { id: `bulk-item-${ix}`, value: String(line.itemId || ''), onChange: (e) => { state.draftLines[ix].itemId = Number(e.target.value); render(); } },
        activeItems.map((i) => h('option', { value: String(i.id) }, i.name)));
      select.value = String(line.itemId || '');
      return h('div', { className: 'bulk-line' }, [
        select,
        h('input', { id: `bulk-qty-${ix}`, type: 'number', min: '0', style: { borderColor: over ? 'var(--danger)' : 'var(--border)', background: tint }, value: line.qty, onInput: (e) => { state.draftLines[ix].qty = e.target.value; renderBulkSummary(); patchBulkAvail(ix, type); } }),
        h('div', { id: `bulk-avail-${ix}`, className: 'bulk-avail', style: { color: over ? 'var(--danger-2)' : 'var(--muted)' } }, `${inr(a)} in store`),
        h('button', { className: 'bulk-remove', title: 'Remove row', onClick: () => { if (state.draftLines.length > 1) state.draftLines.splice(ix, 1); render(); } }, '✕'),
      ]);
    });

    formNode = h('div', { className: 'form-card' }, [
      h('div', { className: 'form-accent', style: { background: accent } }),
      h('div', { className: 'form-body' }, [
        h('div', { style: { marginBottom: '17px' } }, [
          h('div', { className: 'field-label tight' }, type === 'OUT' ? ['DATE WENT OUT · ', hiSpan('दिनांक')] : ['DATE CAME IN · ', hiSpan('दिनांक')]),
          h('div', { className: 'bulk-date-row' }, [
            h('input', { id: 'bulk-date-input', type: 'date', className: 'date-input', value: state.draftDate, onChange: (e) => { state.draftDate = e.target.value; render(); } }),
            ...quickDates.map(([label, val]) => h('div', { className: 'filter-chip' + (state.draftDate === val ? ' on' : ''), onClick: () => { state.draftDate = val; render(); } }, label)),
            h('div', { className: 'spacer' }),
            h('div', { className: 'bulk-date-note' }, 'One date for the whole lot'),
          ]),
        ]),
        h('div', { className: 'bulk-head-row' }, [h('div', {}, 'ITEM'), h('div', { className: 'tright' }, type === 'OUT' ? 'QTY OUT' : 'QTY IN'), h('div', { className: 'tright' }, 'AVAILABLE'), h('div', {})]),
        ...rows,
        h('button', { className: 'add-line-btn', onClick: () => { state.draftLines.push({ itemId: activeItems[0] ? activeItems[0].id : null, qty: '' }); render(); } }, '+ Add item row'),
        h('div', { className: 'form-footer' }, [
          h('div', { id: 'bulk-summary', className: 'form-summary num' }, bulkSummaryText()),
          h('div', { className: 'spacer' }),
          h('button', { className: 'btn-secondary', onClick: () => setScreen('stock') }, 'Cancel'),
          h('button', { id: 'bulk-save-btn', className: 'btn-primary sm', style: { background: accent }, onClick: () => saveBulk(type), disabled: type === 'OUT' && state.draftLines.some((l) => Number(l.qty) > avail(l.itemId)) }, type === 'OUT' ? 'Save out entry' : 'Save in entry'),
        ]),
      ]),
    ]);
  }

  const hint = h('div', { className: 'below-hint' }, state.entry === 'quick'
    ? 'Saves and clears for the next entry. The date stays put, so a whole day\'s slips go in one after another.'
    : 'Back-dating is fine — record the day the material actually moved, not the day you typed it.');

  const recent = state.movements.slice(0, 6).map((m) => {
    const it = itemById(m.itemId);
    const isOut = m.type === 'OUT';
    return h('div', { className: 'recent-row' }, [
      h('div', { className: 'recent-tag', style: { background: isOut ? 'var(--out-bg)' : 'var(--in-bg)', color: isOut ? 'var(--out-fg)' : 'var(--in-fg)' } }, isOut ? 'OUT' : 'IN'),
      h('div', { className: 'recent-item' }, it ? it.name : '(deleted item)'),
      h('div', { className: 'recent-qty num' }, inr(m.qty)),
      h('div', { className: 'recent-date num' }, fmt(m.date)),
    ]);
  });
  const recentPanel = h('div', { className: 'recent-panel' }, [
    h('div', { className: 'recent-title' }, 'JUST ENTERED'),
    h('div', { className: 'recent-title-hi' }, 'अभी दर्ज किया'),
    ...(recent.length ? recent : [h('div', { className: 'recent-empty' }, 'Nothing yet today.')]),
  ]);

  const entryMain = h('div', { className: 'entry-main' }, [entryModeRow, formNode, hint]);
  return h('div', { className: 'entry-layout' }, [entryMain, recentPanel]);
}

function quickSummaryText(type, avail) {
  const it = itemById(state.quickItem);
  return `${inr(+state.quickQty || 0)} ${it ? it.unit : ''} · ${fmt(state.draftDate)} · ${inr(avail(state.quickItem))} in store now`;
}
function renderQuickSummary() {
  const type = state.screen === 'out' ? 'OUT' : 'IN';
  const el = document.getElementById('quick-summary');
  if (el) el.textContent = quickSummaryText(type, availableFor);
  const btn = document.getElementById('quick-save-btn');
  if (btn) btn.disabled = type === 'OUT' && Number(state.quickQty) > availableFor(state.quickItem);
}
function bulkSummaryText() {
  const total = state.draftLines.reduce((a, d) => a + (+d.qty || 0), 0);
  return `${state.draftLines.length} rows · ${inr(total)} pieces · ${fmt(state.draftDate)}`;
}
function renderBulkSummary() {
  const el = document.getElementById('bulk-summary');
  if (el) el.textContent = bulkSummaryText();
}
function patchBulkAvail(ix, type) {
  const line = state.draftLines[ix];
  const a = availableFor(line.itemId);
  const over = type === 'OUT' && Number(line.qty) > a;
  const availEl = document.getElementById(`bulk-avail-${ix}`);
  if (availEl) {
    availEl.textContent = `${inr(a)} in store`;
    availEl.style.color = over ? 'var(--danger-2)' : 'var(--muted)';
  }
  const qtyEl = document.getElementById(`bulk-qty-${ix}`);
  if (qtyEl) qtyEl.style.borderColor = over ? 'var(--danger)' : 'var(--border)';

  const btn = document.getElementById('bulk-save-btn');
  if (btn) btn.disabled = type === 'OUT' && state.draftLines.some((l) => Number(l.qty) > availableFor(l.itemId));
}

async function saveQuick(type) {
  const qty = Number(state.quickQty);
  if (!state.quickItem || !Number.isFinite(qty) || qty <= 0) {
    pushToast('error', 'Enter a quantity greater than zero.');
    return;
  }
  if (type === 'OUT' && qty > availableFor(state.quickItem)) {
    const it = itemById(state.quickItem);
    pushToast('error', `Only ${inr(availableFor(state.quickItem))} ${it ? it.unit : ''} of "${it ? it.name : 'this item'}" available — can't issue more than that.`);
    return;
  }
  const ok = await runOrToast(
    () => invoke('add_movements', { kind: type, date: state.draftDate, lines: [{ itemId: state.quickItem, qty }] }),
    null
  );
  if (ok) {
    state.quickQty = '';
    state.savedAt = 'just now';
    pushToast('success', `${type === 'OUT' ? 'Out' : 'In'} entry saved.`);
  }
}
async function saveBulk(type) {
  const lines = state.draftLines.filter((l) => Number(l.qty) > 0 && l.itemId != null).map((l) => ({ itemId: l.itemId, qty: Number(l.qty) }));
  if (!lines.length) {
    pushToast('error', 'Enter at least one item with a quantity greater than zero.');
    return;
  }
  if (type === 'OUT') {
    for (const l of lines) {
      const a = availableFor(l.itemId);
      if (l.qty > a) {
        const it = itemById(l.itemId);
        pushToast('error', `Only ${inr(a)} ${it ? it.unit : ''} of "${it ? it.name : 'this item'}" available — reduce that row's quantity.`);
        return;
      }
    }
  }
  const ok = await runOrToast(() => invoke('add_movements', { kind: type, date: state.draftDate, lines }), null);
  if (ok) {
    const firstItem = state.items.find((i) => !i.archived);
    state.draftLines = [{ itemId: firstItem ? firstItem.id : null, qty: '' }];
    state.savedAt = 'just now';
    pushToast('success', `${type === 'OUT' ? 'Out' : 'In'} entry saved.`);
  }
}

/* ============================== Status bar ============================== */
function buildStatusbar() {
  return h('div', { className: 'statusbar' }, [
    h('div', {}, `${state.movements.length} entries · saved to this PC, no internet needed`),
    h('div', { className: 'spacer' }),
    h('div', {}, `Godown 1 · ${fmt(todayStr())}`),
  ]);
}

/* ============================== Mutations / async plumbing ============================== */
async function runOrToast(fn, successMsg) {
  state.busy = true;
  try {
    await fn();
    await loadAll();
    if (successMsg) pushToast('success', successMsg);
    state.busy = false;
    return true;
  } catch (e) {
    state.busy = false;
    pushToast('error', errText(e));
    return false;
  }
}
async function confirmDialog(message) {
  try {
    return await dialogApi().confirm(message, { title: 'Godown Stock Register', kind: 'warning' });
  } catch {
    return window.confirm(message);
  }
}

/* ============================== Item modal ============================== */
function openItemModal(item) {
  const categoryId = item ? item.categoryId : (state.categories[0] && state.categories[0].id) || null;
  state.modal = {
    kind: 'item',
    id: item ? item.id : null,
    name: item ? item.name : '',
    categoryId,
    unit: item ? item.unit : defaultUnitForCategory(categoryId),
    unitTouched: !!item,
    ownedQty: item ? String(item.ownedQty) : '0',
    archived: item ? item.archived : false,
    error: '',
  };
  render();
}
async function saveItemModal() {
  const m = state.modal;
  const name = m.name.trim();
  const ownedQty = parseInt(m.ownedQty, 10);
  if (!name) { m.error = 'Enter an item name.'; render(); return; }
  if (!m.categoryId) { m.error = 'Choose a category.'; render(); return; }
  if (!Number.isFinite(ownedQty) || ownedQty < 0) { m.error = 'Enter a valid owned quantity (0 or more).'; render(); return; }
  const unit = (m.unit || '').trim() || 'nos';
  try {
    if (m.id) await invoke('update_item', { id: m.id, name, categoryId: m.categoryId, unit, ownedQty });
    else await invoke('create_item', { name, categoryId: m.categoryId, unit, ownedQty });
    state.modal = null;
    await loadAll();
    pushToast('success', m.id ? 'Item updated.' : 'Item added.');
  } catch (e) {
    m.error = errText(e);
    render();
  }
}
async function toggleArchiveItem() {
  const m = state.modal;
  try {
    await invoke('set_item_archived', { id: m.id, archived: !m.archived });
    state.modal = null;
    await loadAll();
    pushToast('success', m.archived ? 'Item unarchived.' : 'Item archived.');
  } catch (e) {
    m.error = errText(e);
    render();
  }
}
async function deleteItemFromModal() {
  const m = state.modal;
  const ok = await confirmDialog(`Delete "${m.name}"? This can't be undone.`);
  if (!ok) return;
  try {
    await invoke('delete_item', { id: m.id });
    state.modal = null;
    await loadAll();
    pushToast('success', 'Item deleted.');
  } catch (e) {
    m.error = errText(e);
    render();
  }
}

/* ============================== Category modal ============================== */
function openCategoryModal(cat) {
  state.modal = {
    kind: 'category',
    id: cat ? cat.id : null,
    name: cat ? cat.name : '',
    palette: cat ? cat.palette : state.categories.length % PALETTE.length,
    error: '',
  };
  render();
}
async function saveCategoryModal() {
  const m = state.modal;
  const name = m.name.trim();
  if (!name) { m.error = 'Enter a category name.'; render(); return; }
  try {
    if (m.id) await invoke('update_category', { id: m.id, name, palette: m.palette });
    else await invoke('create_category', { name, palette: m.palette });
    state.modal = null;
    await loadAll();
    pushToast('success', m.id ? 'Category updated.' : 'Category added.');
  } catch (e) {
    m.error = errText(e);
    render();
  }
}
async function deleteCategoryFromModal() {
  const m = state.modal;
  const ok = await confirmDialog(`Delete "${m.name}"? This can't be undone.`);
  if (!ok) return;
  try {
    await invoke('delete_category', { id: m.id });
    state.modal = null;
    await loadAll();
    pushToast('success', 'Category deleted.');
  } catch (e) {
    m.error = errText(e);
    render();
  }
}

/* ============================== Modal builder ============================== */
function buildModal() {
  const m = state.modal;
  const overlay = h('div', { className: 'modal-overlay', onClick: (e) => { if (e.target === overlay) { state.modal = null; render(); } } });

  if (m.kind === 'drive-restore') {
    let body;
    if (m.loading) {
      body = h('div', { className: 'section-note' }, 'Loading backups from Google Drive…');
    } else if (m.error) {
      body = h('div', { className: 'modal-error' }, m.error);
    } else if (!m.entries.length) {
      body = h('div', { className: 'section-note' }, 'No backups found in Google Drive yet.');
    } else {
      body = h('div', {}, m.entries.map((e) => h('div', { className: 'recent-row', style: { cursor: 'pointer' }, onClick: () => doGoogleRestore(e.id, e.name) }, [
        h('div', { style: { minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, e.name),
        h('div', { className: 'recent-date' }, e.createdTime ? e.createdTime.slice(0, 10) : ''),
      ])));
    }
    const card = h('div', { className: 'modal-card' }, [
      h('div', { className: 'modal-title' }, 'Restore from Google Drive'),
      body,
      h('div', { className: 'modal-footer' }, [h('button', { className: 'btn-secondary', onClick: () => { state.modal = null; render(); } }, 'Cancel')]),
    ]);
    overlay.appendChild(card);
    return overlay;
  }

  if (m.kind === 'item') {
    const card = h('div', { className: 'modal-card' }, [
      h('div', { className: 'modal-title' }, m.id ? 'Edit item' : 'New item'),
      m.error ? h('div', { className: 'modal-error' }, m.error) : null,
      h('div', { className: 'modal-field' }, [h('label', {}, 'Item name'), h('input', { id: 'modal-item-name', value: m.name, onInput: (e) => { m.name = e.target.value; } })]),
      h('div', { className: 'modal-field' }, [
        h('label', {}, 'Category'),
        (() => {
          const sel = h('select', { id: 'modal-item-cat', onChange: (e) => {
            m.categoryId = Number(e.target.value);
            if (!m.id && !m.unitTouched) { m.unit = defaultUnitForCategory(m.categoryId); render(); }
          } }, state.categories.map((c) => h('option', { value: String(c.id) }, c.name)));
          sel.value = String(m.categoryId || '');
          return sel;
        })(),
      ]),
      h('div', { className: 'modal-field' }, [
        h('label', {}, 'Unit'),
        h('input', { id: 'modal-item-unit', value: m.unit, list: 'unit-suggestions', onInput: (e) => { m.unit = e.target.value; m.unitTouched = true; } }),
        h('datalist', { id: 'unit-suggestions' }, UNIT_SUGGESTIONS.map((u) => h('option', { value: u }))),
      ]),
      h('div', { className: 'modal-field' }, [h('label', {}, 'Owned quantity (godown total)'), h('input', { id: 'modal-item-qty', type: 'number', min: '0', value: m.ownedQty, onInput: (e) => { m.ownedQty = e.target.value; } })]),
      h('div', { className: 'modal-footer' }, [
        m.id ? h('button', { className: 'link-danger modal-footer-left', onClick: toggleArchiveItem }, m.archived ? 'Unarchive' : 'Archive') : null,
        m.id ? h('button', { className: 'link-danger', onClick: deleteItemFromModal }, 'Delete') : null,
        h('button', { className: 'btn-secondary', onClick: () => { state.modal = null; render(); } }, 'Cancel'),
        h('button', { className: 'btn-primary sm', style: { background: 'var(--acc)' }, onClick: saveItemModal }, m.id ? 'Save changes' : 'Add item'),
      ]),
    ]);
    overlay.appendChild(card);
    return overlay;
  }

  // category modal
  const swatches = h('div', { className: 'swatch-row' }, PALETTE.map((p, idx) =>
    h('div', { className: 'swatch' + (m.palette === idx ? ' on' : ''), style: { background: p.dot }, onClick: () => { m.palette = idx; render(); } })
  ));
  const card = h('div', { className: 'modal-card' }, [
    h('div', { className: 'modal-title' }, m.id ? 'Edit category' : 'New category'),
    m.error ? h('div', { className: 'modal-error' }, m.error) : null,
    h('div', { className: 'modal-field' }, [h('label', {}, 'Category name'), h('input', { id: 'modal-cat-name', value: m.name, onInput: (e) => { m.name = e.target.value; } })]),
    h('div', { className: 'modal-field' }, [h('label', {}, 'Color'), swatches]),
    h('div', { className: 'modal-footer' }, [
      m.id ? h('button', { className: 'link-danger modal-footer-left', onClick: deleteCategoryFromModal }, 'Delete') : null,
      h('button', { className: 'btn-secondary', onClick: () => { state.modal = null; render(); } }, 'Cancel'),
      h('button', { className: 'btn-primary sm', style: { background: 'var(--acc)' }, onClick: saveCategoryModal }, m.id ? 'Save changes' : 'Add category'),
    ]),
  ]);
  overlay.appendChild(card);
  return overlay;
}

/* ============================== Toasts ============================== */
function buildToastStack() {
  return h('div', { className: 'toast-stack' }, state.toasts.map((t) =>
    h('div', { className: 'toast ' + t.kind }, [h('div', {}, t.text), h('button', { className: 'toast-close', onClick: () => { state.toasts = state.toasts.filter((x) => x.id !== t.id); render(); } }, '✕')])
  ));
}

/* ============================== Backup / restore ============================== */
async function doBackup() {
  if (state.busy) return;
  try {
    const path = await dialogApi().save({
      defaultPath: `godown-backup-${todayStr()}.db`,
      filters: [{ name: 'Godown Stock Register backup', extensions: ['db'] }],
    });
    if (!path) return;
    state.busy = true; state.busyAction = 'backup'; render();
    await invoke('backup_database', { destPath: path });
    state.busy = false; state.busyAction = null;
    pushToast('success', 'Backup saved.');
  } catch (e) {
    state.busy = false; state.busyAction = null;
    pushToast('error', errText(e));
  }
}
async function doRestore() {
  if (state.busy) return;
  const ok = await confirmDialog('Restoring will replace everything currently in this register with the chosen backup file. This can\'t be undone. Continue?');
  if (!ok) return;
  try {
    const path = await dialogApi().open({
      multiple: false,
      filters: [{ name: 'Godown Stock Register backup', extensions: ['db'] }],
    });
    if (!path) return;
    state.busy = true; state.busyAction = 'restore'; render();
    const data = await invoke('restore_database', { srcPath: path });
    state.categories = data.categories;
    state.items = data.items;
    state.movements = data.movements;
    state.dbPath = data.dbPath;
    state.busy = false; state.busyAction = null;
    pushToast('success', 'Backup restored.');
    render();
  } catch (e) {
    state.busy = false; state.busyAction = null;
    pushToast('error', errText(e));
  }
}
async function doResetAllData() {
  if (state.busy) return;
  const ok = await confirmDialog(
    `This deletes every item, category, and movement in this register and can't be undone. Use Backup first if you want to keep a copy of what's here now. Continue?`
  );
  if (!ok) return;
  state.busy = true; state.busyAction = 'reset'; render();
  try {
    const data = await invoke('reset_all_data');
    state.categories = data.categories;
    state.items = data.items;
    state.movements = data.movements;
    state.dbPath = data.dbPath;
    state.screen = 'stock';
    state.cat = 'All';
    state.busy = false; state.busyAction = null;
    pushToast('success', 'All data reset.');
    render();
  } catch (e) {
    state.busy = false; state.busyAction = null;
    pushToast('error', errText(e));
  }
}

/* ============================== Google Drive backup ============================== */
async function loadGoogleStatus() {
  try {
    state.google = await invoke('google_status');
  } catch {
    /* leave defaults — feature just won't show */
  }
  render();
}

async function doGoogleConnect() {
  if (state.busy) return;
  state.busy = true; state.busyAction = 'googleConnect'; render();
  try {
    state.google = await invoke('google_connect');
    pushToast('success', state.google.email ? `Connected as ${state.google.email}.` : 'Connected to Google Drive.');
  } catch (e) {
    pushToast('error', errText(e));
  }
  state.busy = false; state.busyAction = null;
  render();
}

async function doGoogleDisconnect() {
  const ok = await confirmDialog('Disconnect this Google account? You can reconnect any time.');
  if (!ok) return;
  try {
    await invoke('google_disconnect');
    state.google = { configured: state.google.configured, connected: false, email: null };
    pushToast('success', 'Disconnected from Google Drive.');
    render();
  } catch (e) {
    pushToast('error', errText(e));
  }
}

async function doGoogleBackup() {
  if (state.busy) return;
  state.busy = true; state.busyAction = 'googleBackup'; render();
  try {
    await invoke('google_backup');
    pushToast('success', 'Backup uploaded to Google Drive.');
  } catch (e) {
    pushToast('error', errText(e));
  }
  state.busy = false; state.busyAction = null;
  render();
}

async function openGoogleRestoreModal() {
  state.modal = { kind: 'drive-restore', loading: true, entries: [], error: '' };
  render();
  try {
    const entries = await invoke('google_list_backups');
    if (state.modal && state.modal.kind === 'drive-restore') {
      state.modal.loading = false;
      state.modal.entries = entries;
      render();
    }
  } catch (e) {
    if (state.modal && state.modal.kind === 'drive-restore') {
      state.modal.loading = false;
      state.modal.error = errText(e);
      render();
    }
  }
}

async function doGoogleRestore(fileId, name) {
  const ok = await confirmDialog(`Restore "${name}"? This replaces everything currently in this register and can't be undone.`);
  if (!ok) return;
  state.modal = null;
  state.busy = true; render();
  try {
    const data = await invoke('google_restore_backup', { fileId });
    state.categories = data.categories;
    state.items = data.items;
    state.movements = data.movements;
    state.dbPath = data.dbPath;
    pushToast('success', 'Backup restored from Google Drive.');
  } catch (e) {
    pushToast('error', errText(e));
  }
  state.busy = false;
  render();
}

/* ============================== Auto-update ============================== */
async function checkForUpdates() {
  try {
    const update = await window.__TAURI__.updater.check();
    if (update) {
      state.update = update;
      render();
    }
  } catch {
    /* offline or check failed — stay quiet, this is a background check */
  }
}

async function installUpdate() {
  if (!state.update || state.updateStatus === 'downloading') return;
  state.updateStatus = 'downloading';
  render();
  try {
    await state.update.downloadAndInstall();
    await window.__TAURI__.process.relaunch();
  } catch (e) {
    state.updateStatus = 'error';
    pushToast('error', 'Update failed: ' + errText(e));
    render();
  }
}

/* ============================== Boot ============================== */
render();
loadAll();
loadGoogleStatus();
checkForUpdates();

// The app is typically left open all day, so don't rely on a relaunch to
// surface new versions: re-check periodically and whenever the window
// regains focus (skip re-checking once an update is already showing).
const UPDATE_CHECK_INTERVAL_MS = 2 * 60 * 60 * 1000;
setInterval(() => {
  if (!state.update) checkForUpdates();
}, UPDATE_CHECK_INTERVAL_MS);
window.addEventListener('focus', () => {
  if (!state.update) checkForUpdates();
});

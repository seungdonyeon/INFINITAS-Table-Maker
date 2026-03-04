const html2canvas = window.html2canvas;
const createClient = window.supabase?.createClient;
const SUPABASE_URL = 'https://abmnggpjcliherdzuyqw.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_x5O5BK3XcyJ2yuHt2WDQKQ_Y2GvhK82';
const OAUTH_REDIRECT_URL = 'http://localhost:54321/auth/callback';

const LAMP_ORDER = { NP: 0, F: 1, EASY: 2, NORMAL: 3, HC: 4, EX: 5, FC: 6 };
const CLEAR_SORT_ORDER = { FC: 8, EXHARD: 7, HARD: 6, NORMAL: 5, EASY: 4, ASSIST: 3, FAILED: 2, NOPLAY: 1 };
const SCORE_GRAPH_ORDER = ['NOPLAY', 'B', 'A', 'AA', 'AAA', 'MAX-', 'MAX'];
const SCORE_SUMMARY_ORDER = ['MAX', 'MAX-', 'AAA', 'AA', 'A', 'B', 'NOPLAY'];
const TYPE_TO_PREFIX = { H: 'SPH', A: 'SPA', L: 'SPL' };
const GOAL_RANK_ORDER = { A: 1, AA: 2, AAA: 3, 'MAX-': 4, MAX: 5 };
const MEDAL_SRC = {
  SP10: { ALL: '../assets/image/SP10ALL.png', HARD: '../assets/image/SP10HARD.png', EX: '../assets/image/SP10EX.png', F: '../assets/image/SP10F.png' },
  SP11: { ALL: '../assets/image/SP11ALL.png', HARD: '../assets/image/SP11HARD.png', EX: '../assets/image/SP11EX.png', F: '../assets/image/SP11F.png' },
  SP12: { ALL: '../assets/image/SP12ALL.png', HARD: '../assets/image/SP12HARD.png', EX: '../assets/image/SP12EX.png', F: '../assets/image/SP12F.png' }
};
const EXPORT_CANVAS_WIDTH = 1400;
const MAX_ACCOUNTS = 5;
const DEFAULT_ICON_SRC = '../assets/icon/infinitas.png';
const SOCIAL_SHARE_SCOPE_VALUES = ['all', 'graphs', 'goals', 'history', 'none'];
const FOLLOW_LIMIT = 8;
const RIVAL_LIMIT = 4;
const RADAR_ORDER = ['NOTES', 'PEAK', 'SCRATCH', 'SOFLAN', 'CHARGE', 'CHORD'];
const DEFAULT_SOCIAL_SETTINGS = Object.freeze({
  discoverability: 'searchable',
  followPolicy: 'manual',
  shareDataScope: ['graphs', 'goals', 'history'],
  rivalPolicy: 'followers'
});

const state = {
  activeTable: 'SP11H',
  rankTables: {},
  tableViews: {},
  sortMode: 'name',
  viewMode: 'normal',
  activePanel: 'rank',
  accounts: [],
  activeAccountId: null,
  refluxExePath: '',
  selectedHistoryId: null,
  historySectionOpen: { clear: false, ramp: false, goal: false, radar: false },
  historySeenIds: new Set(),
  historyAnimateDetail: false,
  refluxRunning: false,
  refluxUpdated: false,
  refluxReadyToConfirm: false,
  refluxPendingContent: '',
  refluxGoalCards: [],
  refluxFocusGoalId: null,
  refluxFocusTimer: null,
  refluxTrackerPrimed: false,
  settings: {
    showUpdateGoalCards: true,
    enableHistoryRollback: true,
    discoverability: DEFAULT_SOCIAL_SETTINGS.discoverability,
    followPolicy: DEFAULT_SOCIAL_SETTINGS.followPolicy,
    shareDataScope: [...DEFAULT_SOCIAL_SETTINGS.shareDataScope],
    rivalPolicy: DEFAULT_SOCIAL_SETTINGS.rivalPolicy
  },
  goalSongQuery: '',
  graphSummary: { clear: { order: [], count: {} }, score: { order: [], count: {} } },
  radarDialogProfile: null
};

let toastTimer = null;
let refluxUnsubs = [];
const enhancedSelects = new Map();
let supabaseClient = null;
let supabaseConfigKey = '';
let supabaseAuthUnsub = null;
let cloudSyncTimer = null;
let cloudSyncRunning = false;
let supabaseKeyWarningShown = false;
let socialSearchTarget = null;
let socialOverviewRows = [];

const $ = (id) => document.getElementById(id);
const authContext = (() => {
  let value = { status: 'signed_out', user: null, session: null, accountId: null };
  const listeners = new Set();
  return {
    get() {
      return value;
    },
    set(next) {
      value = { ...value, ...(next || {}) };
      listeners.forEach((fn) => {
        try {
          fn(value);
        } catch {
          // ignore
        }
      });
    },
    subscribe(fn) {
      listeners.add(fn);
      try {
        fn(value);
      } catch {
        // ignore
      }
      return () => listeners.delete(fn);
    }
  };
})();

function decodeJwtPayload(token) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length < 2) return null;
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4);
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

function isServiceRoleKey(token) {
  const payload = decodeJwtPayload(token);
  return payload?.role === 'service_role';
}

function normalizeShareDataScope(values) {
  const input = Array.isArray(values) ? values : [];
  const picked = [...new Set(
    input
      .map((x) => String(x || '').trim().toLowerCase())
      .filter((x) => SOCIAL_SHARE_SCOPE_VALUES.includes(x))
  )];
  if (picked.includes('all')) return ['all', 'graphs', 'goals', 'history'];
  if (picked.includes('none')) return ['none'];
  const scoped = picked.filter((x) => x !== 'all' && x !== 'none');
  return scoped.length ? scoped : ['graphs', 'goals', 'history'];
}

function hasGoogleLinkedAccount(acc = activeAcc()) {
  return !!acc?.googleAuthUserId;
}


function esc(v) {
  return (v ?? '').toString().replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function normTitle(t) { return (t || '').normalize('NFKC').replace(/[’`]/gu, "'").replace(/\s+/gu, ' ').trim().toLowerCase(); }
function looseTitle(t) { return normTitle(t).replace(/[χΧ]/gu, 'x').replace(/[øØ∅]/gu, 'o').replace(/[^\p{L}\p{N}]/gu, ''); }
function codeAliasTitle(t) {
  const n = normTitle(t);
  if (!n.startsWith('code:')) return '';
  return n.replace(/[0oøØ∅]/gu, 'o');
}
function foldedAsciiTitle(t) {
  return normTitle(t)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ƒ/g, 'f')
    .replace(/[øØ∅]/g, 'o')
    .replace(/[æÆ]/g, 'ae')
    .replace(/[œŒ]/g, 'oe')
    .replace(/ß/g, 'ss')
    .replace(/[†☆★♪・]/g, '')
    .replace(/[^a-z0-9]/g, '');
}
function aliasTitleCandidates(t) {
  const n = normTitle(t);
  return [...new Set([
    n,
    n.replace(/†/g, ''),
    n.replace(/ø/g, 'o'),
    n.replace(/æ/g, 'ae'),
    n.replace(/œ/g, 'oe'),
    n.replace(/[áàäâ]/g, 'a').replace(/[éèëê]/g, 'e').replace(/[íìïî]/g, 'i').replace(/[óòöô]/g, 'o').replace(/[úùüû]/g, 'u'),
    n.replace(/ƒ/g, 'f')
  ].filter(Boolean))];
}
function titleKey(t) {
  const n = normTitle(t);
  const safe = (n || `raw:${(t || '').normalize('NFKC').toLowerCase()}`).replaceAll('|', '¦');
  return safe;
}
function nowIso() { return new Date().toISOString(); }
function fmt(iso) { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; }
function goalTableLabel(v) { return String(v || '').replace(/H$/i, ''); }
function normalizeRankTitle(v) { return String(v || '').replace(/SP\s*\?\s*(\d+)/gi, 'SP ☆$1'); }
function isValidInfinitasId(v) { return /^C-\d{4}-\d{4}-\d{4}$/.test(String(v || '')) && String(v || '') !== 'C-0000-0000-0000'; }

function normalizeRadarData(radar) {
  if (!radar || typeof radar !== 'object') return null;
  const out = {};
  let has = false;
  RADAR_ORDER.forEach((axis) => {
    const v = Number(radar[axis] || 0);
    out[axis] = Number.isFinite(v) ? v : 0;
    if (out[axis] > 0) has = true;
  });
  return has ? out : null;
}

function radarAxisDisplayName(axis) {
  return String(axis || '').toUpperCase() === 'SOFLAN' ? 'SOF-LAN' : String(axis || '').toUpperCase();
}

function dominantRadarAxis(radar) {
  let bestAxis = '';
  let best = -1;
  RADAR_ORDER.forEach((axis) => {
    const v = Number(radar?.[axis] || 0);
    if (v > best) {
      best = v;
      bestAxis = axis;
    }
  });
  return bestAxis;
}

function truncate2(v) {
  const n = Number(v || 0);
  if (!Number.isFinite(n)) return 0;
  return Math.floor(n * 100) / 100;
}

function radarSvgHtml(radar, options = {}) {
  const labels = RADAR_ORDER;
  const angles = [-90, -30, 30, 90, 150, 210];
  const cx = 120;
  const cy = 110;
  const outer = 68;
  const rings = [0.25, 0.5, 0.75, 1];
  const maxValue = 200;
  const dominant = options.dominantAxis || dominantRadarAxis(radar);
  const showDominantStar = options.showDominantStar !== false;
  const colors = {
    NOTES: '#ff63d1',
    CHORD: '#9be24f',
    PEAK: '#ffb14b',
    SCRATCH: '#ff5a5a',
    CHARGE: '#9b6cff',
    SOFLAN: '#63c8ff'
  };
  const point = (scale, angleDeg) => {
    const rad = (angleDeg * Math.PI) / 180;
    return [cx + Math.cos(rad) * outer * scale, cy + Math.sin(rad) * outer * scale];
  };
  const ringPolys = rings
    .map((scale) => {
      const pts = angles
        .map((a) => point(scale, a))
        .map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`)
        .join(' ');
      return `<polygon points="${pts}" />`;
    })
    .join('');
  const axisLines = angles
    .map((a) => {
      const [x, y] = point(1, a);
      return `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(2)}" y2="${y.toFixed(2)}" />`;
    })
    .join('');
  const dataPoly = angles
    .map((a, i) => {
      const axis = labels[i];
      const scale = Math.max(0, Math.min(1, Number(radar[axis] || 0) / maxValue));
      return point(scale, a);
    })
    .map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`)
    .join(' ');
  const labelHtml = angles
    .map((a, i) => {
      const axis = labels[i];
      const [x, y] = point(1.33, a);
      const color = colors[axis] || '#f0f0f0';
      const mark = showDominantStar && dominant === axis ? '☆' : '';
      const value = truncate2(radar[axis] || 0).toFixed(2);
      return `<g class="radar-axis-group"><text x="${x.toFixed(2)}" y="${y.toFixed(2)}" fill="${color}" text-anchor="middle" class="radar-axis-label">${mark}${axis}</text><text x="${x.toFixed(2)}" y="${(y + 11).toFixed(2)}" fill="${color}" text-anchor="middle" class="radar-axis-value">${value}</text></g>`;
    })
    .join('');
  const extraClass = options.compact ? ' compact' : '';
  return `
    <div class="radar-wrap${extraClass}">
      <svg class="radar-chart" viewBox="0 0 260 220" aria-label="notes radar chart">
        <defs>
          <linearGradient id="radarFillGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#fff46a" stop-opacity="0.65"/>
            <stop offset="100%" stop-color="#a63a4d" stop-opacity="0.45"/>
          </linearGradient>
        </defs>
        <g class="radar-grid">${ringPolys}${axisLines}</g>
        <polygon class="radar-fill" points="${dataPoly}" />
        <polygon class="radar-outline" points="${dataPoly}" />
        <g class="radar-labels">${labelHtml}</g>
      </svg>
    </div>
  `;
}

function computePlayerRadarProfile() {
  const perSong = new Map();
  Object.values(state.tableViews || {}).forEach((view) => {
    (view?.flatCharts || []).forEach((chart) => {
      const radar = normalizeRadarData(chart.radar);
      if (!radar) return;
      const notes = Number(chart.noteCount || 0);
      const ex = Number(chart.exScore || 0);
      if (notes <= 0 || ex <= 0) return;
      const full = notes * 2;
      if (full <= 0) return;
      const scoreRatePercent = truncate2((ex / full) * 100);
      const rateRatio = scoreRatePercent / 100;
      const songKey = titleKey(chart.title || '');
      const curr = perSong.get(songKey) || { title: chart.title || '', NOTES: 0, PEAK: 0, SCRATCH: 0, SOFLAN: 0, CHARGE: 0, CHORD: 0 };
      if (!curr.title) curr.title = chart.title || '';
      RADAR_ORDER.forEach((axis) => {
        const earned = truncate2(Number(radar[axis] || 0) * rateRatio);
        if (earned > curr[axis]) curr[axis] = earned;
      });
      perSong.set(songKey, curr);
    });
  });
  const profile = { NOTES: 0, PEAK: 0, SCRATCH: 0, SOFLAN: 0, CHARGE: 0, CHORD: 0 };
  const rankings = {};
  RADAR_ORDER.forEach((axis) => {
    const topRows = [...perSong.values()]
      .map((x) => ({ title: String(x.title || '').trim(), value: Number(x[axis] || 0) }))
      .filter((x) => x.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
    rankings[axis] = topRows;
    const values = topRows
      .map((x) => x.value)
      .sort((a, b) => b - a)
      .slice(0, 10);
    if (!values.length) {
      profile[axis] = 0;
      return;
    }
    const avg = values.reduce((sum, v) => sum + v, 0) / values.length;
    profile[axis] = truncate2(avg);
  });
  const total = truncate2(RADAR_ORDER.reduce((sum, axis) => sum + Number(profile[axis] || 0), 0));
  return { radar: profile, total, dominantAxis: dominantRadarAxis(profile), rankings };
}

function computeRadarProfileFromRows(rows) {
  const rowIndex = buildRowIndex(rows || []);
  const perSong = new Map();
  Object.values(state.rankTables || {}).forEach((table) => {
    (table?.categories || []).forEach((cat) => {
      (cat?.items || []).forEach((item) => {
        const data = item?.data || {};
        const radar = normalizeRadarData(data.radar);
        if (!radar || !data.title) return;
        const type = data.type || 'A';
        const row = findRowByTitle(rowIndex, data.title);
        if (!row) return;
        const stats = rowStats(row, type);
        const notes = Number(stats.noteCount || 0);
        const ex = Number(stats.exScore || 0);
        if (notes <= 0 || ex <= 0) return;
        const full = notes * 2;
        if (full <= 0) return;
        const rateRatio = truncate2((ex / full) * 100) / 100;
        const songKey = titleKey(data.title || '');
        const curr = perSong.get(songKey) || {
          title: data.title || '',
          NOTES: 0,
          PEAK: 0,
          SCRATCH: 0,
          SOFLAN: 0,
          CHARGE: 0,
          CHORD: 0
        };
        RADAR_ORDER.forEach((axis) => {
          const earned = truncate2(Number(radar[axis] || 0) * rateRatio);
          if (earned > curr[axis]) curr[axis] = earned;
        });
        perSong.set(songKey, curr);
      });
    });
  });
  const songRows = [...perSong.values()];
  const profile = { NOTES: 0, PEAK: 0, SCRATCH: 0, SOFLAN: 0, CHARGE: 0, CHORD: 0 };
  const rankings = {};
  RADAR_ORDER.forEach((axis) => {
    const topRows = songRows
      .map((x) => ({ title: String(x.title || '').trim(), value: Number(x[axis] || 0) }))
      .filter((x) => x.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
    rankings[axis] = topRows;
    if (!topRows.length) {
      profile[axis] = 0;
      return;
    }
    const avg = topRows.reduce((sum, x) => sum + x.value, 0) / topRows.length;
    profile[axis] = truncate2(avg);
  });
  const total = truncate2(RADAR_ORDER.reduce((sum, axis) => sum + Number(profile[axis] || 0), 0));
  return { radar: profile, total, dominantAxis: dominantRadarAxis(profile), rankings, songRows };
}

function chartMetaByKey(key) {
  const [tableName, tkey, type] = String(key || '').split('|');
  const view = state.tableViews?.[tableName];
  if (!view || !tkey || !type) return null;
  const chart = (view.flatCharts || []).find((c) => titleKey(c.title) === tkey && c.type === type);
  if (!chart) return null;
  const radar = normalizeRadarData(chart.radar);
  if (!radar) return null;
  return { title: chart.title, radar };
}

function computeRadarProfileFromProgress(progress) {
  if (!progress || typeof progress !== 'object') {
    return { radar: { NOTES: 0, PEAK: 0, SCRATCH: 0, SOFLAN: 0, CHARGE: 0, CHORD: 0 }, total: 0, dominantAxis: '', rankings: {}, songRows: [] };
  }
  const perSong = new Map();
  Object.entries(progress).forEach(([key, p]) => {
    const meta = chartMetaByKey(key);
    if (!meta) return;
    const notes = Number(p?.noteCount || 0);
    const ex = Number(p?.exScore || 0);
    if (notes <= 0 || ex <= 0) return;
    const full = notes * 2;
    if (full <= 0) return;
    const rateRatio = truncate2((ex / full) * 100) / 100;
    const songKey = titleKey(meta.title || '');
    const curr = perSong.get(songKey) || {
      title: meta.title || '',
      NOTES: 0,
      PEAK: 0,
      SCRATCH: 0,
      SOFLAN: 0,
      CHARGE: 0,
      CHORD: 0
    };
    RADAR_ORDER.forEach((axis) => {
      const earned = truncate2(Number(meta.radar[axis] || 0) * rateRatio);
      if (earned > curr[axis]) curr[axis] = earned;
    });
    perSong.set(songKey, curr);
  });
  const songRows = [...perSong.values()];
  const profile = { NOTES: 0, PEAK: 0, SCRATCH: 0, SOFLAN: 0, CHARGE: 0, CHORD: 0 };
  const rankings = {};
  RADAR_ORDER.forEach((axis) => {
    const topRows = songRows
      .map((x) => ({ title: String(x.title || '').trim(), value: Number(x[axis] || 0) }))
      .filter((x) => x.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
    rankings[axis] = topRows;
    if (!topRows.length) {
      profile[axis] = 0;
      return;
    }
    const avg = topRows.reduce((sum, x) => sum + x.value, 0) / topRows.length;
    profile[axis] = truncate2(avg);
  });
  const total = truncate2(RADAR_ORDER.reduce((sum, axis) => sum + Number(profile[axis] || 0), 0));
  return { radar: profile, total, dominantAxis: dominantRadarAxis(profile), rankings, songRows };
}

function buildRadarHistoryEvents(prevRows, currRows, prevProgress = null, currProgress = null) {
  const prev = (Array.isArray(prevRows) && prevRows.length)
    ? computeRadarProfileFromRows(prevRows)
    : computeRadarProfileFromProgress(prevProgress);
  const curr = (Array.isArray(currRows) && currRows.length)
    ? computeRadarProfileFromRows(currRows)
    : computeRadarProfileFromProgress(currProgress);
  const prevMap = new Map((prev.songRows || []).map((x) => [titleKey(x.title || ''), x]));
  const currMap = new Map((curr.songRows || []).map((x) => [titleKey(x.title || ''), x]));
  const events = [];
  RADAR_ORDER.forEach((axis) => {
    const diff = truncate2(Number(curr.radar[axis] || 0) - Number(prev.radar[axis] || 0));
    if (diff <= 0) return;
    const contributors = [];
    currMap.forEach((row, k) => {
      const prevRow = prevMap.get(k);
      const delta = truncate2(Number(row[axis] || 0) - Number(prevRow?.[axis] || 0));
      if (delta > 0) contributors.push({ title: row.title || '-', delta });
    });
    contributors.sort((a, b) => b.delta - a.delta);
    const top = contributors.slice(0, 3).map((x) => `${x.title} (+${x.delta.toFixed(2)})`).join(', ');
    events.push({
      axis,
      diff,
      text: `${radarAxisDisplayName(axis)} +${diff.toFixed(2)}${top ? ` | 주요 곡: ${top}` : ''}`
    });
  });
  return events;
}

function buildAccountRadarHtml({ stacked = false } = {}) {
  const profile = computePlayerRadarProfile();
  state.radarDialogProfile = profile;
  const hasData = RADAR_ORDER.some((axis) => Number(profile.radar[axis] || 0) > 0);
  if (!hasData) {
    return '<div class="account-radar-empty">NO DATA</div>';
  }
  const barOrder = ['NOTES', 'CHORD', 'PEAK', 'CHARGE', 'SCRATCH', 'SOFLAN'];
  const bars = barOrder
    .map((axis) => ({ axis, value: Number(profile.radar[axis] || 0) }))
    .map((x, i) => {
      const height = Math.max(2, (x.value / 200) * 100);
      const cls = `axis-${x.axis.toLowerCase()}`;
      const alt = i % 2 === 0 ? 'label-top' : 'label-bottom';
      return `<button type="button" class="account-radar-vbar ${alt}" data-radar-axis="${x.axis}" title="${radarAxisDisplayName(x.axis)}"><div class="account-radar-vbar-value ${cls}">${x.value.toFixed(2)}</div><div class="account-radar-vbar-col"><div class="account-radar-vbar-fill ${cls}" style="height:${height.toFixed(2)}%"></div></div><div class="account-radar-vbar-label ${cls}">${radarAxisDisplayName(x.axis)}</div></button>`;
    })
    .join('');
  const layoutClass = stacked ? ' stacked' : '';
  return `<div class="account-radar-row${layoutClass}">${radarSvgHtml(profile.radar, { dominantAxis: profile.dominantAxis, compact: true, showDominantStar: false })}<div class="account-radar-bars"><div class="account-radar-vbars">${bars}</div><div class="account-radar-total">TOTAL RADAR SCORE: ${profile.total.toFixed(2)}</div></div></div>`;
}

function authStatusText() {
  const acc = activeAcc();
  if (!acc) return '계정 없음';
  if (!acc.googleAuthUserId) return 'Google 미연동';
  const ctx = authContext.get();
  if (!ctx?.user?.id) return 'Google 연동됨 (로그인 필요)';
  if (ctx.user.id !== acc.googleAuthUserId) return 'Google 연동됨 (다른 Google 로그인됨)';
  const email = acc.googleEmail || ctx.user.email || '';
  return `Google 연동됨${email ? ` (${email})` : ''}`;
}

function renderAuthStatus() {
  const el = $('googleAuthStatus');
  if (!el) return;
  el.textContent = authStatusText();
}

function getSupabaseClient() {
  if (typeof createClient !== 'function') {
    console.error('[auth] Supabase client library is not loaded.');
    return null;
  }
  const url = SUPABASE_URL;
  const anonKey = SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anonKey) return null;
  if (isServiceRoleKey(anonKey)) {
    if (!supabaseKeyWarningShown) {
      console.warn('[auth] Service Role key is not allowed in renderer.');
      supabaseKeyWarningShown = true;
    }
    authContext.set({ status: 'signed_out', user: null, session: null });
    return null;
  }
  supabaseKeyWarningShown = false;
  const nextKey = `${url}|${anonKey}`;
  if (supabaseClient && supabaseConfigKey === nextKey) return supabaseClient;
  if (supabaseAuthUnsub) {
    try { supabaseAuthUnsub.subscription.unsubscribe(); } catch { /* ignore */ }
    supabaseAuthUnsub = null;
  }
  supabaseClient = createClient(url, anonKey, {
    auth: {
      flowType: 'pkce',
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false
    }
  });
  supabaseConfigKey = nextKey;
  supabaseAuthUnsub = supabaseClient.auth.onAuthStateChange((_event, session) => {
    authContext.set({
      status: session?.user ? 'signed_in' : 'signed_out',
      user: session?.user || null,
      session: session || null,
      accountId: state.activeAccountId || null
    });
  }).data;
  supabaseClient.auth.getSession().then(({ data }) => {
    authContext.set({
      status: data?.session?.user ? 'signed_in' : 'signed_out',
      user: data?.session?.user || null,
      session: data?.session || null,
      accountId: state.activeAccountId || null
    });
  }).catch(() => {
    authContext.set({ status: 'signed_out', user: null, session: null, accountId: state.activeAccountId || null });
  });
  return supabaseClient;
}

function resetSupabaseClient() {
  if (supabaseAuthUnsub) {
    try { supabaseAuthUnsub.subscription.unsubscribe(); } catch { /* ignore */ }
    supabaseAuthUnsub = null;
  }
  supabaseClient = null;
  supabaseConfigKey = '';
  authContext.set({ status: 'signed_out', user: null, session: null, accountId: state.activeAccountId || null });
}

async function syncLinkedAccountToCloud(reason = 'manual') {
  const acc = activeAcc();
  if (!acc || !acc.googleAuthUserId) return;
  const client = getSupabaseClient();
  if (!client) return;
  const session = (await client.auth.getSession()).data?.session;
  if (!session?.user?.id || session.user.id !== acc.googleAuthUserId) return;
  const lightHistory = (acc.history || []).map((h) => ({
    id: h.id,
    timestamp: h.timestamp,
    summary: h.summary,
    isInitial: !!h.isInitial,
    updates: h.updates || [],
    goals: h.goals || []
  }));
  const profilePayload = {
    auth_user_id: session.user.id,
    infinitas_id: acc.infinitasId,
    dj_name: acc.djName,
    google_email: acc.googleEmail || '',
    icon_data_url: acc.iconDataUrl || '',
    updated_at: new Date().toISOString()
  };
  const statePayload = {
    auth_user_id: session.user.id,
    account_id: acc.id,
    tracker_rows: acc.trackerRows || [],
    goals: acc.goals || [],
    history: lightHistory,
    last_progress: acc.lastProgress || {},
    social_settings: acc.socialSettings || {
      discoverability: state.settings.discoverability,
      followPolicy: state.settings.followPolicy,
      shareDataScope: normalizeShareDataScope(state.settings.shareDataScope),
      rivalPolicy: state.settings.rivalPolicy
    },
    updated_at: new Date().toISOString(),
    update_reason: reason
  };
  const p1 = await client.from('users').upsert(profilePayload, { onConflict: 'auth_user_id' });
  if (p1.error) throw p1.error;
  const p2 = await client.from('account_states').upsert(statePayload, { onConflict: 'auth_user_id' });
  if (p2.error) throw p2.error;
}

function queueCloudSync(reason = 'state') {
  if (cloudSyncTimer) clearTimeout(cloudSyncTimer);
  cloudSyncTimer = setTimeout(async () => {
    if (cloudSyncRunning) return;
    cloudSyncRunning = true;
    try {
      await syncLinkedAccountToCloud(reason);
    } catch (e) {
      console.warn('[cloud-sync]', e?.message || e);
    } finally {
      cloudSyncRunning = false;
    }
  }, 800);
}

function closeAllEnhancedSelect(exceptId = null) {
  enhancedSelects.forEach((inst, id) => {
    if (id !== exceptId) inst.close?.();
  });
}

function mountBasicSelect(selectId) {
  const sel = $(selectId);
  if (!sel) return;
  if (enhancedSelects.has(selectId)) return;
  sel.classList.add('native-select-hidden');
  const wrap = document.createElement('div');
  wrap.className = 'it-select';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'it-select-btn';
  const menu = document.createElement('div');
  menu.className = 'it-select-menu hidden';
  wrap.appendChild(btn);
  wrap.appendChild(menu);
  sel.insertAdjacentElement('afterend', wrap);
  const render = () => {
    const opts = [...sel.options];
    const curr = opts.find((o) => o.value === sel.value) || opts[0];
    btn.textContent = curr?.textContent || '';
    menu.innerHTML = opts.map((o) => `<button type="button" class="it-option ${o.value===sel.value?'active':''}" data-value="${esc(o.value)}">${esc(o.textContent || '')}</button>`).join('');
  };
  const close = () => menu.classList.add('hidden');
  const open = () => { closeAllEnhancedSelect(selectId); menu.classList.remove('hidden'); };
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (menu.classList.contains('hidden')) open();
    else close();
  });
  menu.addEventListener('click', (e) => {
    const b = e.target.closest('.it-option');
    if (!b) return;
    const v = b.getAttribute('data-value') || '';
    sel.value = v;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    render();
    close();
  });
  sel.addEventListener('change', render);
  render();
  enhancedSelects.set(selectId, { close, render, wrap });
}

function mountSearchSelect(selectId, hostId, { placeholder = '검색...' } = {}) {
  const sel = $(selectId);
  const host = $(hostId);
  if (!sel || !host) return;
  if (enhancedSelects.has(selectId)) return;
  sel.classList.add('native-select-hidden');
  const wrap = document.createElement('div');
  wrap.className = 'it-search';
  wrap.innerHTML = `<input class="it-search-input" placeholder="${esc(placeholder)}" /><button type="button" class="it-search-toggle">▼</button><div class="it-select-menu hidden"></div>`;
  host.innerHTML = '';
  host.appendChild(wrap);
  const input = wrap.querySelector('.it-search-input');
  const toggle = wrap.querySelector('.it-search-toggle');
  const menu = wrap.querySelector('.it-select-menu');
  const getFiltered = () => {
    const q = (input.value || '').trim().toLowerCase();
    return [...sel.options].filter((o) => !q || (o.textContent || '').toLowerCase().includes(q));
  };
  const render = () => {
    const opts = getFiltered();
    if (document.activeElement !== input) input.value = state.goalSongQuery || '';
    menu.innerHTML = opts.length
      ? opts.map((o) => `<button type="button" class="it-option ${o.value===sel.value?'active':''}" data-value="${esc(o.value)}">${esc(o.textContent || '')}</button>`).join('')
      : '<div class="it-option">검색 결과가 없습니다.</div>';
  };
  const close = () => menu.classList.add('hidden');
  const open = () => { closeAllEnhancedSelect(selectId); menu.classList.remove('hidden'); render(); };
  input.addEventListener('input', () => {
    state.goalSongQuery = input.value || '';
    renderGoalCandidates();
    open();
  });
  input.addEventListener('focus', open);
  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    if (menu.classList.contains('hidden')) open();
    else close();
  });
  menu.addEventListener('click', (e) => {
    const b = e.target.closest('.it-option[data-value]');
    if (!b) return;
    const v = b.getAttribute('data-value') || '';
    sel.value = v;
    const curr = [...sel.options].find((o) => o.value === v);
    input.value = curr?.textContent || '';
    state.goalSongQuery = input.value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    close();
    render();
  });
  sel.addEventListener('change', render);
  render();
  enhancedSelects.set(selectId, { close, render, wrap });
}

function syncGoalTargetInputVisibility() {
  const showLamp = !$('goalLamp').classList.contains('hidden');
  const showRank = !$('goalRank').classList.contains('hidden');
  const lampWrap = enhancedSelects.get('goalLamp')?.wrap;
  const rankWrap = enhancedSelects.get('goalRank')?.wrap;
  if (lampWrap) lampWrap.classList.toggle('hidden', !showLamp);
  if (rankWrap) rankWrap.classList.toggle('hidden', !showRank);
}

function decorateButtons(root = document) {
  root.querySelectorAll('button').forEach((btn) => {
    if (
      btn.classList.contains('song-button') ||
      btn.classList.contains('dock-tab') ||
      btn.classList.contains('widget-drag-handle') ||
      btn.classList.contains('it-option') ||
      btn.classList.contains('it-select-btn') ||
      btn.classList.contains('it-search-toggle') ||
      btn.classList.contains('history-item') ||
      btn.classList.contains('history-accordion-btn') ||
      btn.hasAttribute('data-table') ||
      btn.hasAttribute('data-view') ||
      btn.hasAttribute('data-sort')
    ) return;
    btn.classList.add('ui-btn');
    if (btn.id === 'btnExportImage') {
      btn.classList.add('download-fancy');
      if (!btn.querySelector('.btn-text')) btn.innerHTML = `<span class="btn-text">${esc(btn.textContent || '다운로드')}</span>`;
    }
  });
}

const slidingGroups = [];

function measureSlidingGroup(root, itemSelector) {
  if (!root) return;
  const items = [...root.querySelectorAll(itemSelector)];
  if (!items.length) return;
  const active = items.find((x) => x.classList.contains('active')) || items[0];
  const left = Math.max(0, active.offsetLeft);
  const width = Math.max(0, active.offsetWidth);
  root.style.setProperty('--slide-left', `${left.toFixed(2)}px`);
  root.style.setProperty('--slide-width', `${width.toFixed(2)}px`);
}

function initSlidingControls() {
  const defs = [
    { root: document.querySelector('.tabs.slide-tabs'), selector: '.tab' },
    { root: document.querySelector('.view-toggle.slide-tabs'), selector: '[data-view]' },
    { root: document.querySelector('.sort-toggle.slide-tabs'), selector: '[data-sort]' }
  ];
  defs.forEach((def) => {
    const root = def.root;
    if (!root) return;
    if (!root.querySelector('.slide-indicator')) {
      const indicator = document.createElement('span');
      indicator.className = 'slide-indicator';
      root.insertBefore(indicator, root.firstChild);
    }
    const itemSelector = def.selector;
    const update = () => measureSlidingGroup(root, itemSelector);
    root.addEventListener('click', () => requestAnimationFrame(update));
    slidingGroups.push(update);
    requestAnimationFrame(update);
  });
  window.addEventListener('resize', () => slidingGroups.forEach((fn) => fn()));
}

function syncSlidingControls() {
  slidingGroups.forEach((fn) => fn());
}

function bindRippleButtons() {
  // intentionally disabled: no click ripple motion
}

function toast(msg, type = 'info') {
  const el = $('toast');
  el.className = 'toast';
  if (['success', 'info', 'error', 'warning'].includes(type)) el.classList.add(type);
  const iconMap = { success: '✓', info: 'i', error: '!', warning: '!' };
  el.innerHTML = `<span class="toast-icon">${iconMap[type] || 'i'}</span><span>${esc(msg)}</span>`;
  el.classList.remove('hidden');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 3000);
}

async function uiConfirm(message, { title = '확인', okText = '확인', cancelText = '취소', showCancel = true } = {}) {
  const dialog = $('uiConfirmDialog');
  const form = $('uiConfirmForm');
  const titleEl = $('uiConfirmTitle');
  const messageEl = $('uiConfirmMessage');
  const okBtn = $('uiConfirmOkBtn');
  const cancelBtn = $('uiConfirmCancelBtn');
  if (dialog.open) dialog.close('cancel');
  titleEl.textContent = title;
  messageEl.textContent = message;
  okBtn.textContent = okText;
  cancelBtn.textContent = cancelText;
  cancelBtn.style.display = showCancel ? 'inline-block' : 'none';
  const onCancel = () => dialog.close('cancel');
  const onSubmit = (e) => { e.preventDefault(); dialog.close('ok'); };
  cancelBtn.addEventListener('click', onCancel);
  form.addEventListener('submit', onSubmit);
  dialog.showModal();
  requestAnimationFrame(() => okBtn.focus());
  return new Promise((resolve) => {
    const onClose = () => {
      dialog.removeEventListener('close', onClose);
      cancelBtn.removeEventListener('click', onCancel);
      form.removeEventListener('submit', onSubmit);
      resolve(dialog.returnValue === 'ok');
    };
    dialog.addEventListener('close', onClose);
  });
}

function digitsOnly(v) { return (v || '').replace(/\D/g, '').slice(0, 12); }
function fmtInf(v) {
  const d = digitsOnly(v);
  if (!d) return 'C-0000-0000-0000';
  const a = d.slice(0,4), b = d.slice(4,8), c = d.slice(8,12);
  return `C-${a}${b?`-${b}`:''}${c?`-${c}`:''}`;
}
function fmtInfFixed(v) {
  const d = digitsOnly(v).padEnd(12, '0').slice(0, 12);
  return `C-${d.slice(0,4)}-${d.slice(4,8)}-${d.slice(8,12)}`;
}

function parseTsv(content) {
  const lines = content.split(/\r?\n/).filter((x) => x.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split('\t');
  return lines.slice(1).map((line) => {
    const cols = line.split('\t');
    const row = {};
    headers.forEach((h, i) => { row[h] = cols[i] ?? ''; });
    return row;
  }).filter((r) => r.title);
}

function rowsToTsv(rows) {
  if (!Array.isArray(rows) || !rows.length) return '';
  const headers = Object.keys(rows[0]);
  const lines = [headers.join('\t')];
  rows.forEach((row) => {
    lines.push(headers.map((h) => (row[h] ?? '').toString().replace(/\r?\n/g, ' ')).join('\t'));
  });
  return `${lines.join('\n')}\n`;
}

function normalizeLamp(raw) {
  const v = (raw || 'NP').trim().toUpperCase();
  const map = { NP:'NP', NOPLAY:'NP', F:'F', FAILED:'F', EX:'EX', EXHARD:'EX', HC:'HC', HARD:'HC', FC:'FC', EASY:'EASY', NORMAL:'NORMAL' };
  return map[v] || 'NP';
}
function clearStatus(lamp) {
  if (lamp === 'FC') return 'FC';
  if (lamp === 'EX') return 'EXHARD';
  if (lamp === 'HC') return 'HARD';
  if (lamp === 'NORMAL') return 'NORMAL';
  if (lamp === 'EASY') return 'EASY';
  if (lamp === 'F') return 'FAILED';
  return 'NOPLAY';
}
function scoreTier(exScore, noteCount, lamp) {
  if (lamp === 'NP' || noteCount <= 0) return '';
  const rate = (exScore / (noteCount * 2)) * 100;
  if (rate >= 100) return 'MAX';
  if (rate >= 94.4444444444) return 'MAX-';
  if (rate >= 88.8888888888) return 'AAA';
  if (rate >= 77.7777777777) return 'AA';
  if (rate >= 66.6666666666) return 'A';
  if (rate >= 55.5555555555) return 'B';
  if (rate >= 44.4444444444) return 'C';
  if (rate >= 33.3333333333) return 'D';
  if (rate >= 22.2222222222) return 'E';
  return 'F';
}

function activeAcc() { return state.accounts.find((a) => a.id === state.activeAccountId) || null; }
function iconSrc(acc) { return (acc && acc.iconDataUrl) || DEFAULT_ICON_SRC; }

function normalizeSettings(s) {
  const src = (s && typeof s === 'object') ? s : {};
  return {
    showUpdateGoalCards: src.showUpdateGoalCards !== false,
    enableHistoryRollback: src.enableHistoryRollback !== false,
    discoverability: src.discoverability === 'hidden' ? 'hidden' : 'searchable',
    followPolicy: ['auto', 'manual', 'disabled'].includes(src.followPolicy) ? src.followPolicy : 'manual',
    shareDataScope: normalizeShareDataScope(src.shareDataScope),
    rivalPolicy: ['all', 'followers', 'disabled'].includes(src.rivalPolicy) ? src.rivalPolicy : 'followers'
  };
}

function normalizeSocialSettings(s) {
  const n = normalizeSettings(s);
  return {
    discoverability: n.discoverability,
    followPolicy: n.followPolicy,
    shareDataScope: normalizeShareDataScope(n.shareDataScope),
    rivalPolicy: n.rivalPolicy
  };
}

function ensureAcc(a) {
  const dj = (a.djName || a.name || '').trim() || 'DJ USER';
  const goals = Array.isArray(a.goals) ? a.goals.map((g) => {
    if (g && g.chartType && g.kind) {
      return { ...g, source: (g.source || '').trim() || dj };
    }
    return {
      id: g?.id || crypto.randomUUID(),
      table: g?.table || 'SP12H',
      title: g?.title || '',
      chartType: g?.chartType || g?.type || 'A',
      kind: g?.kind || 'CLEAR',
      targetLamp: g?.targetLamp || 'HC',
      targetScore: num(g?.targetScore),
      targetRank: g?.targetRank || 'AA',
      source: (g?.source || '').trim() || dj
    };
  }) : [];
  return {
    id: a.id || crypto.randomUUID(),
    name: dj,
    djName: dj,
    infinitasId: a.infinitasId || 'C-0000-0000-0000',
    iconDataUrl: typeof a.iconDataUrl === 'string' ? a.iconDataUrl : '',
    createdAt: a.createdAt || nowIso(),
    trackerRows: Array.isArray(a.trackerRows) ? a.trackerRows : [],
    goals,
    history: Array.isArray(a.history) ? a.history : [],
    lastProgress: a.lastProgress && typeof a.lastProgress === 'object' ? a.lastProgress : null,
    socialSettings: normalizeSocialSettings(a.socialSettings || null),
    googleAuthUserId: typeof a.googleAuthUserId === 'string' ? a.googleAuthUserId : '',
    googleEmail: typeof a.googleEmail === 'string' ? a.googleEmail : '',
    googleLinkedAt: typeof a.googleLinkedAt === 'string' ? a.googleLinkedAt : ''
  };
}

function migrate(saved) {
  if (Array.isArray(saved?.accounts)) {
    const accounts = saved.accounts.map(ensureAcc).slice(0, MAX_ACCOUNTS);
    const active = accounts.some((a) => a.id === saved.activeAccountId) ? saved.activeAccountId : accounts[0]?.id || null;
    return {
      accounts,
      active,
      refluxExePath: typeof saved.refluxExePath === 'string' ? saved.refluxExePath : '',
      settings: normalizeSettings(saved.settings)
    };
  }
  return { accounts: [], active: null, refluxExePath: '', settings: normalizeSettings(null) };
}

function rowStats(row, type) {
  const p = TYPE_TO_PREFIX[type];
  if (!p || !row) return { lamp:'NP', clearStatus:'NOPLAY', exScore:0, missCount:0, noteCount:0, rate:0, scoreTier:'', unlocked:true };
  const rawUnlocked = String(row[`${p} Unlocked`] || '').trim().toUpperCase();
  const unlocked = rawUnlocked === '' ? true : rawUnlocked === 'TRUE';
  const lamp = normalizeLamp(row[`${p} Lamp`]);
  const ex = num(row[`${p} EX Score`]);
  const notes = num(row[`${p} Note Count`]);
  const miss = num(row[`${p} Miss Count`]);
  const rate = notes > 0 ? (ex / (notes * 2)) * 100 : 0;
  return { lamp, clearStatus: clearStatus(lamp), exScore: ex, missCount: miss, noteCount: notes, rate, scoreTier: scoreTier(ex, notes, lamp), unlocked };
}

function buildRowIndex(rows) {
  const idx = new Map();
  const idxLoose = new Map();
  const idxCode = new Map();
  const idxAscii = new Map();
  const idxAliasLoose = new Map();
  (rows || []).forEach((r) => {
    const k = titleKey(r.title);
    const lk = looseTitle(r.title);
    const ck = codeAliasTitle(r.title);
    const ak = foldedAsciiTitle(r.title);
    if (k && !idx.has(k)) idx.set(k, r);
    if (lk && !idxLoose.has(lk)) idxLoose.set(lk, r);
    if (ck && !idxCode.has(ck)) idxCode.set(ck, r);
    if (ak && !idxAscii.has(ak)) idxAscii.set(ak, r);
    aliasTitleCandidates(r.title).forEach((a) => {
      const al = looseTitle(a);
      if (al && !idxAliasLoose.has(al)) idxAliasLoose.set(al, r);
    });
  });
  return { idx, idxLoose, idxCode, idxAscii, idxAliasLoose };
}

function findRowByTitle(indexes, title) {
  const tk = titleKey(title);
  const lk = looseTitle(title);
  const ck = codeAliasTitle(title);
  const ak = foldedAsciiTitle(title);
  if (indexes.idx.get(tk)) return indexes.idx.get(tk);
  if (indexes.idxLoose.get(lk)) return indexes.idxLoose.get(lk);
  if (ck && indexes.idxCode.get(ck)) return indexes.idxCode.get(ck);
  if (ak && indexes.idxAscii.get(ak)) return indexes.idxAscii.get(ak);
  for (const a of aliasTitleCandidates(title)) {
    const al = looseTitle(a);
    if (al && indexes.idxAliasLoose.get(al)) return indexes.idxAliasLoose.get(al);
  }
  return null;
}

function buildViews() {
  const acc = activeAcc();
  const rows = acc?.trackerRows || [];
  const hasTracker = rows.length > 0;
  const rowIndex = buildRowIndex(rows);

  const views = {};
  Object.entries(state.rankTables).forEach(([tableName, tableData]) => {
    const categories = [];
    const flatCharts = [];
    const seenLooseTitle = new Set();
    const matchedRowType = new Set();
    const levelMatch = /^SP(\d+)H$/i.exec(tableName);
    const expectedLevel = levelMatch ? Number(levelMatch[1]) : 0;
    (tableData.categories || []).forEach((cat) => {
      const items = [];
      (cat.items || []).forEach((item) => {
        const title = item?.data?.title || '';
        const type = item?.data?.type || 'A';
        const keyTitle = titleKey(title);
        const row = findRowByTitle(rowIndex, title);
        if (hasTracker && !row) return;
        if (hasTracker) {
          const p = TYPE_TO_PREFIX[type];
          const noteCount = num(row?.[`${p} Note Count`]);
          if (noteCount <= 0) return;
          if (expectedLevel > 0) {
            const rating = num(row?.[`${p} Rating`]);
            if (rating > 0 && rating !== expectedLevel) return;
          }
        }
        const dedupeKey = `${looseTitle(title) || titleKey(title)}|${type}`;
        if (dedupeKey && seenLooseTitle.has(dedupeKey)) return;
        const stats = rowStats(row, type);
        const songData = item?.data || {};
        const chart = {
          key: `${tableName}|${keyTitle}|${type}`,
          tableName,
          category: cat.category,
          title,
          type,
          ...stats,
          isUnlocked: stats.unlocked !== false,
          bpm: songData.bpm || '',
          metaNotes: Number(songData.atwikiNotes || songData.notes || stats.noteCount || 0),
          metaType: songData.typeInfo || '',
          cpiHc: Number(songData.cpiHc || 0),
          cpiEx: Number(songData.cpiEx || 0),
          radar: songData.radar || null,
          radarTop: songData.radarTop || ''
        };
        items.push(chart);
        flatCharts.push(chart);
        if (dedupeKey) seenLooseTitle.add(dedupeKey);
        if (row) matchedRowType.add(`${titleKey(row.title)}|${type}`);
      });
      categories.push({ name: cat.category, sortindex: cat.sortindex, items });
    });
    if (hasTracker && expectedLevel > 0) {
      const uncategorized = [];
      rows.forEach((row) => {
        ['H', 'A', 'L'].forEach((type) => {
          const p = TYPE_TO_PREFIX[type];
          const noteCount = num(row?.[`${p} Note Count`]);
          if (noteCount <= 0) return;
          const rating = num(row?.[`${p} Rating`]);
          if (rating > 0 && rating !== expectedLevel) return;
          const rowTypeKey = `${titleKey(row.title)}|${type}`;
          if (matchedRowType.has(rowTypeKey)) return;
          const stats = rowStats(row, type);
          const chart = {
            key: `${tableName}|${titleKey(row.title)}|${type}`,
            tableName,
            category: '미분류',
            title: row.title,
            type,
            ...stats,
            isUnlocked: stats.unlocked !== false,
            bpm: '',
            metaNotes: 0,
            metaType: '',
            cpiHc: 0,
            cpiEx: 0
          };
          uncategorized.push(chart);
          flatCharts.push(chart);
          matchedRowType.add(rowTypeKey);
        });
      });
      if (uncategorized.length) {
        uncategorized.sort((a, b) => a.title.localeCompare(b.title));
        const existingMisc = categories.find((c) => c.name === '미분류');
        if (existingMisc) {
          existingMisc.items.push(...uncategorized);
        } else {
          categories.push({ name: '미분류', sortindex: categories.length, items: uncategorized });
        }
      }
    }
    views[tableName] = { title: tableData?.tableinfo?.title || tableName, categories, flatCharts };
  });
  state.tableViews = views;
}

function progressMap() {
  const map = {};
  Object.values(state.tableViews).forEach((v) => v.flatCharts.forEach((c) => {
    map[c.key] = { tableName: c.tableName, title:c.title, type:c.type, lamp:c.lamp, clearStatus:c.clearStatus, exScore:c.exScore, scoreTier:c.scoreTier };
  }));
  return map;
}
function goalLabel(goal) {
  if (goal.kind === 'SCORE') return `EX ${goal.targetScore}`;
  if (goal.kind === 'RANK') return goal.targetRank;
  return goal.targetLamp;
}
function goalAchieved(goal, progress) {
  const row = progress[`${goal.table}|${titleKey(goal.title)}|${goal.chartType}`];
  if (!row) return false;
  if (goal.kind === 'SCORE') return (row.exScore ?? 0) >= (goal.targetScore ?? 0);
  if (goal.kind === 'RANK') return (GOAL_RANK_ORDER[row.scoreTier] ?? 0) >= (GOAL_RANK_ORDER[goal.targetRank] ?? 0);
  return (LAMP_ORDER[row.lamp] ?? 0) >= (LAMP_ORDER[goal.targetLamp] ?? 0);
}

function makeEvents(prev, curr, goals) {
  if (!prev) return { updates: ['최초 데이터 업로드'], goals: [] };
  const updates = [];
  Object.keys(curr).forEach((k) => {
    const a = prev[k] || { clearStatus:'NOPLAY', exScore:0 };
    const b = curr[k];
    if (a.clearStatus !== b.clearStatus) {
      updates.push({
        kind: 'lamp',
        table: b.tableName || k.split('|')[0] || 'SP12H',
        title: b.title,
        type: b.type,
        from: a.clearStatus || 'NOPLAY',
        to: b.clearStatus || 'NOPLAY'
      });
    }
    if ((a.exScore ?? 0) !== (b.exScore ?? 0)) {
      const d = b.exScore - (a.exScore ?? 0);
      updates.push({
        kind: 'score',
        table: b.tableName || k.split('|')[0] || 'SP12H',
        title: b.title,
        type: b.type,
        from: a.exScore ?? 0,
        to: b.exScore ?? 0,
        diff: d,
        rank: b.scoreTier || '-'
      });
    }
  });
  const goalEvents = [];
  (goals || []).forEach((g) => {
    if (!goalAchieved(g, prev) && goalAchieved(g, curr)) {
      goalEvents.push({
        kind: 'goal',
        table: g.table,
        title: g.title,
        type: g.chartType,
        text: `목표 달성: ${goalTableLabel(g.table)} ${g.title} [${g.chartType}] -> ${goalLabel(g)}`
      });
    }
  });
  return { updates: updates.slice(0, 300), goals: goalEvents.slice(0, 120) };
}

function renderAccountSelect() {
  const sel = $('accountSelect');
  sel.innerHTML = `${state.accounts.map((a) => `<option value="${esc(a.id)}">${esc(a.djName)} (${esc(a.infinitasId)})</option>`).join('')}<option value="__create__">계정 생성...</option>`;
  sel.value = state.activeAccountId && state.accounts.some((a) => a.id === state.activeAccountId) ? state.activeAccountId : '__create__';
  enhancedSelects.get('accountSelect')?.render?.();
}

function renderAccountInfo() {
  const a = activeAcc();
  const name = a?.djName || 'DJ NAME';
  const inf = a?.infinitasId || 'C-0000-0000-0000';
  const icon = iconSrc(a);
  $('accountHeroName').textContent = name;
  $('accountHeroId').textContent = inf;
  $('accountHeroIcon').src = icon;
  $('tableMiniName').textContent = name;
  $('tableMiniId').textContent = inf;
  $('tableMiniIcon').src = icon;
  $('trackerPathLabel').textContent = a ? `${a.djName}` : '계정 없음 (계정을 생성하세요)';
  renderAuthStatus();
  renderMedals();
}

function medalTierFor(tableName){
  const view = state.tableViews[tableName];
  const charts = view?.flatCharts || [];
  if (!charts.length) return '';
  const allPlayed = charts.every((c)=>c.clearStatus !== 'NOPLAY');
  if (!allPlayed) return '';
  if (charts.every((c)=>c.clearStatus === 'FC')) return 'F';
  if (charts.every((c)=>c.clearStatus === 'EXHARD' || c.clearStatus === 'FC')) return 'EX';
  if (charts.every((c)=>c.clearStatus === 'HARD' || c.clearStatus === 'EXHARD' || c.clearStatus === 'FC')) return 'HARD';
  return 'ALL';
}

function renderMedals(){
  const map = [
    ['SP10H', 'SP10', 'medal10', 'medalProgress10', 'medalProgressRing10', 'medalProgressText10', 'medalProgressCount10'],
    ['SP11H', 'SP11', 'medal11', 'medalProgress11', 'medalProgressRing11', 'medalProgressText11', 'medalProgressCount11'],
    ['SP12H', 'SP12', 'medal12', 'medalProgress12', 'medalProgressRing12', 'medalProgressText12', 'medalProgressCount12']
  ];
  map.forEach(([table,key,id,progressId,ringId,textId,countId])=>{
    const view = state.tableViews[table];
    const charts = view?.flatCharts || [];
    const total = charts.length;
    const played = charts.filter((c) => c.clearStatus !== 'NOPLAY').length;
    const locked = charts.filter((c) => c.clearStatus === 'NOPLAY' && c.isUnlocked === false).length;
    const unplayed = Math.max(0, total - played - locked);
    const pct = total > 0 ? Math.round((played / total) * 100) : 0;
    const tier = medalTierFor(table);
    const img = $(id);
    const progress = $(progressId);
    const ring = $(ringId);
    const text = $(textId);
    const count = $(countId);
    if (!tier) {
      img.classList.add('hidden');
      img.removeAttribute('src');
      progress.classList.remove('hidden');
      ring.style.setProperty('--played', `${total > 0 ? (played / total) * 100 : 0}%`);
      ring.style.setProperty('--unplayed', `${total > 0 ? (unplayed / total) * 100 : 0}%`);
      ring.style.setProperty('--locked', `${total > 0 ? (locked / total) * 100 : 0}%`);
      text.textContent = `${pct}%`;
      count.textContent = `${played}/${total}`;
      return;
    }
    img.src = MEDAL_SRC[key][tier];
    img.classList.remove('hidden');
    const labelMap = {
      ALL: `${key.replace('SP', 'SP ')} 전곡 플레이`,
      HARD: `${key.replace('SP', 'SP ')} 전곡 Hard Clear`,
      EX: `${key.replace('SP', 'SP ')} 전곡 EX Hard Clear`,
      F: `${key.replace('SP', 'SP ')} 전곡 Full Combo`
    };
    img.title = labelMap[tier] || `${key} ${tier}`;
    progress.classList.add('hidden');
  });
}

function sortItems(items) {
  const out = [...items];
  out.sort((x, y) => {
    const xu = x.isUnlocked === false ? 0 : 1;
    const yu = y.isUnlocked === false ? 0 : 1;
    if (xu !== yu) return yu - xu;
    if (xu === 0 && yu === 0) return x.title.localeCompare(y.title);
    if (state.sortMode === 'clear') {
      const byLamp = (CLEAR_SORT_ORDER[y.clearStatus] ?? 0) - (CLEAR_SORT_ORDER[x.clearStatus] ?? 0);
      if (byLamp !== 0) return byLamp;
    }
    return x.title.localeCompare(y.title);
  });
  return out;
}

function chunk(list, size) { const rows=[]; for (let i=0;i<list.length;i+=size) rows.push(list.slice(i,i+size)); return rows; }
function weight(s){let w=0; for(const c of s) w += /[ -~]/.test(c)?1:2; return w; }
function trunc(title, cols){ const max = cols>=8?18:24; if(weight(title)<=max) return title; let o='',w=0; for(const c of title){const cw=/[ -~]/.test(c)?1:2; if(w+cw>max-3)break; o+=c; w+=cw;} return `${o}...`; }
function folderLampTier(items){
  if(!items.length) return 'NOPLAY';
  const order = { NOPLAY: 0, FAILED: 1, EASY: 2, NORMAL: 3, HARD: 4, EXHARD: 5, FC: 6 };
  let minV = 999;
  let minK = 'NOPLAY';
  items.forEach((i)=>{
    const key = i.clearStatus || 'NOPLAY';
    const v = order[key] ?? 0;
    if (v < minV) {
      minV = v;
      minK = key;
    }
  });
  return minK;
}
function folderLampColor(tier){
  if (tier === 'FC') return '#63d7e8';
  if (tier === 'EXHARD') return '#f0ce00';
  if (tier === 'HARD') return '#f28a2f';
  if (tier === 'NORMAL') return '#88a0ce';
  if (tier === 'EASY') return '#98c56f';
  if (tier === 'FAILED') return '#8a8a8a';
  return 'transparent';
}

function btnClass(c){
  const cls=['song-button',`diff-${c.type}`];
  if(c.isUnlocked===false) cls.push('locked-song');
  if(c.lamp==='FC') cls.push('lamp-fc'); else if(c.lamp==='EX') cls.push('lamp-ex'); else if(c.lamp==='HC') cls.push('lamp-hc'); else if(c.lamp==='F') cls.push('lamp-failed');
  return cls.join(' ');
}

function renderGraphs(){
  const view = state.tableViews[state.activeTable];
  if(!view){ $('clearGraph').innerHTML=''; $('scoreGraph').innerHTML=''; return; }
  const clearOrder=['FC','EXHARD','HARD','NORMAL','EASY','ASSIST','FAILED','NOPLAY'];
  const clearColor={NOPLAY:'#e8e8e8',FAILED:'#a5a5a5',ASSIST:'#d6c4d1',EASY:'#98c56f',NORMAL:'#88a0ce',HARD:'#f45f5f',EXHARD:'#f0ce00',FC:'#63d7e8'};
  const clearCount=Object.fromEntries(clearOrder.map(k=>[k,0]));
  view.flatCharts.forEach((c)=>{clearCount[c.clearStatus]=(clearCount[c.clearStatus]??0)+1;});

  const scoreColor={NOPLAY:'#e8e8e8',B:'#ef7fb9',A:'#88a0ce',AA:'#79db61',AAA:'#f0ce00','MAX-':'#ffbd6f',MAX:'#ff8f65'};
  const scoreCount=Object.fromEntries(SCORE_GRAPH_ORDER.map(k=>[k,0]));
  view.flatCharts.forEach((c)=>{ if(!c.scoreTier) scoreCount.NOPLAY+=1; else if(SCORE_GRAPH_ORDER.includes(c.scoreTier)) scoreCount[c.scoreTier]+=1;});

  state.graphSummary = {
    clear: { order: clearOrder, count: clearCount },
    score: { order: SCORE_SUMMARY_ORDER, count: scoreCount }
  };
  const legendTextColor = (hex) => {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex || ''));
    if (!m) return '#102236';
    const r = parseInt(m[1], 16);
    const g = parseInt(m[2], 16);
    const b = parseInt(m[3], 16);
    const yiq = (r * 299 + g * 587 + b * 114) / 1000;
    return yiq >= 150 ? '#102236' : '#f7fbff';
  };
  const bar = (type, arr,total,palette)=>{
    const segOrder = type === 'clear' ? [...arr].reverse() : arr;
    const legendOrder = type === 'clear' ? [...arr].reverse() : arr;
    return `<div class="stack-track" data-graph="${type}">${segOrder.map((k)=>`<div class="stack-seg" data-graph="${type}" data-key="${esc(k)}" style="width:${(view.flatCharts.length?total[k]/view.flatCharts.length*100:0)}%;background:${palette[k]}"></div>`).join('')}</div><div class="legend-row">${legendOrder.map((k)=>`<span class="legend-item"><span class="legend-chip" data-graph="${type}" data-key="${esc(k)}" title="${esc(k)} ${total[k] ?? 0}" style="background:${palette[k]};color:${legendTextColor(palette[k])}">${total[k] ?? 0}</span></span>`).join('')}</div>`;
  };
  $('clearGraph').innerHTML=bar('clear', clearOrder,clearCount,clearColor);
  $('scoreGraph').innerHTML=bar('score', SCORE_GRAPH_ORDER,scoreCount,scoreColor);
}

function renderRankTable(){
  const container=$('rankTableContainer');
  const view=state.tableViews[state.activeTable];
  $('tableMark').textContent=state.activeTable;
  if(!view){ container.innerHTML='<div>서열표를 불러오는 중입니다...</div>'; $('tableTitle').textContent=state.activeTable; renderGraphs(); return; }
  $('tableTitle').textContent=normalizeRankTitle(view.title);
  const q=$('songSearch').value.trim().toLowerCase();
  const cols=state.viewMode==='wide'?8:6;
  const isUncategorized = (name) => /미정|미분류/i.test(String(name || '').trim());
  const sp10OrderValue = (name) => {
    const n = Number(String(name || '').trim());
    return Number.isFinite(n) ? n : null;
  };
  const orderedCategories = [...(view.categories || [])].sort((a, b) => {
    const aName = a?.name || '';
    const bName = b?.name || '';
    const aLast = isUncategorized(aName) ? 1 : 0;
    const bLast = isUncategorized(bName) ? 1 : 0;
    if (aLast !== bLast) return aLast - bLast;
    if (state.activeTable === 'SP10H') {
      const an = sp10OrderValue(aName);
      const bn = sp10OrderValue(bName);
      if (an !== null && bn !== null && an !== bn) return bn - an;
      if (an !== null && bn === null) return -1;
      if (an === null && bn !== null) return 1;
    }
    return Number(a?.sortindex || 0) - Number(b?.sortindex || 0);
  });
  container.innerHTML=orderedCategories.map((cat)=>{
    const allItems = cat.items || [];
    const items=sortItems(allItems).filter((i)=>i.title.toLowerCase().includes(q));
    if(!items.length) return '';
    const tier = folderLampTier(allItems);
    const tierColor = folderLampColor(tier);
    const rows=chunk(items,cols);
    return `<table class="category-table"><tbody>${rows.map((r,ri)=>`<tr>${ri===0?`<th class="category-label" style="--folder-lamp-color:${tierColor}" rowspan="${rows.length}" title="폴더 최저 램프: ${esc(tier)}">${esc(cat.name)}</th>`:''}${r.map((c)=>`<td class="song-cell"><button class="${btnClass(c)}" data-chart-key="${esc(c.key)}" title="${esc(c.title)}"><span class="song-title">${esc(trunc(c.title,cols))}</span>${c.scoreTier?`<span class="score-badge">${esc(c.scoreTier)}</span>`:''}</button></td>`).join('')}${Array.from({length:Math.max(0,cols-r.length)}).map(()=>'<td class="empty-cell"></td>').join('')}</tr>`).join('')}</tbody></table>`;
  }).join('');
  renderGraphs();
}

function renderHistory(){
  const acc = activeAcc();
  const list = $('historyList');
  const detail = $('historyDetail');
  if (!acc) {
    list.innerHTML = '<div class="history-item">계정을 먼저 생성하세요.</div>';
    detail.innerHTML = '<div class="history-item">히스토리 상세</div>';
    return;
  }
  const arr = [...(acc.history || [])].reverse();
  if (!arr.length) {
    list.innerHTML = '<div class="history-item">히스토리가 없습니다.</div>';
    detail.innerHTML = '<div class="history-item">데이터 업로드/갱신 기록이 이곳에 표시됩니다.</div>';
    return;
  }

  const latestId = arr[0]?.id || null;
  const hasSelected = !!state.selectedHistoryId && arr.some((h) => h.id === state.selectedHistoryId);
  const selected = arr.find((h) => h.id === state.selectedHistoryId) || null;
  const rollbackDisabled = !state.settings.enableHistoryRollback || !selected || selected.id === latestId;
  const socialEnabled = !!acc.googleAuthUserId;

  const historyItemsHtml = arr.map((h, idx) => {
    const isNew = !state.historySeenIds.has(h.id);
    const isInitial = h.isInitial === true || (Array.isArray(h.updates) && h.updates.length === 1 && String(h.updates[0]).includes('최초'));
    const isLatest = h.id === latestId;
    return `<div class="history-item ${h.id === state.selectedHistoryId ? 'active' : ''} ${isNew ? 'hist-new' : ''}" style="--i:${idx}">
      <div class="history-item-main history-item-select" data-history-id="${esc(h.id)}">
        <span>${esc(fmt(h.timestamp))}</span>
        ${isInitial ? '<span class="history-initial-tag">(최초)</span>' : ''}
        ${isLatest ? '<span class="history-latest-tag">(최신)</span>' : ''}
      </div>
      ${socialEnabled ? `<div class="history-item-sub"><button class="small-btn" data-history-compare-id="${esc(h.id)}">라이벌과 비교</button></div>` : ''}
    </div>`;
  }).join('');

  list.innerHTML = `<div class="history-list-scroll">${historyItemsHtml}</div>
    <div class="history-roll-wrap">
      <button id="btnHistoryRollback" class="small-btn ${rollbackDisabled ? 'disabled-btn' : ''}" ${rollbackDisabled ? 'disabled' : ''}>롤백</button>
    </div>`;

  arr.forEach((h) => state.historySeenIds.add(h.id));

  if (!hasSelected) {
    detail.innerHTML = '<div class="history-empty">왼쪽 히스토리를 선택하면 상세가 열립니다.</div>';
    return;
  }

  const p = arr.find((h) => h.id === state.selectedHistoryId);
  if (!p) {
    detail.innerHTML = '<div class="history-empty">상세 데이터를 찾을 수 없습니다.</div>';
    return;
  }

  const isInitialRecord = p.isInitial === true || (Array.isArray(p.updates) && p.updates.length === 1 && String(p.updates[0]).includes('최초'));
  if (isInitialRecord) {
    detail.innerHTML = `<div id="historyDetailCard" class="history-detail-card ${state.historyAnimateDetail ? 'animate' : ''}">
      <div><strong>${esc(fmt(p.timestamp))}</strong></div>
      <div class="history-empty" style="margin-top:10px;">최초 업로드 데이터입니다.</div>
    </div>`;
    state.historyAnimateDetail = false;
    return;
  }

  const updateEvents = Array.isArray(p.updates) ? p.updates : (Array.isArray(p.events) ? p.events : []);
  const goalEvents = Array.isArray(p.goals) ? p.goals : [];
  const selectedIdx = arr.findIndex((h) => h.id === p.id);
  const prev = selectedIdx >= 0 ? arr[selectedIdx + 1] : null;
  const radarEvents = buildRadarHistoryEvents(
    prev?.snapshotRows || [],
    p?.snapshotRows || [],
    prev?.snapshotProgress || null,
    p?.snapshotProgress || null
  );

  const lampStatusHtml = (s) => {
    const map = {
      NOPLAY: '#8a8a8a',
      FAILED: '#8a8a8a',
      ASSIST: '#c9b4c3',
      EASY: '#79b654',
      NORMAL: '#6f8fcb',
      HARD: '#f28a2f',
      EXHARD: '#e0b900',
      FC: '#3fc6dc',
      FULLCOMBO: '#3fc6dc'
    };
    return `<span style="font-weight:700;color:${map[s] || '#333'}">${esc(s)}</span>`;
  };

  const tableGroup = (items) => {
    const groups = { SP10H: [], SP11H: [], SP12H: [] };
    items.forEach((it) => {
      const t = it.table || 'SP12H';
      if (!groups[t]) groups[t] = [];
      groups[t].push(it);
    });
    return ['SP10H', 'SP11H', 'SP12H'].map((table) => {
      const label = table.replace('H', '');
      const rows = groups[table] || [];
      const body = rows.length
        ? `<ul>${rows.map((it) => `<li>${it.html}</li>`).join('')}</ul>`
        : '<div class="history-empty">없음</div>';
      return `<div class="history-table-group"><div class="history-table-title">${label}</div>${body}</div>`;
    }).join('');
  };

  const flatList = (items) => items.length
    ? `<ul>${items.map((it) => `<li>${it.html}</li>`).join('')}</ul>`
    : '<div class="history-empty">갱신된 항목이 없습니다.</div>';

  const normalizeUpdate = (raw) => {
    if (typeof raw === 'object' && raw && raw.kind) return raw;
    const text = String(raw || '');
    const old = text.match(/^(.*?) \[(.)\] 램프 (.*?) -> (.*?) \| EX (\d+) -> (\d+) \(([+-]?\d+)\)$/);
    if (old) {
      return [
        { kind: 'lamp', table: 'SP12H', title: old[1], type: old[2], from: old[3], to: old[4] },
        { kind: 'score', table: 'SP12H', title: old[1], type: old[2], from: Number(old[5]), to: Number(old[6]), diff: Number(old[7]), rank: '-' }
      ];
    }
    return [{ kind: 'text', table: 'SP12H', text }];
  };

  const flatUpdates = [];
  updateEvents.forEach((u) => {
    const normalized = normalizeUpdate(u);
    if (Array.isArray(normalized)) flatUpdates.push(...normalized);
    else flatUpdates.push(normalized);
  });

  const lampEvents = flatUpdates.filter((e) => e.kind === 'lamp').map((e) => ({
    table: e.table,
    html: `${esc(e.title)} [${esc(e.type)}] ${lampStatusHtml(e.from)} -> ${lampStatusHtml(e.to)}`
  }));
  const scoreEvents = flatUpdates.filter((e) => e.kind === 'score').map((e) => ({
    table: e.table,
    html: `${esc(e.title)} [${esc(e.type)}] ${esc(e.from)} -> ${esc(e.to)} <strong>(${(e.diff >= 0 ? '+' : '') + e.diff})</strong>`
  }));
  const miscEvents = flatUpdates.filter((e) => e.kind === 'text').map((e) => ({
    table: e.table || 'SP12H',
    html: esc(e.text || '')
  }));
  scoreEvents.push(...miscEvents);

  const goalItems = goalEvents.map((g) => {
    if (typeof g === 'object' && g?.kind === 'goal') {
      return { table: g.table || 'SP12H', html: esc(g.text || '') };
    }
    return { table: 'SP12H', html: esc(String(g || '')) };
  });

  const radarItems = radarEvents.map((r) => ({
    table: 'SP12H',
    html: esc(r.text || '')
  }));

  const sec = state.historySectionOpen;
  const panel = (key, title, items, simple = false) => {
    const countLabel = items.length ? `${items.length}` : '없음';
    const disabled = items.length === 0;
    const open = !!sec[key] && !disabled;
    const body = disabled
      ? '<div class="history-empty">갱신된 항목이 없습니다.</div>'
      : (simple ? flatList(items) : tableGroup(items));
    return `<div class="history-section">
      <button class="history-accordion-btn ${disabled ? 'disabled' : ''} ${open ? 'open' : ''}" data-history-section="${esc(key)}" ${disabled ? 'disabled' : ''}>
        <span>${esc(title)} (${countLabel})</span>
        <span class="history-chevron">▼</span>
      </button>
      <div class="history-accordion-panel ${open ? 'open' : ''}">${body}</div>
    </div>`;
  };

  detail.innerHTML = `<div id="historyDetailCard" class="history-detail-card ${state.historyAnimateDetail ? 'animate' : ''}">
    <div><strong>${esc(fmt(p.timestamp))}</strong></div>
    <div class="history-sections">
      ${panel('clear', '램프 갱신', lampEvents)}
      ${panel('ramp', '스코어 갱신', scoreEvents)}
      ${panel('goal', '목표 갱신', goalItems)}
      ${panel('radar', '노트 레이더 갱신', radarItems, true)}
    </div>
  </div>`;

  state.historyAnimateDetail = false;
}
function renderGoalCandidates(){
  const view = state.tableViews[$('goalTable').value];
  const search = (state.goalSongQuery || '').trim().toLowerCase();
  const songSel = $('goalSong');
  const prev = songSel.value;
  if (!view) {
    songSel.innerHTML = '';
    enhancedSelects.get('goalSong')?.render?.();
    return;
  }
  const titles = [...new Set(view.flatCharts.map((i) => i.title))]
    .filter((t) => t.toLowerCase().includes(search))
    .sort((a, b) => a.localeCompare(b));
  songSel.innerHTML = titles.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
  songSel.value = titles.includes(prev) ? prev : '';
  enhancedSelects.get('goalSong')?.render?.();
}

function renderGoals(){
  const acc=activeAcc();
  const list=$('goalList');
  if(!acc){ list.innerHTML='<div class="goal-item">계정을 먼저 생성하세요.</div>'; return; }
  if(!(acc.goals||[]).length){ list.innerHTML='<div class="goal-item">설정된 목표가 없습니다.</div>'; return; }
  const progress = progressMap();
  list.classList.add('animated');
  list.innerHTML=acc.goals.map((g, idx)=>{
    const view=state.tableViews[g.table];
    const chart=view?.flatCharts.find((i)=>titleKey(i.title)===titleKey(g.title)&&i.type===g.chartType);
    const done=goalAchieved(g, progress);
    let current = 'NOPLAY';
    if (g.kind === 'SCORE') current = `EX ${chart?.exScore ?? 0}`;
    else if (g.kind === 'RANK') current = chart?.scoreTier || 'NOPLAY';
    else current = chart?.clearStatus || 'NOPLAY';
    return `<div class="goal-item ${done?'goal-achieved':'goal-pending'}" style="--i:${idx}">
      <div class="goal-row">
        <div class="goal-meta">
          <span class="goal-main" title="${esc(`${goalTableLabel(g.table)} ${g.title} [${g.chartType}]`)}">${esc(goalTableLabel(g.table))} ${esc(g.title)} [${esc(g.chartType)}]</span>
          <span class="goal-pill">종류: ${esc(g.kind)}</span>
          <span class="goal-pill">목표: ${esc(goalLabel(g))}</span>
          <span class="goal-pill">현재: ${esc(current)}</span>
          <span class="goal-pill">출처: ${esc((g.source || '').trim() || acc.djName)}</span>
          <span class="goal-pill ${done?'goal-status-achieved':'goal-status-pending'}">${done?'달성':'진행중'}</span>
        </div>
        <button data-goal-id="${esc(g.id)}" class="small-btn btn-delete-goal">삭제</button>
      </div>
    </div>`;
  }).join('');
  decorateButtons(list);
}

function renderSettings() {
  const show = $('settingShowUpdateGoalCards');
  const rb = $('settingEnableHistoryRollback');
  const discoverability = $('settingDiscoverability');
  const socialSettingsBlock = $('socialSettingsBlock');
  if (show) show.checked = !!state.settings.showUpdateGoalCards;
  if (rb) rb.checked = !!state.settings.enableHistoryRollback;
  if (discoverability) discoverability.checked = state.settings.discoverability !== 'hidden';
  $('settingFollowPolicyManual').checked = state.settings.followPolicy === 'manual';
  $('settingFollowPolicyAuto').checked = state.settings.followPolicy === 'auto';
  $('settingFollowPolicyDisabled').checked = state.settings.followPolicy === 'disabled';
  $('settingRivalPolicyFollowers').checked = state.settings.rivalPolicy === 'followers';
  $('settingRivalPolicyAll').checked = state.settings.rivalPolicy === 'all';
  $('settingRivalPolicyDisabled').checked = state.settings.rivalPolicy === 'disabled';
  const picked = new Set(normalizeShareDataScope(state.settings.shareDataScope));
  $('settingShareAllData').checked = picked.has('all');
  $('settingShareGraphs').checked = picked.has('graphs');
  $('settingShareGoals').checked = picked.has('goals');
  $('settingShareHistory').checked = picked.has('history');
  $('settingShareNone').checked = picked.has('none');
  if (socialSettingsBlock) socialSettingsBlock.classList.toggle('hidden', !hasGoogleLinkedAccount());
  renderAuthStatus();
}

function normalizeSocialCheckboxState(triggerId = '') {
  const followIds = ['settingFollowPolicyManual', 'settingFollowPolicyAuto', 'settingFollowPolicyDisabled'];
  const rivalIds = ['settingRivalPolicyFollowers', 'settingRivalPolicyAll', 'settingRivalPolicyDisabled'];
  if (followIds.includes(triggerId)) {
    followIds.forEach((id) => {
      if (id !== triggerId) $(id).checked = false;
    });
    if (!followIds.some((id) => $(id).checked)) $('settingFollowPolicyManual').checked = true;
  }
  if (rivalIds.includes(triggerId)) {
    rivalIds.forEach((id) => {
      if (id !== triggerId) $(id).checked = false;
    });
    if (!rivalIds.some((id) => $(id).checked)) $('settingRivalPolicyFollowers').checked = true;
  }
  const all = $('settingShareAllData');
  const none = $('settingShareNone');
  const graphs = $('settingShareGraphs');
  const goals = $('settingShareGoals');
  const history = $('settingShareHistory');
  if (!all || !none || !graphs || !goals || !history) return;
  if (triggerId === 'settingShareAllData' && all.checked) {
    graphs.checked = true;
    goals.checked = true;
    history.checked = true;
    none.checked = false;
  }
  if (triggerId === 'settingShareNone' && none.checked) {
    all.checked = false;
    graphs.checked = false;
    goals.checked = false;
    history.checked = false;
  }
  if (['settingShareGraphs', 'settingShareGoals', 'settingShareHistory'].includes(triggerId) && (graphs.checked || goals.checked || history.checked)) {
    none.checked = false;
  }
  if (!graphs.checked && !goals.checked && !history.checked && !all.checked) {
    none.checked = true;
  }
  if (all.checked) {
    graphs.checked = true;
    goals.checked = true;
    history.checked = true;
  } else if (!(graphs.checked && goals.checked && history.checked)) {
    all.checked = false;
  }
}

function selectedShareScopeFromUi() {
  normalizeSocialCheckboxState();
  const values = [];
  if ($('settingShareAllData')?.checked) values.push('all');
  if ($('settingShareGraphs')?.checked) values.push('graphs');
  if ($('settingShareGoals')?.checked) values.push('goals');
  if ($('settingShareHistory')?.checked) values.push('history');
  if ($('settingShareNone')?.checked) values.push('none');
  return normalizeShareDataScope(values);
}

async function getLinkedSessionUserId() {
  const acc = activeAcc();
  if (!acc?.googleAuthUserId) return null;
  const client = getSupabaseClient();
  if (!client) return null;
  const session = (await client.auth.getSession()).data?.session;
  if (!session?.user?.id || session.user.id !== acc.googleAuthUserId) return null;
  return session.user.id;
}

async function refreshSocialOverview() {
  const client = getSupabaseClient();
  const uid = await getLinkedSessionUserId();
  if (!client || !uid) {
    socialOverviewRows = [];
    renderSocialPanel();
    return;
  }
  const { data, error } = await client.rpc('get_social_overview');
  if (error) {
    console.warn('[social-overview]', error.message || error);
    socialOverviewRows = [];
  } else {
    socialOverviewRows = Array.isArray(data) ? data : [];
  }
  renderSocialPanel();
}

function renderSocialPanel() {
  const acc = activeAcc();
  const summary = $('socialSummary');
  const requests = $('socialFollowRequests');
  if (!summary || !requests) return;
  const linked = !!acc?.googleAuthUserId;
  const settings = acc?.socialSettings || {
    discoverability: state.settings.discoverability,
    followPolicy: state.settings.followPolicy,
    shareDataScope: normalizeShareDataScope(state.settings.shareDataScope),
    rivalPolicy: state.settings.rivalPolicy
  };
  const rows = socialOverviewRows || [];
  const incomingPending = rows.filter((r) => r.relation_type === 'request_in' && r.status === 'pending');
  const outgoingPending = rows.filter((r) => r.relation_type === 'request_out' && r.status === 'pending');
  const follows = rows.filter((r) => r.relation_type === 'follow');
  const rivals = rows.filter((r) => r.relation_type === 'rival');
  summary.innerHTML = linked
    ? `<div><strong>${esc(acc.djName)}</strong> (${esc(acc.infinitasId)})</div>
       <div>검색 공개: ${settings.discoverability === 'searchable' ? '가능' : '불가'}</div>
       <div>팔로우 정책: ${settings.followPolicy === 'auto' ? '자동 허가' : settings.followPolicy === 'manual' ? '허가 필요' : '불가'}</div>
       <div>공유 범위: ${esc((settings.shareDataScope || []).join(', '))}</div>
       <div>라이벌 정책: ${settings.rivalPolicy === 'all' ? '모두' : settings.rivalPolicy === 'followers' ? '팔로우만' : '불가'}</div>
       <div>팔로우 ${follows.length}/${FOLLOW_LIMIT}, 라이벌 ${rivals.length}/${RIVAL_LIMIT}</div>
       <div>${socialSearchTarget ? `검색 선택: ${esc(socialSearchTarget.dj_name)} (${esc(socialSearchTarget.infinitas_id)})` : '검색 대상 미선택'}</div>`
    : '<div>Google 연동 계정에서 소셜 기능을 사용할 수 있습니다.</div>';
  const item = (row, actions = '') => `<div class="history-item">
    <div class="history-item-main">${esc(row.dj_name || 'UNKNOWN')} (${esc(row.infinitas_id || '')})</div>
    <div class="history-item-sub">${esc(row.relation_type)} / ${esc(row.status || '-')}</div>
    ${actions}
  </div>`;
  requests.innerHTML = `
    <div class="history-item">팔로우 최대 ${FOLLOW_LIMIT}명 / 라이벌 최대 ${RIVAL_LIMIT}명</div>
    <div class="history-item-main">받은 요청</div>
    ${incomingPending.length ? incomingPending.map((r) => item(r, `<div class="dialog-actions"><button class="small-btn" data-follow-accept="${esc(r.request_id)}">허가</button><button class="small-btn" data-follow-reject="${esc(r.request_id)}">거부</button></div>`)).join('') : '<div class="history-empty">없음</div>'}
    <div class="history-item-main">보낸 요청</div>
    ${outgoingPending.length ? outgoingPending.map((r) => item(r)).join('') : '<div class="history-empty">없음</div>'}
    <div class="history-item-main">팔로우</div>
    ${follows.length ? follows.map((r) => item(r)).join('') : '<div class="history-empty">없음</div>'}
    <div class="history-item-main">라이벌</div>
    ${rivals.length ? rivals.map((r) => item(r)).join('') : '<div class="history-empty">없음</div>'}
  `;
}

function clearRefluxGoalCards() {
  state.refluxGoalCards = [];
  state.refluxFocusGoalId = null;
  if (state.refluxFocusTimer) {
    clearTimeout(state.refluxFocusTimer);
    state.refluxFocusTimer = null;
  }
  $('refluxGoalCardsTrack').innerHTML = '';
  $('refluxGoalCardsFocus').innerHTML = '';
  $('refluxGoalCardsZone').classList.add('hidden');
  state.refluxTrackerPrimed = false;
}

function setRefluxFocusGoal(goalId) {
  state.refluxFocusGoalId = goalId || null;
  if (state.refluxFocusTimer) clearTimeout(state.refluxFocusTimer);
  if (goalId) {
    state.refluxFocusTimer = setTimeout(() => {
      state.refluxFocusGoalId = null;
      renderRefluxGoalCards();
    }, 3000);
  } else {
    state.refluxFocusTimer = null;
  }
}

function renderRefluxGoalCards() {
  const zone = $('refluxGoalCardsZone');
  const track = $('refluxGoalCardsTrack');
  const focus = $('refluxGoalCardsFocus');
  if (!zone || !track || !focus) return;
  const cards = state.refluxGoalCards || [];
  if (!state.refluxRunning || !state.settings.showUpdateGoalCards || !cards.length) {
    zone.classList.add('hidden');
    track.innerHTML = '';
    focus.innerHTML = '';
    return;
  }
  zone.classList.remove('hidden');
  const cardHtml = (c) => `<div class="reflux-goal-card ${c.achieved ? 'achieved' : ''}">
    <div class="reflux-goal-head">${esc(c.title)}</div>
    <div class="reflux-goal-sub">종류: ${esc(c.kind)}</div>
    <div class="reflux-goal-sub">목표: ${esc(goalLabel(c))}</div>
    <div class="reflux-goal-sub">출처: ${esc((c.source || '').trim() || activeAcc()?.djName || '')}</div>
    <div class="reflux-goal-sub">달성 현황: ${c.achieved ? '달성' : '진행중'}</div>
  </div>`;
  const baseCards = cards.map(cardHtml).join('');
  if (cards.length >= 3) {
    const minCards = 10;
    const repeat = Math.max(2, Math.ceil(minCards / cards.length));
    const repeated = Array.from({ length: repeat }, () => baseCards).join('');
    track.className = 'mode-marquee';
    track.innerHTML = `<div class="marquee-clone">${repeated}</div><div class="marquee-clone">${repeated}</div>`;
  } else {
    track.className = 'mode-fixed';
    track.innerHTML = baseCards;
  }
  const focused = cards.find((c) => c.id === state.refluxFocusGoalId);
  focus.innerHTML = focused ? cardHtml(focused) : '';
}

function initRefluxGoalCardsSession() {
  const acc = activeAcc();
  if (!acc || !state.settings.showUpdateGoalCards) {
    clearRefluxGoalCards();
    return;
  }
  const progress = progressMap();
  const pending = (acc.goals || []).filter((g) => !goalAchieved(g, progress));
  state.refluxGoalCards = pending.map((g) => ({
    ...g,
    achieved: false,
    lastLamp: progress[`${g.table}|${titleKey(g.title)}|${g.chartType}`]?.clearStatus || 'NOPLAY',
    lastScore: progress[`${g.table}|${titleKey(g.title)}|${g.chartType}`]?.exScore || 0
  }));
  state.refluxFocusGoalId = null;
  state.refluxTrackerPrimed = false;
  renderRefluxGoalCards();
}

function updateRefluxGoalCardsFromTracker(content) {
  if (!state.settings.showUpdateGoalCards || !state.refluxGoalCards.length) return;
  const rows = parseTsv(content || '');
  const indexes = buildRowIndex(rows);
  let focusedId = null;
  let achievedFocusedId = null;
  for (const card of state.refluxGoalCards) {
    const row = findRowByTitle(indexes, card.title);
    const stats = rowStats(row, card.chartType);
    const prevLamp = card.lastLamp;
    const prevScore = card.lastScore;
    card.lastLamp = stats.clearStatus;
    card.lastScore = stats.exScore ?? 0;
    const pseudoProgress = {
      [`${card.table}|${titleKey(card.title)}|${card.chartType}`]: {
        lamp: stats.lamp,
        clearStatus: stats.clearStatus,
        exScore: stats.exScore ?? 0,
        scoreTier: stats.scoreTier || '',
        title: card.title,
        type: card.chartType,
        tableName: card.table
      }
    };
    const achievedNow = goalAchieved(card, pseudoProgress);
    if (achievedNow && !card.achieved) card.achieved = true;
    if (prevLamp !== card.lastLamp || prevScore !== card.lastScore) {
      focusedId = card.id;
      if (achievedNow) achievedFocusedId = card.id;
    }
  }
  if (state.refluxTrackerPrimed) {
    if (achievedFocusedId) setRefluxFocusGoal(achievedFocusedId);
    else if (focusedId) setRefluxFocusGoal(focusedId);
  } else {
    state.refluxTrackerPrimed = true;
  }
  renderRefluxGoalCards();
}
function hideSongPopup(){ $('songPopup').classList.add('hidden'); }
function hideGraphPopup(){ $('graphPopup').classList.add('hidden'); }
function showGraphPopup(title, html, e){
  const p=$('graphPopup');
  $('graphPopupTitle').textContent = title;
  $('graphPopupMeta').innerHTML = html;
  p.classList.remove('hidden'); p.style.left='0px'; p.style.top='0px';
  const r=p.getBoundingClientRect();
  let left=e.clientX+12, top=e.clientY+12; const m=10;
  if(left+r.width+m>window.innerWidth) left=window.innerWidth-r.width-m;
  if(top+r.height+m>window.innerHeight) top=window.innerHeight-r.height-m;
  p.style.left=`${Math.max(m,left)}px`; p.style.top=`${Math.max(m,top)}px`;
}
function showGraphFull(type, e){
  const summary = state.graphSummary[type];
  if (!summary) return;
  $('graphPopup').classList.remove('compact');
  const lines = summary.order.map((k)=>`<div>${esc(k)}: ${summary.count[k] ?? 0}</div>`).join('');
  showGraphPopup(type === 'clear' ? 'CLEAR 요약' : 'SCORE 요약', lines, e);
}

function collectMissingMetaSongsByTable() {
  const tables = ['SP11H', 'SP12H'];
  const out = {};
  tables.forEach((table) => {
    const view = state.tableViews[table];
    if (!view) return;
    const list = view.flatCharts
      .filter((c) => !String(c.bpm || '').trim() && !Number(c.metaNotes || 0) && !Number(c.noteCount || 0) && !String(c.metaType || '').trim() && !Number(c.cpiHc || 0) && !Number(c.cpiEx || 0))
      .map((c) => `${c.title} [${c.type}]`);
    if (list.length) out[table] = [...new Set(list)].sort((a, b) => a.localeCompare(b));
  });
  return out;
}

function showMissingMetaDialog() {
  const byTable = collectMissingMetaSongsByTable();
  const total = Object.values(byTable).reduce((n, arr) => n + arr.length, 0);
  if (!total) return;
  const dialog = $('missingMetaDialog');
  const body = $('missingMetaBody');
  if (!dialog || !body) return;
  const sections = Object.entries(byTable).map(([table, songs]) => {
    return `<h4>${esc(table)} (${songs.length})</h4><div class="missing-song-list">${esc(songs.join(', '))}</div>`;
  }).join('<hr />');
  body.innerHTML = `<strong>정보가 부족한 곡 (${total})</strong><div>참조 링크(beatmania.app / 나무위키 / atwiki) + tracker note count까지 포함해도 BPM/notes/Type/CPI 정보가 없는 곡만 표시됩니다.</div><hr />${sections}`;
  if (!dialog.open) dialog.showModal();
}

function openHelpDialog() {
  const dialog = $('helpDialog');
  if (!dialog) return;
  if (dialog.open) return;
  dialog.showModal();
}

function openSettingsDialog() {
  const dialog = $('settingsDialog');
  if (!dialog) return;
  renderSettings();
  if (!dialog.open) dialog.showModal();
}

function hideRadarAxisPopup() {
  const pop = $('radarAxisPopup');
  if (!pop) return;
  pop.classList.add('hidden');
}

function showRadarAxisPopup(axisRaw, anchorEl) {
  const pop = $('radarAxisPopup');
  const host = $('accountRadarDialogBody');
  if (!pop) return;
  const axis = String(axisRaw || '').toUpperCase();
  const rows = state.radarDialogProfile?.rankings?.[axis] || [];
  const listHtml = rows.length
    ? rows.map((x, idx) => `<div class="radar-axis-popup-row"><span class="rank-no">${idx + 1}</span><span class="rank-title">${esc(x.title || '-')}</span><span class="rank-value">${Number(x.value || 0).toFixed(2)}</span></div>`).join('')
    : '<div class="history-empty">NO DATA</div>';
  pop.innerHTML = `<div class="radar-axis-popup-head"><span class="axis-chip axis-${axis.toLowerCase()}">${radarAxisDisplayName(axis)}</span><span class="rank-head-text">TOP 10 USED FOR AVERAGE</span></div><div class="radar-axis-popup-list">${listHtml}</div>`;
  pop.classList.remove('hidden');
  const anchorRect = anchorEl?.getBoundingClientRect?.();
  const hostRect = host?.getBoundingClientRect?.();
  const m = 8;
  const rect = pop.getBoundingClientRect();
  let left = anchorRect && hostRect
    ? (anchorRect.left - hostRect.left) + anchorRect.width + 8
    : 12;
  let top = anchorRect && hostRect
    ? (anchorRect.top - hostRect.top) - 6
    : 12;
  if (hostRect) {
    const maxLeft = Math.max(m, hostRect.width - rect.width - m);
    const maxTop = Math.max(m, hostRect.height - rect.height - m);
    if (left > maxLeft && anchorRect) left = Math.max(m, (anchorRect.left - hostRect.left) - rect.width - 8);
    if (left > maxLeft) left = maxLeft;
    if (top > maxTop) top = maxTop;
    if (top < m) top = m;
  }
  pop.style.left = `${Math.round(left)}px`;
  pop.style.top = `${Math.round(top)}px`;
}

function openRadarDialog() {
  const body = $('accountRadarDialogBody');
  if (body) body.innerHTML = buildAccountRadarHtml({ stacked: true });
  hideRadarAxisPopup();
  const dialog = $('radarDialog');
  if (!dialog) return;
  if (!dialog.open) dialog.showModal();
}

async function linkGoogleAccount() {
  const acc = activeAcc();
  if (!acc) {
    toast('먼저 계정을 선택하세요.', 'error');
    return;
  }
  if (!isValidInfinitasId(acc.infinitasId)) {
    toast('Google 연동은 정상 INFINITAS ID(C-XXXX-XXXX-XXXX) 계정에서만 가능합니다.', 'error');
    return;
  }
  const client = getSupabaseClient();
  if (!client) {
    toast('Supabase 클라이언트를 초기화하지 못했습니다.', 'error');
    return;
  }
  const redirectTo = OAUTH_REDIRECT_URL;
  if (!redirectTo) {
    toast('OAuth Redirect URL 설정이 비어 있습니다.', 'error');
    return;
  }
  let oauthData;
  try {
    const { data, error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: {
        skipBrowserRedirect: true,
        redirectTo,
        queryParams: { prompt: 'select_account' }
      }
    });
    if (error) throw error;
    oauthData = data;
  } catch (e) {
    toast(`Google OAuth URL 생성 실패: ${e.message}`, 'error');
    return;
  }
  if (!oauthData?.url) {
    toast('Google 로그인 URL을 생성하지 못했습니다.', 'error');
    return;
  }
  const popupResult = await window.electronAPI.openOauthPopup({
    url: oauthData.url,
    successPrefix: redirectTo
  });
  if (!popupResult?.ok || !popupResult?.finalUrl) {
    if (popupResult?.canceled) toast('Google 연동을 취소했습니다.', 'info');
    else toast(`Google 연동 실패: ${popupResult?.error || '알 수 없는 오류'}`, 'error');
    return;
  }
  let resultUrl;
  try {
    resultUrl = new URL(popupResult.finalUrl);
  } catch {
    toast('OAuth 콜백 URL 파싱에 실패했습니다.', 'error');
    return;
  }

  const hashParams = new URLSearchParams((resultUrl.hash || '').replace(/^#/, ''));
  const errorCode = resultUrl.searchParams.get('error') || hashParams.get('error') || '';
  const errorDesc = resultUrl.searchParams.get('error_description') || hashParams.get('error_description') || '';
  if (errorCode) {
    const msg = decodeURIComponent(errorDesc || errorCode).replace(/\+/g, ' ');
    toast(`Google OAuth 실패: ${msg}`, 'error');
    return;
  }
  const accessToken = hashParams.get('access_token');
  const refreshToken = hashParams.get('refresh_token');
  let exchanged;
  if (accessToken && refreshToken) {
    try {
      exchanged = await client.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken
      });
    } catch (e) {
      toast(`세션 교환 실패: ${e.message}`, 'error');
      return;
    }
  } else {
    const code = resultUrl.searchParams.get('code');
    if (!code) {
      console.warn('[auth] OAuth callback without code/token:', popupResult.finalUrl);
      toast('OAuth 인증 코드를 찾지 못했습니다.', 'error');
      return;
    }
    try {
      exchanged = await client.auth.exchangeCodeForSession(code);
    } catch (e) {
      toast(`세션 교환 실패: ${e.message}`, 'error');
      return;
    }
  }
  if (exchanged.error) {
    toast(`세션 교환 실패: ${exchanged.error.message}`, 'error');
    return;
  }
  const sessionFallback = (await client.auth.getSession()).data?.session || null;
  const user = exchanged.data?.user || sessionFallback?.user || (await client.auth.getUser()).data?.user;
  if (!user) {
    toast('로그인 사용자 정보를 찾지 못했습니다.', 'error');
    return;
  }
  if (acc.googleAuthUserId && acc.googleAuthUserId !== user.id) {
    await client.auth.signOut();
    toast('현재 계정은 이미 다른 Google 계정에 연동되어 있습니다.', 'error');
    return;
  }

  const conflict = state.accounts.find((a) => a.id !== acc.id && a.googleAuthUserId && a.googleAuthUserId === user.id);
  if (conflict) {
    await client.auth.signOut();
    toast(`이미 다른 계정(${conflict.djName})에 연동된 Google 계정입니다.`, 'error');
    return;
  }

  acc.googleAuthUserId = user.id;
  acc.googleEmail = user.email || '';
  acc.googleLinkedAt = nowIso();
  authContext.set({ status: 'signed_in', user, session: exchanged.data?.session || sessionFallback || null, accountId: acc.id });
  await saveState();
  try {
    await syncLinkedAccountToCloud('google-link');
  } catch (e) {
    toast(`Google 연동은 되었지만 클라우드 저장 실패: ${e.message}`, 'warning');
    renderAuthStatus();
    renderSocialVisibility();
    renderSettings();
    return;
  }
  renderAuthStatus();
  renderSocialVisibility();
  renderSettings();
  await refreshSocialOverview();
  toast('Google 연동 및 클라우드 저장이 완료되었습니다.', 'success');
}
function showGraphSingle(type, key, e){
  const summary = state.graphSummary[type];
  if (!summary) return;
  $('graphPopup').classList.add('compact');
  showGraphPopup(type === 'clear' ? 'CLEAR' : 'SCORE', `<div>${esc(key)}: ${summary.count[key] ?? 0}</div>`, e);
}

async function openChallengeDialog(metaText) {
  const dialog = $('challengeDialog');
  const form = $('challengeForm');
  const lamp = $('challengeLamp');
  const score = $('challengeScore');
  const meta = $('challengeDialogMeta');
  const cancelBtn = $('challengeCancelBtn');
  if (!dialog || !form || !lamp || !score || !meta || !cancelBtn) return null;
  meta.textContent = metaText;
  lamp.checked = true;
  score.checked = true;
  if (dialog.open) dialog.close('cancel');
  const onCancel = () => dialog.close('cancel');
  const onSubmit = (ev) => {
    ev.preventDefault();
    if (!lamp.checked && !score.checked) {
      toast('램프 또는 스코어 중 하나 이상 선택하세요.', 'warning');
      return;
    }
    dialog.close('send');
  };
  cancelBtn.addEventListener('click', onCancel);
  form.addEventListener('submit', onSubmit);
  dialog.showModal();
  return new Promise((resolve) => {
    const onClose = () => {
      dialog.removeEventListener('close', onClose);
      cancelBtn.removeEventListener('click', onCancel);
      form.removeEventListener('submit', onSubmit);
      if (dialog.returnValue !== 'send') {
        resolve(null);
        return;
      }
      if (lamp.checked && score.checked) resolve('both');
      else if (lamp.checked) resolve('lamp');
      else resolve('score');
    };
    dialog.addEventListener('close', onClose);
  });
}

async function sendChallengeToUser(receiverUserId, source, songTitle, chartType, challengeType) {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase client unavailable');
  const { data, error } = await client.rpc('send_challenge', {
    p_receiver_user_id: receiverUserId,
    p_source: source,
    p_song_title: songTitle,
    p_chart_type: chartType,
    p_challenge_type: challengeType,
    p_parent_challenge_id: null
  });
  if (error) throw error;
  return data;
}

async function fetchSongSocialContext(chart) {
  const acc = activeAcc();
  if (!acc?.googleAuthUserId) return [];
  const client = getSupabaseClient();
  if (!client) return [];
  const session = (await client.auth.getSession()).data?.session;
  if (!session?.user?.id || session.user.id !== acc.googleAuthUserId) return [];
  const { data, error } = await client.rpc('get_song_social_context', {
    p_title: chart.title,
    p_chart_type: chart.type
  });
  if (error) {
    console.warn('[song-social]', error.message || error);
    return [];
  }
  return Array.isArray(data) ? data : [];
}

async function fetchRivalOverviewContext() {
  const acc = activeAcc();
  if (!acc?.googleAuthUserId) return [];
  const client = getSupabaseClient();
  if (!client) return [];
  const session = (await client.auth.getSession()).data?.session;
  if (!session?.user?.id || session.user.id !== acc.googleAuthUserId) return [];
  const { data, error } = await client.rpc('get_rival_overview_context');
  if (error) {
    console.warn('[history-rival]', error.message || error);
    return [];
  }
  return Array.isArray(data) ? data : [];
}

async function showHistoryRivalPopup(historyId, e) {
  const p = $('songPopup');
  const rows = await fetchRivalOverviewContext();
  $('popupTitle').textContent = `히스토리 라이벌 비교 (${esc(historyId)})`;
  if (!rows.length) {
    $('popupMeta').innerHTML = '<div class="history-empty">표시할 라이벌이 없습니다.</div>';
  } else {
    $('popupMeta').innerHTML = rows.map((row) => `
      <div class="goal-item">
        <div class="goal-row">
          <div class="goal-meta">
            <span class="goal-main">${esc(row.dj_name || 'UNKNOWN')}</span>
            <span class="goal-pill">${esc(row.infinitas_id || '')}</span>
          </div>
          <button type="button" class="small-btn btn-history-challenge" data-user-id="${esc(row.peer_user_id)}" data-history-id="${esc(historyId)}" data-user-name="${esc(row.dj_name || '')}">도전장</button>
        </div>
      </div>
    `).join('');
  }
  p.classList.remove('hidden');
  p.style.left = '0px';
  p.style.top = '0px';
  const r = p.getBoundingClientRect();
  let left = e.clientX + 12, top = e.clientY + 12; const m = 10;
  if (left + r.width + m > window.innerWidth) left = window.innerWidth - r.width - m;
  if (top + r.height + m > window.innerHeight) top = window.innerHeight - r.height - m;
  p.style.left = `${Math.max(m, left)}px`;
  p.style.top = `${Math.max(m, top)}px`;
}

function songSocialSectionHtml(kind, rows, chart) {
  const title = kind === 'rival' ? '라이벌 영역' : '팔로우 영역';
  const filtered = rows.filter((x) => x.kind === kind);
  if (!filtered.length) {
    return `<div><strong>${title}</strong><div class="history-empty">표시할 데이터가 없습니다.</div></div>`;
  }
  const list = filtered.map((row) => {
    const lamp = row.lamp || 'NP';
    const ex = Number(row.ex_score || 0);
    const btn = kind === 'rival' && row.can_challenge
      ? `<button type="button" class="small-btn btn-song-challenge" data-user-id="${esc(row.peer_user_id)}" data-song-title="${esc(chart.title)}" data-chart-type="${esc(chart.type)}" data-user-name="${esc(row.dj_name || '')}">도전장</button>`
      : '';
    return `<div class="goal-item">
      <div class="goal-row">
        <div class="goal-meta">
          <span class="goal-main">${esc(row.dj_name || 'UNKNOWN')}</span>
          <span class="goal-pill">${esc(row.infinitas_id || '')}</span>
          <span class="goal-pill">램프: ${esc(lamp)}</span>
          <span class="goal-pill">스코어: ${ex}</span>
        </div>
        ${btn}
      </div>
    </div>`;
  }).join('');
  return `<div><strong>${title}</strong>${list}</div>`;
}

async function showSongPopup(chart,e){
  const p=$('songPopup');
  $('popupTitle').textContent=`${chart.title} [${chart.type}]`;
  const bpmText = chart.bpm ? esc(chart.bpm) : '-';
  const metaNotes = Number(chart.metaNotes || 0) > 0 ? Number(chart.metaNotes) : '-';
  const typeText = chart.metaType ? esc(chart.metaType) : '-';
  const cpiHcText = Number(chart.cpiHc || 0) > 0 ? Number(chart.cpiHc).toFixed(2) : '-';
  const cpiExText = Number(chart.cpiEx || 0) > 0 ? Number(chart.cpiEx).toFixed(2) : '-';
  const infoHtml = `<div>BPM: ${bpmText} | notes: ${metaNotes} | Type: ${typeText} | CPI(HC): ${cpiHcText} | CPI(EX): ${cpiExText}</div>`;
  const playHtml = `<div>Lamp: ${esc(chart.clearStatus)} | Score Rank: ${esc(chart.scoreTier||'-')}</div><div>EX SCORE: ${chart.exScore} | MISS: ${chart.missCount}</div><div>RATE: ${chart.rate.toFixed(2)}%</div>`;
  const radarData = normalizeRadarData(chart.radar);
  const dominantAxis = chart.radarTop || (radarData ? dominantRadarAxis(radarData) : '');
  const radarHtml = radarData
    ? radarSvgHtml(radarData, { dominantAxis })
    : `<div class="radar-wrap"><div class="radar-nodata">NO DATA</div></div>`;
  const baseHtml = `${radarHtml}<hr />${infoHtml}<hr />${playHtml}`;
  let socialHtml = '';
  try {
    const rows = await fetchSongSocialContext(chart);
    if (rows.length) {
      socialHtml = `<hr />${songSocialSectionHtml('follow', rows, chart)}<hr />${songSocialSectionHtml('rival', rows, chart)}`;
    }
  } catch {
    // ignore
  }
  $('popupMeta').innerHTML = `${baseHtml}${socialHtml}`;
  p.classList.remove('hidden'); p.style.left='0px'; p.style.top='0px';
  const r=p.getBoundingClientRect();
  let left=e.clientX+12, top=e.clientY+12; const m=10;
  if(left+r.width+m>window.innerWidth) left=window.innerWidth-r.width-m;
  if(top+r.height+m>window.innerHeight) top=window.innerHeight-r.height-m;
  p.style.left=`${Math.max(m,left)}px`; p.style.top=`${Math.max(m,top)}px`;
}

async function saveState(){
  await window.electronAPI.writeState({
    version: 3,
    accounts: state.accounts,
    activeAccountId: state.activeAccountId,
    refluxExePath: state.refluxExePath || '',
    settings: state.settings
  });
  queueCloudSync('state-save');
}

async function syncTrackerToRefluxRuntime() {
  const acc = activeAcc();
  if (!acc || !state.refluxExePath) return;
  try {
    await window.electronAPI.writeAdjacentTracker({
      exePath: state.refluxExePath,
      content: rowsToTsv(acc.trackerRows || [])
    });
  } catch {
    // ignore runtime sync failure
  }
}

function renderSocialVisibility() {
  const enabled = hasGoogleLinkedAccount();
  document.querySelectorAll('.main-tab[data-panel="social"]').forEach((el) => {
    el.classList.toggle('hidden', !enabled);
  });
  document.querySelectorAll('.dock-tab[data-panel="social"]').forEach((el) => {
    const dockItem = el.closest('.dock-item');
    if (dockItem) dockItem.classList.toggle('hidden', !enabled);
    else el.classList.toggle('hidden', !enabled);
  });
  $('panel-social')?.classList.toggle('hidden', !enabled);
  $('socialSettingsBlock')?.classList.toggle('hidden', !enabled);
}

function setActivePanel(nextPanel) {
  let panel = nextPanel || 'rank';
  if (panel === 'settings') {
    openSettingsDialog();
    return;
  }
  if (panel === 'social' && !hasGoogleLinkedAccount()) panel = 'rank';
  document.querySelectorAll('.main-tab, .dock-tab').forEach((x) => x.classList.remove('active'));
  document.querySelectorAll(`.main-tab[data-panel="${panel}"], .dock-tab[data-panel="${panel}"]`).forEach((x) => x.classList.add('active'));
  state.activePanel = panel;
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
  $(`panel-${panel}`)?.classList.add('active');
  if (panel === 'social') {
    refreshSocialOverview().catch(() => {
      // ignore
    });
  }
}

function refreshAll() {
  buildViews();
  renderAccountSelect();
  renderAccountInfo();
  renderRankTable();
  renderHistory();
  renderGoalCandidates();
  renderGoals();
  renderSocialVisibility();
  renderSettings();
  renderSocialPanel();
  setActivePanel(state.activePanel || 'rank');
  decorateButtons();
}

function bindDraggable(widgetId) {
  const widget = $(widgetId);
  const handle = widget?.querySelector('.widget-drag-handle');
  if (!widget || !handle) return;
  let dragging = false;
  let sx = 0;
  let sy = 0;
  let startLeft = 0;
  let startTop = 0;
  const move = (e) => {
    if (!dragging) return;
    const dx = e.clientX - sx;
    const dy = e.clientY - sy;
    const left = Math.min(window.innerWidth - widget.offsetWidth - 8, Math.max(8, startLeft + dx));
    const top = Math.min(window.innerHeight - widget.offsetHeight - 8, Math.max(8, startTop + dy));
    widget.style.left = `${left}px`;
    widget.style.top = `${top}px`;
    widget.style.right = 'auto';
    widget.style.bottom = 'auto';
  };
  const up = () => {
    dragging = false;
    document.removeEventListener('mousemove', move);
    document.removeEventListener('mouseup', up);
  };
  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const rect = widget.getBoundingClientRect();
    dragging = true;
    sx = e.clientX;
    sy = e.clientY;
    startLeft = rect.left;
    startTop = rect.top;
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });
}

function initEnhancedSelects() {
  mountBasicSelect('accountSelect');
  mountBasicSelect('goalKind');
  mountBasicSelect('goalTable');
  mountBasicSelect('goalChartType');
  mountBasicSelect('goalLamp');
  mountBasicSelect('goalRank');
  mountSearchSelect('goalSong', 'goalSongComboHost', { placeholder: '곡명 검색' });
}

function readFileAsDataUrl(file){ return new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result?.toString()||''); r.onerror=rej; r.readAsDataURL(file);}); }

async function openAccountDialog({title,allowCancel,initial}){
  const dialog=$('accountDialog'); const form=$('accountForm'); const nameInput=$('accountNameInput'); const idInput=$('accountIdInput'); const idPreview=$('accountIdPreview'); const iconInput=$('accountIconInput'); const cancelBtn=$('accountCancelBtn');
  if (dialog.open) dialog.close('cancel');
  $('accountDialogTitle').textContent=title; $('accountCancelBtn').style.display=allowCancel?'inline-block':'none';
  nameInput.value=initial?.djName || ''; idInput.value=initial?.infinitasId || ''; idPreview.textContent=fmtInfFixed(idInput.value); iconInput.value='';
  let iconDataUrl=initial?.iconDataUrl || '';
  const onId=()=>{ idInput.value=fmtInf(idInput.value); idPreview.textContent=fmtInfFixed(idInput.value); };
  const onIcon=async()=>{ const f=iconInput.files?.[0]; if(!f){iconDataUrl=''; return;} try{iconDataUrl=await readFileAsDataUrl(f);}catch{iconDataUrl=''; toast('아이콘 파일을 읽지 못했습니다.');} };
  const onCancel=()=>dialog.close('cancel');
  const onSubmit=(e)=>{ e.preventDefault(); dialog.close('save'); };
  const onDialogCancel=(e)=>{ if(!allowCancel){ e.preventDefault(); } };
  idInput.addEventListener('input',onId); iconInput.addEventListener('change',onIcon);
  cancelBtn.addEventListener('click', onCancel);
  form.addEventListener('submit', onSubmit);
  dialog.addEventListener('cancel', onDialogCancel);
  dialog.showModal();
  requestAnimationFrame(() => nameInput.focus());
  const result = await new Promise((resolve)=>{
    const onClose=()=>{ dialog.removeEventListener('close',onClose); idInput.removeEventListener('input',onId); iconInput.removeEventListener('change',onIcon);
      cancelBtn.removeEventListener('click', onCancel); form.removeEventListener('submit', onSubmit);
      dialog.removeEventListener('cancel', onDialogCancel);
      if(dialog.returnValue==='cancel'){resolve(null); return;}
      const dj=nameInput.value.trim(); if(!dj){ toast('DJ NAME은 필수입니다.'); resolve('retry'); return; }
      resolve({djName:dj, infinitasId:fmtInfFixed(idInput.value), iconDataUrl});
    }; dialog.addEventListener('close',onClose);
  });
  if(result==='retry') return openAccountDialog({title,allowCancel,initial});
  return result;
}

async function createAccountFlow(allowCancel=true){
  if(state.accounts.length>=MAX_ACCOUNTS){ toast(`계정은 최대 ${MAX_ACCOUNTS}개까지 생성할 수 있습니다.`); return false; }
  const r=await openAccountDialog({title:'계정 생성',allowCancel,initial:null});
  if(!r){ if(!allowCancel) toast('계정 생성이 필요합니다.'); return false; }
  if(state.accounts.some((a)=>a.djName.toLowerCase()===r.djName.toLowerCase())){ toast('같은 DJ NAME의 계정이 이미 있습니다.'); return false; }
  const a=ensureAcc({djName:r.djName, infinitasId:r.infinitasId, iconDataUrl:r.iconDataUrl});
  state.accounts.push(a); state.activeAccountId=a.id; state.selectedHistoryId=null; await saveState(); refreshAll(); toast(`${a.djName} 계정 생성 완료`); return true;
}

async function editAccountFlow(){
  const acc = activeAcc();
  if (!acc) return;
  const r = await openAccountDialog({
    title: '계정 정보 변경',
    allowCancel: true,
    initial: { djName: acc.djName, infinitasId: acc.infinitasId, iconDataUrl: acc.iconDataUrl }
  });
  if (!r) return;
  const dup = state.accounts.find((a) => a.id !== acc.id && a.djName.toLowerCase() === r.djName.toLowerCase());
  if (dup) {
    toast('같은 DJ NAME의 계정이 이미 있습니다.');
    return;
  }
  acc.djName = r.djName;
  acc.name = r.djName;
  acc.infinitasId = r.infinitasId;
  acc.iconDataUrl = r.iconDataUrl || '';
  await saveState();
  refreshAll();
  toast('계정 정보가 변경되었습니다.');
}

async function deleteAccountFlow() {
  const acc = activeAcc();
  if (!acc) return;
  const ok = await uiConfirm(`계정 "${acc.djName}" 을(를) 삭제할까요?\n저장된 히스토리/목표/데이터가 함께 삭제됩니다.`, {
    title: '계정 삭제',
    okText: '삭제',
    cancelText: '취소'
  });
  if (!ok) return;
  state.accounts = state.accounts.filter((a) => a.id !== acc.id);
  state.activeAccountId = state.accounts[0]?.id || null;
  state.selectedHistoryId = null;
  await saveState();
  refreshAll();
  toast(`${acc.djName} 계정이 삭제되었습니다.`);
  if (!state.accounts.length) {
    await createAccountFlow(false);
  }
}

async function exportGoals() {
  const acc = activeAcc();
  if (!acc) return;
  const source = await openGoalExportSourceDialog(acc.djName);
  if (source == null) return;
  const normalizedSource = source.trim() || acc.djName;
  const payload = {
    exportedAt: nowIso(),
    source: normalizedSource,
    account: { djName: acc.djName, infinitasId: acc.infinitasId },
    goals: (acc.goals || []).map((g) => ({ ...g, source: normalizedSource }))
  };
  const out = await window.electronAPI.exportGoals({
    fileName: `${acc.djName}_goals_${new Date().toISOString().slice(0, 10)}.json`,
    json: JSON.stringify(payload, null, 2)
  });
  if (out?.saved) toast('현재 목표를 내보냈습니다.');
}

async function importGoals() {
  const acc = activeAcc();
  if (!acc) return;
  const res = await window.electronAPI.importGoals();
  if (!res?.content) return;
  let parsed;
  try {
    parsed = JSON.parse(res.content);
  } catch {
    toast('목표 파일(JSON) 형식이 올바르지 않습니다.');
    return;
  }
  const list = Array.isArray(parsed?.goals) ? parsed.goals : [];
  if (!list.length) {
    toast('불러올 목표가 없습니다.');
    return;
  }
  const normalized = list.map((g) => ({
    id: crypto.randomUUID(),
    table: g?.table || 'SP12H',
    title: (g?.title || '').trim(),
    chartType: g?.chartType || g?.type || 'A',
    kind: g?.kind || 'CLEAR',
    targetLamp: g?.targetLamp || 'HC',
    targetScore: num(g?.targetScore),
    targetRank: g?.targetRank || 'AA',
    source: (g?.source || '').trim() || (parsed?.source || '').trim() || (parsed?.account?.djName || '').trim() || acc.djName
  })).filter((g) => g.title);
  acc.goals = normalized;
  await saveState();
  renderGoals();
  toast(`목표 ${normalized.length}개를 불러왔습니다.`);
}

async function clearGoals() {
  const acc = activeAcc();
  if (!acc) return;
  if (!acc.goals?.length) {
    toast('삭제할 목표가 없습니다.');
    return;
  }
  if (!(await uiConfirm('현재 계정의 목표를 모두 삭제할까요?', { title: '목표 전체 삭제', okText: '삭제' }))) return;
  acc.goals = [];
  await saveState();
  renderGoals();
  toast('목표를 전체 삭제했습니다.');
}

async function clearAchievedGoals() {
  const acc = activeAcc();
  if (!acc) return;
  if (!acc.goals?.length) {
    toast('삭제할 목표가 없습니다.');
    return;
  }
  const progress = progressMap();
  const achieved = acc.goals.filter((g) => goalAchieved(g, progress));
  if (!achieved.length) {
    toast('달성한 목표가 없습니다.');
    return;
  }
  if (!(await uiConfirm(`달성한 목표 ${achieved.length}개를 삭제할까요?`, { title: '달성 목표 삭제', okText: '삭제' }))) return;
  const achievedIds = new Set(achieved.map((g) => g.id));
  acc.goals = acc.goals.filter((g) => !achievedIds.has(g.id));
  await saveState();
  renderGoals();
  toast(`달성 목표 ${achieved.length}개를 삭제했습니다.`);
}

async function openGoalExportSourceDialog(defaultSource) {
  const dialog = $('goalExportDialog');
  const form = $('goalExportForm');
  const input = $('goalExportSourceInput');
  const cancelBtn = $('goalExportCancelBtn');
  if (dialog.open) dialog.close('cancel');
  input.value = defaultSource || '';
  const onCancel = () => dialog.close('cancel');
  const onSubmit = (e) => { e.preventDefault(); dialog.close('save'); };
  cancelBtn.addEventListener('click', onCancel);
  form.addEventListener('submit', onSubmit);
  dialog.showModal();
  requestAnimationFrame(() => input.focus());
  return new Promise((resolve) => {
    const onClose = () => {
      dialog.removeEventListener('close', onClose);
      cancelBtn.removeEventListener('click', onCancel);
      form.removeEventListener('submit', onSubmit);
      if (dialog.returnValue === 'cancel') {
        resolve(null);
        return;
      }
      resolve(input.value || '');
    };
    dialog.addEventListener('close', onClose);
  });
}

async function resetApp(){
  if(!(await uiConfirm('모든 계정/데이터를 초기화할까요?', { title: '초기화', okText: '초기화' }))) return;
  state.accounts=[]; state.activeAccountId=null; state.selectedHistoryId=null; await saveState(); refreshAll(); toast('앱 데이터가 초기화되었습니다.'); await createAccountFlow(false);
}

async function applyTrackerContent(content, toastMessage = '데이터 업로드 완료') {
  const acc = activeAcc();
  if (!acc) return false;
  const prev = acc.lastProgress;
  acc.trackerRows = parseTsv(content || '');
  buildViews();
  const curr = progressMap();
  const changes = makeEvents(prev, curr, acc.goals);
  const totalChanges = (changes.updates?.length || 0) + (changes.goals?.length || 0);
  if (totalChanges) {
    const rec = {
      id: crypto.randomUUID(),
      timestamp: nowIso(),
      summary: prev ? `${totalChanges}건 변경` : '최초',
      isInitial: !prev,
      updates: changes.updates || [],
      goals: changes.goals || [],
      snapshotRows: JSON.parse(JSON.stringify(acc.trackerRows || [])),
      snapshotProgress: JSON.parse(JSON.stringify(curr || {}))
    };
    acc.history.push(rec);
    state.selectedHistoryId = rec.id;
  }
  acc.lastProgress = curr;
  await saveState();
  refreshAll();
  toast(toastMessage, 'success');
  return true;
}

async function importTsv(){
  const acc=activeAcc(); if(!acc){ await createAccountFlow(false); return; }
  const r=await window.electronAPI.openTrackerDialog(); if(!r) return;
  await applyTrackerContent(r.content, `${acc.djName} 데이터 업로드 완료`);
}

async function exportImage(){
  if (typeof html2canvas !== 'function') {
    toast('html2canvas 라이브러리를 불러오지 못했습니다.', 'error');
    return;
  }
  const source=$('exportArea');
  const clearGraph = $('clearGraph');
  const scoreGraph = $('scoreGraph');
  const bgColor = '#e7e7e7';
  const host=document.createElement('div');
  host.style.position='fixed';
  host.style.left='-10000px';
  host.style.top='0';
  host.style.width=`${EXPORT_CANVAS_WIDTH}px`;
  host.style.background=bgColor;
  const wrap = document.createElement('div');
  wrap.className = 'export-capture-wrap';
  const node=source.cloneNode(true);
  node.classList.add('export-capture');
  node.style.width='100%';
  wrap.appendChild(node);
  const graphArea = document.createElement('div');
  graphArea.className = 'export-graphs';
  graphArea.innerHTML = `<div class="export-graph-block"><div class="graph-title">CLEAR</div>${clearGraph ? clearGraph.outerHTML : ''}</div><div class="export-graph-block"><div class="graph-title">SCORE</div>${scoreGraph ? scoreGraph.outerHTML : ''}</div>`;
  wrap.appendChild(graphArea);
  host.appendChild(wrap);
  document.body.appendChild(host);
  let canvas;
  try{ await new Promise((res)=>requestAnimationFrame(()=>requestAnimationFrame(res))); canvas=await html2canvas(wrap,{useCORS:true,backgroundColor:bgColor,scale:2,width:EXPORT_CANVAS_WIDTH,windowWidth:EXPORT_CANVAS_WIDTH}); }
  finally{ if(host.parentNode) document.body.removeChild(host); }
  const dataUrl=canvas.toDataURL('image/png');
  const out=await window.electronAPI.exportImage({fileName:`${state.activeTable}_${new Date().toISOString().slice(0,10)}.png`,dataUrl});
  if(out?.saved) toast(`${state.activeTable} 서열표 저장 완료`, 'success');
}

function appendRefluxStatus(line) {
  const area = $('refluxStatusArea');
  const text = (line || '').toString().trim();
  if (!text) return;
  const div = document.createElement('div');
  div.textContent = text;
  area.appendChild(div);
  area.scrollTop = area.scrollHeight;
}

function updateRefluxDialogButtons() {
  const doneBtn = $('refluxDoneBtn');
  const cancelBtn = $('refluxCancelBtn');
  if (!doneBtn || !cancelBtn) return;
  doneBtn.disabled = !state.refluxReadyToConfirm;
  cancelBtn.disabled = state.refluxReadyToConfirm;
}

async function startRefluxUpdate() {
  const acc = activeAcc();
  if (!acc) {
    toast('먼저 계정을 생성하세요.');
    return;
  }
  const dialog = $('refluxDialog');
  const area = $('refluxStatusArea');
  area.innerHTML = '';
  state.refluxRunning = true;
  state.refluxUpdated = false;
  state.refluxReadyToConfirm = false;
  state.refluxPendingContent = '';
  initRefluxGoalCardsSession();
  updateRefluxDialogButtons();
  appendRefluxStatus('Reflux 최신 버전을 확인합니다...');
  let ensured = null;
  try {
    ensured = await window.electronAPI.ensureReflux();
  } catch (e) {
    appendRefluxStatus(`Reflux 확인 실패: ${e.message}`);
    toast('Reflux 확인에 실패했습니다.', 'error');
    state.refluxRunning = false;
    clearRefluxGoalCards();
    if (!dialog.open) dialog.showModal();
    return;
  }
  if (!ensured?.exists) {
    appendRefluxStatus('Reflux 실행 파일을 준비하지 못했습니다.');
    toast('Reflux 실행 파일을 준비하지 못했습니다.', 'error');
    state.refluxRunning = false;
    clearRefluxGoalCards();
    if (!dialog.open) dialog.showModal();
    return;
  }
  if (ensured.updated) appendRefluxStatus(`Reflux ${ensured.latestTag}로 업데이트했습니다.`);
  else if (ensured.upToDate && ensured.latestTag) appendRefluxStatus(`Reflux 최신 버전(${ensured.latestTag})이 준비되어 있습니다.`);
  else appendRefluxStatus('Reflux를 준비했습니다.');
  if (ensured.exePath) {
    state.refluxExePath = ensured.exePath;
    await saveState();
  }
  appendRefluxStatus('갱신을 시작합니다. 이 프로그램을 실행한 채로 IIDX INFINITAS를 플레이해주세요.');
  if (!dialog.open) dialog.showModal();
  await window.electronAPI.startReflux({ exePath: ensured.exePath || state.refluxExePath || '' });
}

async function extractCurrentTsv() {
  const acc = activeAcc();
  if (!acc) {
    toast('먼저 계정을 생성하세요.');
    return;
  }
  const content = rowsToTsv(acc.trackerRows || []);
  if (!content.trim()) {
    toast('추출할 데이터가 없습니다. 먼저 TSV를 업로드하거나 갱신을 실행하세요.');
    return;
  }
  const fileName = `tracker_${acc.djName}_${new Date().toISOString().slice(0, 10)}.tsv`;
  const out = await window.electronAPI.saveTsvFile({ fileName, content });
  if (out?.saved) toast('TSV 추출 완료', 'success');
}

async function loadTablesFromCache(){ state.rankTables=await window.electronAPI.getRankTables(); refreshAll(); }
async function refreshTables(){
  const dialog = $('refreshDialog');
  if (!dialog.open) dialog.showModal();
  try {
    state.rankTables = await window.electronAPI.refreshRankTables();
    refreshAll();
    toast('서열표를 최신 데이터로 갱신했습니다.', 'success');
    showMissingMetaDialog();
  } finally {
    if (dialog.open) dialog.close();
  }
}

function setupEvents(){
  refluxUnsubs.forEach((off) => { try { off(); } catch { /* ignore */ } });
  refluxUnsubs = [
    window.electronAPI.onRefluxStatus((s) => {
      if (s?.gameDetected) {
        appendRefluxStatus('게임 실행을 확인했습니다. 메모리에서 곡 데이터를 조사합니다.');
      } else if (s && s.running === false) {
        const codeInfo = (typeof s.code === 'number') ? ` (code=${s.code})` : '';
        appendRefluxStatus(`Reflux 프로세스가 종료되었습니다${codeInfo}.`);
      }
    }),
    window.electronAPI.onRefluxLog((text) => {
      appendRefluxStatus(text);
      const t = String(text || '');
      if (t.includes('Hooked to process')) {
        appendRefluxStatus('게임 실행을 확인했습니다. 메모리에서 곡 데이터를 조사합니다.');
      }
    }),
    window.electronAPI.onRefluxTracker(({ content }) => {
      if (!content || !state.refluxRunning) return;
      updateRefluxGoalCardsFromTracker(content);
    }),
    window.electronAPI.onRefluxReady(async ({ content }) => {
      if (!content) {
        appendRefluxStatus('갱신된 tracker.tsv를 찾지 못했습니다.');
        toast('갱신된 tracker.tsv를 찾지 못했습니다.', 'error');
        return;
      }
      const ok = await applyTrackerContent(content, '악곡 데이터 갱신 완료');
      if (ok) {
        state.refluxPendingContent = content;
        state.refluxUpdated = true;
        state.refluxRunning = false;
        state.refluxReadyToConfirm = true;
        updateRefluxDialogButtons();
        appendRefluxStatus('업데이트 완료! "갱신 완료" 버튼을 눌러 창을 닫아주세요.');
        renderRefluxGoalCards();
      }
    })
  ];

  $('btnRefluxUpdate').addEventListener('click', startRefluxUpdate);
  $('btnExtractTsv').addEventListener('click', extractCurrentTsv);
  $('btnLoadTracker').addEventListener('click',importTsv);
  $('btnRefreshRank').addEventListener('click',refreshTables);
  $('btnHelp').addEventListener('click', openHelpDialog);
  $('btnExportImage').addEventListener('click',exportImage);
  $('btnResetApp').addEventListener('click',resetApp);
  $('refluxCancelBtn').addEventListener('click', async () => {
    await window.electronAPI.stopReflux();
    state.refluxRunning = false;
    state.refluxReadyToConfirm = false;
    state.refluxPendingContent = '';
    updateRefluxDialogButtons();
    clearRefluxGoalCards();
    if ($('refluxDialog').open) $('refluxDialog').close('cancel');
    toast('갱신을 취소했습니다.', 'info');
  });
  $('refluxDoneBtn').addEventListener('click', () => {
    if (!state.refluxReadyToConfirm) return;
    state.refluxReadyToConfirm = false;
    state.refluxPendingContent = '';
    updateRefluxDialogButtons();
    clearRefluxGoalCards();
    if ($('refluxDialog').open) $('refluxDialog').close('done');
    toast('악곡 데이터 갱신이 완료되었습니다.', 'success');
  });
  $('refluxDialog').addEventListener('cancel', (e) => {
    e.preventDefault();
  });
  $('refluxDialog').addEventListener('close', async () => {
    if (state.refluxRunning && !state.refluxUpdated) {
      await window.electronAPI.stopReflux();
      toast('갱신이 완료되기 전에 창을 닫았습니다.', 'error');
    }
    state.refluxRunning = false;
    state.refluxReadyToConfirm = false;
    state.refluxPendingContent = '';
    updateRefluxDialogButtons();
    clearRefluxGoalCards();
  });
  $('songSearch').addEventListener('input',renderRankTable);
  $('btnExportGoals').addEventListener('click', exportGoals);
  $('btnImportGoals').addEventListener('click', importGoals);
  $('btnClearAchievedGoals').addEventListener('click', clearAchievedGoals);
  $('btnClearGoals').addEventListener('click', clearGoals);
  $('clearGraph').addEventListener('click', (e) => {
    e.stopPropagation();
    const chip = e.target.closest('.legend-chip');
    if (chip) {
      showGraphSingle('clear', chip.getAttribute('data-key') || '', e);
      return;
    }
    if (e.target.closest('.stack-track') || e.target.closest('.stack-seg')) {
      showGraphFull('clear', e);
    }
  });
  $('scoreGraph').addEventListener('click', (e) => {
    e.stopPropagation();
    const chip = e.target.closest('.legend-chip');
    if (chip) {
      showGraphSingle('score', chip.getAttribute('data-key') || '', e);
      return;
    }
    if (e.target.closest('.stack-track') || e.target.closest('.stack-seg')) {
      showGraphFull('score', e);
    }
  });
  $('accountHeroIcon').addEventListener('click', (e) => {
    e.stopPropagation();
    $('accountIconMenu').classList.toggle('hidden');
  });
  $('btnAccountEditFromMenu').addEventListener('click', async () => {
    $('accountIconMenu').classList.add('hidden');
    await editAccountFlow();
  });
  $('btnAccountRadarFromMenu').addEventListener('click', () => {
    $('accountIconMenu').classList.add('hidden');
    openRadarDialog();
  });
  $('accountRadarDialogBody')?.addEventListener('click', (e) => {
    const el = e.target.closest('[data-radar-axis]');
    if (!el) return;
    const axis = el.getAttribute('data-radar-axis') || '';
    if (axis) {
      e.preventDefault();
      e.stopPropagation();
      showRadarAxisPopup(axis, el);
    }
  });
  $('radarDialog')?.addEventListener('close', hideRadarAxisPopup);
  $('radarDialog')?.addEventListener('cancel', hideRadarAxisPopup);
  $('btnAccountDelete').addEventListener('click', async () => {
    $('accountIconMenu').classList.add('hidden');
    await deleteAccountFlow();
  });
  window.addEventListener('scroll', () => {
    hideSongPopup();
    hideGraphPopup();
  }, true);

  $('accountSelect').addEventListener('change', async (e) => {
    const v = e.target.value;
    if (v === '__create__') {
      await createAccountFlow(true);
      authContext.set({ accountId: state.activeAccountId || null });
      renderAuthStatus();
      return;
    }
    state.activeAccountId = v;
    state.selectedHistoryId = null;
    const acc = state.accounts.find((a) => a.id === v);
    if (acc?.socialSettings) {
      const s = normalizeSocialSettings(acc.socialSettings);
      state.settings.discoverability = s.discoverability;
      state.settings.followPolicy = s.followPolicy;
      state.settings.shareDataScope = [...s.shareDataScope];
      state.settings.rivalPolicy = s.rivalPolicy;
    }
    authContext.set({ accountId: v || null });
    await saveState();
    refreshAll();
    await refreshSocialOverview();
  });

  document.querySelectorAll('.tab').forEach((tab)=>tab.addEventListener('click',()=>{ document.querySelectorAll('.tab').forEach((x)=>x.classList.remove('active')); tab.classList.add('active'); state.activeTable=tab.dataset.table; hideSongPopup(); hideGraphPopup(); renderRankTable(); renderGoalCandidates(); syncSlidingControls(); }));
  document.querySelectorAll('.main-tab, .dock-tab').forEach((tab)=>tab.addEventListener('click',()=>{
    setActivePanel(tab.dataset.panel || 'rank');
  }));
  document.querySelectorAll('[data-view]').forEach((b)=>b.addEventListener('click',()=>{ document.querySelectorAll('[data-view]').forEach((x)=>x.classList.remove('active')); b.classList.add('active'); state.viewMode=b.dataset.view; renderRankTable(); syncSlidingControls(); }));
  document.querySelectorAll('[data-sort]').forEach((b)=>b.addEventListener('click',()=>{ document.querySelectorAll('[data-sort]').forEach((x)=>x.classList.remove('active')); b.classList.add('active'); state.sortMode=b.dataset.sort; renderRankTable(); syncSlidingControls(); }));

  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('.song-button');
    const challengeBtn = e.target.closest('.btn-song-challenge');
    const historyCompareBtn = e.target.closest('[data-history-compare-id]');
    const historyChallengeBtn = e.target.closest('.btn-history-challenge');
    const popup = $('songPopup');
    const graphPopup = $('graphPopup');
    const radarAxisPopup = $('radarAxisPopup');
    if (radarAxisPopup && !radarAxisPopup.classList.contains('hidden')) {
      const onAxis = !!e.target.closest('[data-radar-axis]');
      const onPopup = radarAxisPopup.contains(e.target);
      if (!onAxis && !onPopup) hideRadarAxisPopup();
    }
    if (historyCompareBtn) {
      const historyId = historyCompareBtn.getAttribute('data-history-compare-id') || '';
      await showHistoryRivalPopup(historyId, e);
      return;
    }
    if (historyChallengeBtn) {
      const receiverUserId = historyChallengeBtn.getAttribute('data-user-id') || '';
      const historyId = historyChallengeBtn.getAttribute('data-history-id') || '';
      const userName = historyChallengeBtn.getAttribute('data-user-name') || '상대';
      const challengeType = await openChallengeDialog(`${userName}에게 히스토리 도전장을 전송합니다.`);
      if (!challengeType) return;
      try {
        await sendChallengeToUser(receiverUserId, 'history', historyId, 'A', challengeType);
        toast('히스토리 도전장을 전송했습니다.', 'success');
      } catch (err) {
        toast(`도전장 전송 실패: ${err?.message || err}`, 'error');
      }
      return;
    }
    if (challengeBtn) {
      const receiverUserId = challengeBtn.getAttribute('data-user-id') || '';
      const songTitle = challengeBtn.getAttribute('data-song-title') || '';
      const chartType = challengeBtn.getAttribute('data-chart-type') || 'A';
      const userName = challengeBtn.getAttribute('data-user-name') || '상대';
      const challengeType = await openChallengeDialog(`${userName}에게 도전장을 전송합니다.`);
      if (!challengeType) return;
      try {
        await sendChallengeToUser(receiverUserId, 'song', songTitle, chartType, challengeType);
        toast('도전장을 전송했습니다.', 'success');
      } catch (err) {
        toast(`도전장 전송 실패: ${err?.message || err}`, 'error');
      }
      return;
    }
    if (btn) {
      const key = btn.getAttribute('data-chart-key');
      const chart = state.tableViews[state.activeTable]?.flatCharts.find((c) => c.key === key);
      if (chart) showSongPopup(chart, e);
      return;
    }
    if (!popup.classList.contains('hidden') && !popup.contains(e.target)) hideSongPopup();
    if (!graphPopup.classList.contains('hidden') && !graphPopup.contains(e.target) && !e.target.closest('.stack-track') && !e.target.closest('.legend-chip')) hideGraphPopup();
    if (!$('accountIconMenu').contains(e.target)) { $('accountIconMenu').classList.add('hidden'); }
    if (!e.target.closest('.it-select') && !e.target.closest('.it-search')) closeAllEnhancedSelect();
  });
  $('historyList').addEventListener('click',(e)=>{
    if (e.target.closest('#btnHistoryRollback')) return;
    const b=e.target.closest('[data-history-id]');
    if(!b) return;
    const id=b.getAttribute('data-history-id');
    const applySelection = () => {
      state.historyAnimateDetail = true;
      state.selectedHistoryId = id;
      state.historySectionOpen = { clear: false, ramp: false, goal: false, radar: false };
      renderHistory();
    };
    if (state.selectedHistoryId === id) {
      state.selectedHistoryId = null;
      state.historyAnimateDetail = false;
      renderHistory();
      return;
    }
    applySelection();
  });
  $('historyList').addEventListener('click', async (e) => {
    const rb = e.target.closest('#btnHistoryRollback');
    if (!rb || rb.disabled) return;
    if (!state.settings.enableHistoryRollback) return;
    const acc = activeAcc();
    if (!acc || !state.selectedHistoryId) return;
    const histories = Array.isArray(acc.history) ? acc.history : [];
    const targetIdx = histories.findIndex((h) => h.id === state.selectedHistoryId);
    if (targetIdx < 0) return;
    if (targetIdx === histories.length - 1) return;
    const target = histories[targetIdx];
    const hasSnapshot = target?.snapshotRows && target?.snapshotProgress;
    if (!hasSnapshot) {
      toast('이 히스토리는 롤백에 필요한 스냅샷 데이터가 없습니다.', 'error');
      return;
    }
    const ok = await uiConfirm('해당 시점으로 히스토리를 되돌립니다. 계속하시겠습니까?', {
      title: '히스토리 롤백',
      okText: '롤백'
    });
    if (!ok) return;
    acc.history = histories.slice(0, targetIdx + 1);
    acc.trackerRows = JSON.parse(JSON.stringify(target.snapshotRows || []));
    acc.lastProgress = JSON.parse(JSON.stringify(target.snapshotProgress || {}));
    await syncTrackerToRefluxRuntime();
    await saveState();
    refreshAll();
    toast('선택한 시점으로 롤백되었습니다.', 'success');
  });
  $('historyDetail').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-history-section]');
    if (!btn || btn.disabled) return;
    const key = btn.getAttribute('data-history-section');
    if (!key) return;
    const curr = !!state.historySectionOpen[key];
    state.historySectionOpen[key] = !curr;
    state.historyAnimateDetail = false;
    renderHistory();
  });

  $('goalTable').addEventListener('change',()=>{
    state.goalSongQuery = '';
    const songSel = $('goalSong');
    if (songSel) songSel.value = '';
    renderGoalCandidates();
  });
  $('goalKind').addEventListener('change',()=>{
    const kind = $('goalKind').value;
    document.querySelectorAll('.goal-target-input').forEach((el)=>el.classList.add('hidden'));
    if (kind === 'SCORE') $('goalScore').classList.remove('hidden');
    else if (kind === 'RANK') $('goalRank').classList.remove('hidden');
    else $('goalLamp').classList.remove('hidden');
    syncGoalTargetInputVisibility();
  });
  $('btnAddGoal').addEventListener('click',async()=>{
    const acc=activeAcc();
    if(!acc){toast('먼저 계정을 생성하세요.'); return;}
    const table=$('goalTable').value;
    const title=$('goalSong').value.trim();
    const chartType=$('goalChartType').value;
    const kind=$('goalKind').value;
    if(!title){toast('곡명을 선택하세요.');return;}
    const key=`${table}|${titleKey(title)}|${chartType}`;
    if(!state.tableViews[table]?.flatCharts.some((c)=>c.key===key)){toast('해당 곡/채보를 서열표에서 찾지 못했습니다.');return;}
    const ex=acc.goals.find((g)=>g.table===table&&titleKey(g.title)===titleKey(title)&&g.chartType===chartType&&g.kind===kind);
    const payload = { table, title, chartType, kind };
    if (kind === 'SCORE') {
      const targetScore = Math.max(0, num($('goalScore').value));
      if (!targetScore) { toast('목표 점수를 입력하세요.'); return; }
      payload.targetScore = targetScore;
    } else if (kind === 'RANK') {
      payload.targetRank = $('goalRank').value;
    } else {
      payload.targetLamp = $('goalLamp').value;
    }
    payload.source = acc.djName;
    const progress = progressMap();
    if (goalAchieved(payload, progress)) {
      const proceed = await uiConfirm('이미 달성된 목표입니다. 그래도 추가하시겠습니까?', {
        title: '이미 달성됨',
        okText: '추가',
        cancelText: '취소'
      });
      if (!proceed) return;
    }
    if(ex) Object.assign(ex, payload);
    else acc.goals.push({id:crypto.randomUUID(), ...payload});
    await saveState();
    renderGoals();
    toast('목표가 저장되었습니다.', 'info');
  });
  $('goalList').addEventListener('click',async(e)=>{ const acc=activeAcc(); if(!acc) return; const b=e.target.closest('.btn-delete-goal'); if(!b) return; const id=b.getAttribute('data-goal-id'); const card=b.closest('.goal-item'); if(card){ card.classList.add('removing'); await new Promise((r)=>setTimeout(r,180)); } acc.goals=acc.goals.filter((g)=>g.id!==id); await saveState(); renderGoals(); });
  $('settingShowUpdateGoalCards').addEventListener('change', async (e) => {
    state.settings.showUpdateGoalCards = !!e.target.checked;
    if (!state.settings.showUpdateGoalCards) clearRefluxGoalCards();
    else if (state.refluxRunning) initRefluxGoalCardsSession();
    await saveState();
  });
  $('settingEnableHistoryRollback').addEventListener('change', async (e) => {
    state.settings.enableHistoryRollback = !!e.target.checked;
    await saveState();
    renderHistory();
  });
  const applySocialSettings = async () => {
    state.settings.discoverability = $('settingDiscoverability')?.checked ? 'searchable' : 'hidden';
    normalizeSocialCheckboxState();
    state.settings.followPolicy = $('settingFollowPolicyAuto')?.checked
      ? 'auto'
      : $('settingFollowPolicyDisabled')?.checked
        ? 'disabled'
        : 'manual';
    state.settings.shareDataScope = selectedShareScopeFromUi();
    state.settings.rivalPolicy = $('settingRivalPolicyAll')?.checked
      ? 'all'
      : $('settingRivalPolicyDisabled')?.checked
        ? 'disabled'
        : 'followers';
    const acc = activeAcc();
    if (acc) {
      acc.socialSettings = {
        discoverability: state.settings.discoverability,
        followPolicy: state.settings.followPolicy,
        shareDataScope: [...state.settings.shareDataScope],
        rivalPolicy: state.settings.rivalPolicy
      };
    }
    await saveState();
    renderSocialVisibility();
    renderSettings();
    renderSocialPanel();
    renderRefluxGoalCards();
  };
  [
    'settingDiscoverability',
    'settingFollowPolicyManual',
    'settingFollowPolicyAuto',
    'settingFollowPolicyDisabled',
    'settingShareAllData',
    'settingShareGraphs',
    'settingShareGoals',
    'settingShareHistory',
    'settingShareNone',
    'settingRivalPolicyFollowers',
    'settingRivalPolicyAll',
    'settingRivalPolicyDisabled'
  ].forEach((id) => {
    $(id)?.addEventListener('change', () => {
      normalizeSocialCheckboxState(id);
      applySocialSettings();
    });
  });

  $('btnSocialSearchUser')?.addEventListener('click', async () => {
    const input = String($('socialSearchInfinitasId')?.value || '').trim();
    const box = $('socialSearchResult');
    if (!box) return;
    if (!isValidInfinitasId(input)) {
      box.textContent = '유효한 INFINITAS ID(C-XXXX-XXXX-XXXX)를 입력하세요.';
      return;
    }
    const client = getSupabaseClient();
    if (!client) {
      box.textContent = 'Supabase 연결이 없습니다.';
      return;
    }
    const { data, error } = await client.rpc('get_public_profile_by_infinitas_id', { p_infinitas_id: input });
    if (error) {
      box.textContent = `검색 실패: ${error.message}`;
      return;
    }
    const row = Array.isArray(data) ? data[0] : null;
    if (!row) {
      socialSearchTarget = null;
      box.textContent = '검색 결과가 없습니다.';
      renderSocialPanel();
      return;
    }
    socialSearchTarget = row;
    box.textContent = `${row.dj_name} (${row.infinitas_id}) 검색됨`;
    renderSocialPanel();
  });
  $('btnSocialSendFollowRequest')?.addEventListener('click', async () => {
    if (!socialSearchTarget?.auth_user_id) {
      toast('먼저 검색으로 대상을 선택하세요.', 'warning');
      return;
    }
    const client = getSupabaseClient();
    if (!client) return;
    try {
      const { data, error } = await client.rpc('send_follow_request', { p_target_user_id: socialSearchTarget.auth_user_id });
      if (error) throw error;
      const result = String(data || '');
      if (result === 'auto_accepted') toast('팔로우가 자동 허가되었습니다.', 'success');
      else if (result === 'already_following') toast('이미 팔로우 중입니다.', 'info');
      else toast('팔로우 요청을 전송했습니다.', 'success');
      await refreshSocialOverview();
    } catch (e) {
      toast(`팔로우 요청 실패: ${e.message || e}`, 'error');
    }
  });
  $('btnSocialAddRival')?.addEventListener('click', async () => {
    if (!socialSearchTarget?.auth_user_id) {
      toast('먼저 검색으로 대상을 선택하세요.', 'warning');
      return;
    }
    const client = getSupabaseClient();
    if (!client) return;
    try {
      const { data, error } = await client.rpc('add_rival_user', { p_target_user_id: socialSearchTarget.auth_user_id });
      if (error) throw error;
      toast(data === 'added' ? '라이벌 등록 완료' : '이미 등록된 라이벌입니다.', 'success');
      await refreshSocialOverview();
    } catch (e) {
      toast(`라이벌 등록 실패: ${e.message || e}`, 'error');
    }
  });
  $('btnSocialCompare')?.addEventListener('click', () => {
    toast('곡 팝업/히스토리 비교 버튼으로 비교를 확인하세요.', 'info');
  });
  $('socialFollowRequests')?.addEventListener('click', async (e) => {
    const accept = e.target.closest('[data-follow-accept]');
    const reject = e.target.closest('[data-follow-reject]');
    if (!accept && !reject) return;
    const requestId = accept?.getAttribute('data-follow-accept') || reject?.getAttribute('data-follow-reject') || '';
    if (!requestId) return;
    const client = getSupabaseClient();
    if (!client) return;
    try {
      const { error } = await client.rpc('respond_follow_request', {
        p_request_id: requestId,
        p_accept: !!accept
      });
      if (error) throw error;
      toast(accept ? '팔로우 요청을 허가했습니다.' : '팔로우 요청을 거부했습니다.', 'success');
      await refreshSocialOverview();
    } catch (err) {
      toast(`요청 처리 실패: ${err.message || err}`, 'error');
    }
  });

  $('btnGoogleLink').addEventListener('click', linkGoogleAccount);
  $('settingsForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if ($('settingsDialog').open) $('settingsDialog').close('done');
  });
  bindDraggable('dockWidget');
}

async function init(){
  if (!window.electronAPI) {
    throw new Error('electronAPI가 로드되지 않았습니다. preload 연결을 확인하세요.');
  }
  initEnhancedSelects();
  bindRippleButtons();
  setupEvents();
  initSlidingControls();
  authContext.subscribe(() => renderAuthStatus());
  updateRefluxDialogButtons();
  $('goalKind').dispatchEvent(new Event('change'));
  syncGoalTargetInputVisibility();
  const saved=await window.electronAPI.readState();
  const m=migrate(saved||{}); state.accounts=m.accounts; state.activeAccountId=m.active||m.accounts[0]?.id||null; state.refluxExePath=m.refluxExePath||''; state.settings = normalizeSettings(m.settings);
  const acc = activeAcc();
  if (acc?.socialSettings) {
    const s = normalizeSocialSettings(acc.socialSettings);
    state.settings.discoverability = s.discoverability;
    state.settings.followPolicy = s.followPolicy;
    state.settings.shareDataScope = [...s.shareDataScope];
    state.settings.rivalPolicy = s.rivalPolicy;
  }
  authContext.set({ accountId: state.activeAccountId || null });
  getSupabaseClient();
  await loadTablesFromCache();
  await refreshSocialOverview();
  if(!state.accounts.length){ const ok=await createAccountFlow(false); if(!ok) toast('계정 생성이 필요합니다.'); }
  decorateButtons();
  syncSlidingControls();
  await saveState();
}

init().catch((e)=>{ console.error(e); toast(`초기화 오류: ${e.message}`); });



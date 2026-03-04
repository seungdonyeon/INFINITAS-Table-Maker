const { app, BrowserWindow, dialog, ipcMain, Menu } = require('electron');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { exec } = require('child_process');

const RANK_TABLE_URLS = {
  SP10H: 'https://beatmania.app/!/SP10H/',
  SP11H: 'https://beatmania.app/!/SP11H/',
  SP12H: 'https://beatmania.app/!/SP12H/'
};
const NAMU_TABLE_URLS = {
  SP11H:
    'https://namu.wiki/w/beatmania%20IIDX/%EB%B9%84%EA%B3%B5%EC%8B%9D%20%EB%82%9C%EC%9D%B4%EB%8F%84%ED%91%9C(%EC%8B%B1%EA%B8%80%20%EB%A0%88%EB%B2%A8%2011)',
  SP12H:
    'https://namu.wiki/w/beatmania%20IIDX/%EB%B9%84%EA%B3%B5%EC%8B%9D%20%EB%82%9C%EC%9D%B4%EB%8F%84%ED%91%9C(%EC%8B%B1%EA%B8%80%20%EB%A0%88%EB%B2%A8%2012)'
};
const ATWIKI_TABLE_URLS = {
  SP11H: 'https://w.atwiki.jp/bemani2sp11/pages/21.html',
  SP12H: 'https://w.atwiki.jp/bemani2sp11/pages/18.html'
};
const RADAR_AXES = ['NOTES', 'PEAK', 'SCRATCH', 'SOFLAN', 'CHARGE', 'CHORD'];

function getStatePath() {
  return path.join(app.getPath('userData'), 'state.json');
}

function getUserRankCachePath() {
  return path.join(app.getPath('userData'), 'rankTablesCache.json');
}

function getBundledRankCachePath() {
  return path.join(app.getAppPath(), 'assets', 'rankTablesCache.json');
}

function getBundledNotesRadarPath() {
  return path.join(app.getAppPath(), 'assets', 'notes-radar-sp.json');
}

function readState() {
  const statePath = getStatePath();
  if (!fs.existsSync(statePath)) {
    return { version: 3, accounts: [], activeAccountId: null };
  }
  try {
    const raw = fs.readFileSync(statePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed;
    return { version: 3, accounts: [], activeAccountId: null };
  } catch {
    return { version: 3, accounts: [], activeAccountId: null };
  }
}

function writeState(state) {
  const statePath = getStatePath();
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8');
}

function fetchHtml(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) {
      reject(new Error(`Too many redirects while fetching ${url}`));
      return;
    }
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) INFINITAS-Table-Maker'
        }
      },
      (res) => {
        const status = res.statusCode || 0;
        const location = res.headers.location;
        if (location && [301, 302, 303, 307, 308].includes(status)) {
          const nextUrl = new URL(location, url).toString();
          res.resume();
          fetchHtml(nextUrl, redirectCount + 1).then(resolve).catch(reject);
          return;
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          if (status >= 400) {
            reject(new Error(`HTTP ${status} while fetching ${url}`));
            return;
          }
          resolve(body);
        });
      }
    );

    req.on('error', reject);
    req.setTimeout(20000, () => {
      req.destroy(new Error(`Timeout while fetching ${url}`));
    });
  });
}

function decodeHtmlEntities(text) {
  return String(text || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_m, dec) => String.fromCodePoint(parseInt(dec, 10)));
}

function stripHtml(text) {
  return decodeHtmlEntities(String(text || '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ''));
}

function normTitle(t) {
  return String(t || '').normalize('NFKC').replace(/[’`]/gu, "'").replace(/\s+/gu, ' ').trim().toLowerCase();
}

function looseTitle(t) {
  return normTitle(t).replace(/[χΧ]/gu, 'x').replace(/[øØ∅]/gu, 'o').replace(/[^\p{L}\p{N}]/gu, '');
}

function foldedAsciiTitle(t) {
  return normTitle(t)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/æ/gi, 'ae')
    .replace(/œ/gi, 'oe')
    .replace(/ƒ/g, 'f')
    .replace(/[^a-z0-9]/g, '');
}

function parseTitleType(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  let type = 'A';
  let implicitType = true;
  let title = s;
  if (/\[H\]\s*$/i.test(title) || /\(H\)\s*$/i.test(title)) {
    type = 'H';
    implicitType = false;
    title = title.replace(/\[H\]\s*$/i, '').replace(/\(H\)\s*$/i, '').trim();
  } else if (/\[A\]\s*$/i.test(title) || /\(A\)\s*$/i.test(title)) {
    type = 'A';
    implicitType = false;
    title = title.replace(/\[A\]\s*$/i, '').replace(/\(A\)\s*$/i, '').trim();
  } else if (/\[L\]\s*$/i.test(title) || /\(L\)\s*$/i.test(title)) {
    type = 'L';
    implicitType = false;
    title = title.replace(/\[L\]\s*$/i, '').replace(/\(L\)\s*$/i, '').trim();
  }
  title = title.replace(/\s+/g, ' ').trim();
  if (!title) return null;
  return { title, type, implicitType };
}

function translateCategoryLabel(raw) {
  let s = stripHtml(raw || '').replace(/\s+/g, ' ').trim();
  s = s.replace(/[（(]\s*\d+\s*曲\s*[)）]/g, '').trim();
  if (s === '未定') return '미정';
  if (/^超個人差/u.test(s)) return s.replace(/^超個人差/u, '초개인차');
  s = s.replace(/^地力\s*/u, '지력');
  s = s.replace(/^個人差\s*/u, '개인차');
  s = s.replace(/^지력\s*/u, '지력');
  s = s.replace(/^개인차\s*/u, '개인차');
  if (/INFINITAS.*専用|INFINITAS.*전용|전용곡|専用曲/u.test(s)) return 'INFINITAS 전용곡';
  return s;
}

function categoryKey(raw) {
  return translateCategoryLabel(raw || '').replace(/\s+/g, '').toLowerCase();
}

function parseHardGaugeFromNamuWiki(html, level) {
  const sectionRe = /<h3[^>]*>\s*<a id='s-2\.[^']*'[^>]*>[^<]*<\/a>\s*<span id='([^']+)'[\s\S]*?<\/h3>/g;
  const points = [];
  let m;
  while ((m = sectionRe.exec(html))) {
    points.push({ name: decodeHtmlEntities(m[1]).trim(), start: m.index, end: sectionRe.lastIndex });
  }
  if (!points.length) {
    throw new Error(`Could not parse hard-gauge section from NamuWiki SP${level}`);
  }
  const categories = [];
  for (let i = 0; i < points.length; i += 1) {
    const cur = points[i];
    const next = points[i + 1];
    const chunk = html.slice(cur.end, next ? next.start : undefined);
    const tableMatch = chunk.match(/<table[^>]*>[\s\S]*?<\/table>/);
    if (!tableMatch) continue;
    const rowMatches = [...tableMatch[0].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)];
    if (rowMatches.length <= 1) continue;
    const items = [];
    const seen = new Set();
    for (const row of rowMatches.slice(1)) {
      const firstCell = row[1].match(/<td[^>]*>([\s\S]*?)<\/td>/);
      if (!firstCell) continue;
      const plain = stripHtml(firstCell[1]).trim();
      if (!plain || plain === '곡명') continue;
      const parsed = parseTitleType(plain);
      if (!parsed) continue;
      const key = `${parsed.title}|${parsed.type}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ data: { title: parsed.title, type: parsed.type, implicitType: parsed.implicitType } });
    }
    if (items.length) {
      categories.push({
        category: translateCategoryLabel(cur.name),
        sortindex: categories.length,
        items
      });
    }
  }
  if (!categories.length) {
    throw new Error(`Hard-gauge categories were empty for NamuWiki SP${level}`);
  }
  return {
    tableinfo: { title: `IIDX INFINITAS SP ☆${level} Hard Gauge Rank` },
    categories
  };
}

function parseHardGaugeFromAtwiki(html, level) {
  const sectionMatches = [...String(html || '').matchAll(/<h4[^>]*>([\s\S]*?)<\/h4>\s*<table[^>]*>([\s\S]*?)<\/table>/gi)];
  if (!sectionMatches.length) throw new Error(`Could not parse sections from atwiki SP${level}`);
  const categories = [];
  sectionMatches.forEach((m) => {
    const heading = stripHtml(m[1] || '').trim();
    if (!/(地力|個人差|未定|지력|개인차|미정)/u.test(heading)) return;
    const categoryName = translateCategoryLabel(heading);
    if (!categoryName) return;
    const rows = [...m[2].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)];
    const items = [];
    const seen = new Set();
    rows.forEach((row) => {
      const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((x) => stripHtml(x[1]).replace(/\s+/g, ' ').trim());
      if (cells.length < 4) return;
      const titleRaw = cells[1] || '';
      if (!titleRaw || /曲名|곡명/i.test(titleRaw)) return;
      const parsed = parseTitleType(titleRaw);
      if (!parsed) return;
      const key = `${parsed.title}|${parsed.type}`;
      if (seen.has(key)) return;
      seen.add(key);
      const bpm = String(cells[2] || '').trim();
      const notes = Number(String(cells[3] || '').replace(/[^\d]/g, '')) || 0;
      const typeInfo = String(cells[5] || '').trim();
      const cpiHc = Number(String(cells[cells.length - 2] || '').replace(/[^\d.]/g, '')) || 0;
      const cpiEx = Number(String(cells[cells.length - 1] || '').replace(/[^\d.]/g, '')) || 0;
      items.push({
        data: {
          title: parsed.title,
          type: parsed.type,
          implicitType: parsed.implicitType,
          bpm,
          atwikiNotes: notes,
          typeInfo,
          cpiHc,
          cpiEx
        }
      });
    });
    if (items.length) {
      categories.push({
        category: categoryName,
        sortindex: categories.length,
        items
      });
    }
  });
  if (!categories.length) throw new Error(`Hard-gauge categories were empty for atwiki SP${level}`);
  return {
    tableinfo: { title: `IIDX INFINITAS SP ☆${level} Hard Gauge Rank` },
    categories
  };
}

function mergeWithBeatmaniaFallback(primary, fallback) {
  const out = {
    tableinfo: primary?.tableinfo || fallback?.tableinfo || {},
    categories: (primary?.categories || []).map((cat, idx) => ({
      category: cat.category,
      sortindex: idx,
      items: [...(cat.items || [])]
    }))
  };
  const catIndex = new Map(out.categories.map((cat, idx) => [cat.category, idx]));
  const seen = new Set();
  const byTitle = new Map();
  for (const cat of out.categories) {
    for (const item of cat.items || []) {
      const data = item?.data || {};
      seen.add(`${data.title || ''}|${data.type || ''}`);
      const tKey = looseTitle(data.title || '') || normTitle(data.title || '');
      if (tKey && !byTitle.has(tKey)) {
        byTitle.set(tKey, item);
      }
    }
  }
  for (const fbCat of fallback?.categories || []) {
    let idx = catIndex.get(fbCat.category);
    if (idx == null) {
      idx = out.categories.length;
      out.categories.push({
        category: fbCat.category,
        sortindex: idx,
        items: []
      });
      catIndex.set(fbCat.category, idx);
    }
    const targetItems = out.categories[idx].items;
    for (const item of fbCat.items || []) {
      const data = item?.data || {};
      const key = `${data.title || ''}|${data.type || ''}`;
      if (!data.title || seen.has(key)) continue;
      const tKey = looseTitle(data.title || '') || normTitle(data.title || '');
      const existing = tKey ? byTitle.get(tKey) : null;
      if (existing?.data) {
        if (existing.data.implicitType && existing.data.type !== data.type) {
          const oldKey = `${existing.data.title || ''}|${existing.data.type || ''}`;
          existing.data.type = data.type || 'A';
          existing.data.implicitType = false;
          seen.delete(oldKey);
          seen.add(`${existing.data.title || ''}|${existing.data.type || ''}`);
        }
        ['bpm', 'atwikiNotes', 'typeInfo', 'notes', 'level', 'id', 'version'].forEach((k) => {
          if ((existing.data[k] == null || existing.data[k] === '' || existing.data[k] === 0) && data[k] != null && data[k] !== '') {
            existing.data[k] = data[k];
          }
        });
        continue;
      }
      seen.add(key);
      const next = { data: { title: data.title, type: data.type || 'A', implicitType: false } };
      targetItems.push(next);
      if (tKey && !byTitle.has(tKey)) byTitle.set(tKey, next);
    }
  }
  for (const cat of out.categories) {
    for (const item of cat.items || []) {
      if (item?.data && Object.prototype.hasOwnProperty.call(item.data, 'implicitType')) {
        delete item.data.implicitType;
      }
    }
  }
  return out;
}

function mergeSupplementalIntoAtwikiBase(base, supplemental) {
  const out = {
    tableinfo: base?.tableinfo || {},
    categories: (base?.categories || []).map((cat, idx) => ({
      category: translateCategoryLabel(cat.category),
      sortindex: idx,
      items: [...(cat.items || [])]
    }))
  };
  const catIndex = new Map(out.categories.map((cat, idx) => [categoryKey(cat.category), idx]));
  const seen = new Set();
  const infExclusive = [];
  out.categories.forEach((cat) => {
    (cat.items || []).forEach((item) => {
      const data = item?.data || {};
      seen.add(`${normTitle(data.title || '')}|${data.type || ''}`);
      seen.add(`${looseTitle(data.title || '')}|${data.type || ''}`);
    });
  });
  (supplemental?.categories || []).forEach((cat) => {
    const key = categoryKey(cat.category);
    const idx = catIndex.get(key);
    const catName = translateCategoryLabel(cat.category);
    const isInfCategory = catName === 'INFINITAS 전용곡';
    (cat.items || []).forEach((item) => {
      const data = item?.data || {};
      if (!data.title) return;
      const k1 = `${normTitle(data.title || '')}|${data.type || ''}`;
      const k2 = `${looseTitle(data.title || '')}|${data.type || ''}`;
      if (seen.has(k1) || seen.has(k2)) return;
      const next = { data: { ...data } };
      if (typeof next.data.implicitType !== 'undefined') delete next.data.implicitType;
      if (idx != null) out.categories[idx].items.push(next);
      else if (isInfCategory) infExclusive.push(next);
      else infExclusive.push(next);
      seen.add(k1);
      seen.add(k2);
    });
  });
  if (infExclusive.length) {
    const idx = catIndex.get(categoryKey('INFINITAS 전용곡'));
    if (idx != null) out.categories[idx].items.push(...infExclusive);
    else {
      out.categories.push({
        category: 'INFINITAS 전용곡',
        sortindex: out.categories.length,
        items: infExclusive
      });
    }
  }
  return out;
}

function extractTabledata(html) {
  const match = html.match(/var\s+tabledata\s*=\s*(\{[\s\S]*?\});\s*\/\/console\.log\(tabledata\);/);
  if (!match) {
    throw new Error('Could not extract tabledata JSON from beatmania.app page');
  }
  return JSON.parse(match[1]);
}

function readNotesRadarData() {
  const p = getBundledNotesRadarPath();
  if (!fs.existsSync(p)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!raw || !Array.isArray(raw.charts)) return null;
    return raw;
  } catch {
    return null;
  }
}

function buildNotesRadarIndex(data) {
  const idx = new Map();
  const idxLoose = new Map();
  const idxFolded = new Map();
  for (const row of data?.charts || []) {
    const title = String(row?.title || '').trim();
    const type = String(row?.type || 'A').trim().toUpperCase();
    if (!title || !/^[HAL]$/.test(type)) continue;
    const radar = {};
    RADAR_AXES.forEach((axis) => {
      radar[axis] = Number(row?.radar?.[axis] || 0);
    });
    const payload = {
      title,
      type,
      notes: Number(row?.notes || 0),
      radar,
      radarTop: String(row?.radarTop || '').trim()
    };
    const n = normTitle(title);
    const l = looseTitle(title);
    const f = foldedAsciiTitle(title);
    if (n) idx.set(`${n}|${type}`, payload);
    if (l) idxLoose.set(`${l}|${type}`, payload);
    if (f) idxFolded.set(`${f}|${type}`, payload);
  }
  return { idx, idxLoose, idxFolded };
}

function findNotesRadar(indexes, title, type) {
  const t = String(title || '').trim();
  const c = String(type || 'A').trim().toUpperCase();
  if (!t || !/^[HAL]$/.test(c)) return null;
  const n = normTitle(t);
  const l = looseTitle(t);
  const f = foldedAsciiTitle(t);
  if (n && indexes.idx.has(`${n}|${c}`)) return indexes.idx.get(`${n}|${c}`);
  if (l && indexes.idxLoose.has(`${l}|${c}`)) return indexes.idxLoose.get(`${l}|${c}`);
  if (f && indexes.idxFolded.has(`${f}|${c}`)) return indexes.idxFolded.get(`${f}|${c}`);
  return null;
}

function applyNotesRadarToTables(tables, radarData) {
  if (!tables || typeof tables !== 'object') return tables;
  const indexes = buildNotesRadarIndex(radarData);
  Object.values(tables).forEach((table) => {
    (table?.categories || []).forEach((cat) => {
      (cat?.items || []).forEach((item) => {
        const data = item?.data;
        if (!data || !data.title) return;
        const found = findNotesRadar(indexes, data.title, data.type || 'A');
        if (!found) return;
        data.radar = { ...found.radar };
        data.radarTop = found.radarTop || '';
        if ((!data.typeInfo || String(data.typeInfo).trim() === '') && data.radarTop) {
          data.typeInfo = data.radarTop;
        }
        if ((!data.atwikiNotes || Number(data.atwikiNotes) <= 0) && found.notes > 0) {
          data.atwikiNotes = Number(found.notes);
        }
      });
    });
  });
  return tables;
}

async function fetchRankTables() {
  const out = {};
  const sp10Html = await fetchHtml(RANK_TABLE_URLS.SP10H);
  out.SP10H = extractTabledata(sp10Html);

  try {
    const [sp11AtwikiHtml, sp11NamuHtml, sp11FallbackHtml] = await Promise.all([
      fetchHtml(ATWIKI_TABLE_URLS.SP11H),
      fetchHtml(NAMU_TABLE_URLS.SP11H),
      fetchHtml(RANK_TABLE_URLS.SP11H)
    ]);
    const base = parseHardGaugeFromAtwiki(sp11AtwikiHtml, 11);
    const secondary = parseHardGaugeFromNamuWiki(sp11NamuHtml, 11);
    const fallback = extractTabledata(sp11FallbackHtml);
    const supplemental = mergeWithBeatmaniaFallback(secondary, fallback);
    out.SP11H = mergeSupplementalIntoAtwikiBase(base, supplemental);
  } catch (e) {
    const fallbackHtml = await fetchHtml(RANK_TABLE_URLS.SP11H);
    out.SP11H = extractTabledata(fallbackHtml);
  }

  try {
    const [sp12AtwikiHtml, sp12NamuHtml, sp12FallbackHtml] = await Promise.all([
      fetchHtml(ATWIKI_TABLE_URLS.SP12H),
      fetchHtml(NAMU_TABLE_URLS.SP12H),
      fetchHtml(RANK_TABLE_URLS.SP12H)
    ]);
    const base = parseHardGaugeFromAtwiki(sp12AtwikiHtml, 12);
    const secondary = parseHardGaugeFromNamuWiki(sp12NamuHtml, 12);
    const fallback = extractTabledata(sp12FallbackHtml);
    const supplemental = mergeWithBeatmaniaFallback(secondary, fallback);
    out.SP12H = mergeSupplementalIntoAtwikiBase(base, supplemental);
  } catch (e) {
    const fallbackHtml = await fetchHtml(RANK_TABLE_URLS.SP12H);
    out.SP12H = extractTabledata(fallbackHtml);
  }
  return applyNotesRadarToTables(out, readNotesRadarData());
}

function readRankCacheFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (!parsed.tables || typeof parsed.tables !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

function getCachedRankTables() {
  const userCache = readRankCacheFile(getUserRankCachePath());
  if (userCache?.version === 3 && userCache?.tables) return userCache;
  const bundled = readRankCacheFile(getBundledRankCachePath());
  if (bundled?.tables) return bundled;
  return null;
}

function writeUserRankCache(tables) {
  const outPath = getUserRankCachePath();
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(
    outPath,
    JSON.stringify({ version: 3, cachedAt: new Date().toISOString(), source: 'remote-refresh', tables }, null, 2),
    'utf8'
  );
}

let mainWindow;
let oauthPopupWindow = null;
let refluxProcess = null;
let refluxMonitorTimer = null;
let refluxLastTrackerMtime = 0;
let refluxGameDetected = false;
let refluxWarnedNoTracker = false;
let refluxGameWasRunning = false;
let refluxTrackerUpdatedAfterGame = false;
let refluxReadySent = false;


function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function stopRefluxInternal() {
  if (refluxMonitorTimer) {
    clearInterval(refluxMonitorTimer);
    refluxMonitorTimer = null;
  }
  if (refluxProcess && refluxProcess.pid) {
    try {
      exec(`taskkill /PID ${refluxProcess.pid} /T /F`);
    } catch {
      // ignore
    }
  }
  try {
    exec('taskkill /IM Reflux.exe /T /F');
  } catch {
    // ignore
  }
  try {
    exec('taskkill /FI "WINDOWTITLE eq Reflux Console*" /IM cmd.exe /T /F');
  } catch {
    // ignore
  }
  refluxProcess = null;
  refluxGameDetected = false;
  refluxWarnedNoTracker = false;
  refluxGameWasRunning = false;
  refluxTrackerUpdatedAfterGame = false;
  refluxReadySent = false;
}

function parseTasklistHasBm2dx(stdout) {
  const s = String(stdout || '').toLowerCase();
  return s.includes('bm2dx.exe');
}

function startRefluxMonitor(exePath) {
  const trackerPath = path.join(path.dirname(exePath), 'tracker.tsv');
  refluxLastTrackerMtime = 0;
  refluxGameDetected = false;
  refluxWarnedNoTracker = false;
  refluxGameWasRunning = false;
  refluxTrackerUpdatedAfterGame = false;
  refluxReadySent = false;
  const startedAt = Date.now();
  refluxMonitorTimer = setInterval(() => {
    exec('tasklist /FI "IMAGENAME eq bm2dx.exe"', (err, stdout) => {
      if (!err) {
        const found = parseTasklistHasBm2dx(stdout);
        if (found && !refluxGameDetected) {
          refluxGameDetected = true;
          sendToRenderer('reflux:status', { running: true, gameDetected: true });
        }
        if (found) {
          refluxGameWasRunning = true;
        } else if (refluxGameWasRunning && !refluxReadySent) {
          refluxGameWasRunning = false;
          if (refluxTrackerUpdatedAfterGame && refluxLastTrackerMtime > 0) {
            try {
              const content = fs.existsSync(trackerPath) ? fs.readFileSync(trackerPath, 'utf8') : '';
              sendToRenderer('reflux:ready', { filePath: trackerPath, content });
              refluxReadySent = true;
            } catch (e) {
              sendToRenderer('reflux:log', `tracker.tsv 최종 읽기 실패: ${e.message}`);
            }
            stopRefluxInternal();
            sendToRenderer('reflux:status', { running: false, gameDetected: false, code: 0 });
          } else {
            sendToRenderer(
              'reflux:log',
              '게임이 종료되었지만 tracker.tsv 갱신을 찾지 못했습니다. Reflux 콘솔 로그를 확인해주세요.'
            );
          }
        }
      }
    });
    try {
      if (fs.existsSync(trackerPath)) {
        const stat = fs.statSync(trackerPath);
        if (stat.mtimeMs > refluxLastTrackerMtime && stat.size > 0) {
          const prev = refluxLastTrackerMtime;
          refluxLastTrackerMtime = stat.mtimeMs;
          if (refluxGameDetected || refluxGameWasRunning || prev > 0) {
            refluxTrackerUpdatedAfterGame = true;
          }
          try {
            const content = fs.readFileSync(trackerPath, 'utf8');
            sendToRenderer('reflux:tracker', { filePath: trackerPath, content });
          } catch {
            // ignore
          }
        }
      }
      if (
        refluxGameDetected &&
        !refluxWarnedNoTracker &&
        Date.now() - startedAt > 45000 &&
        refluxLastTrackerMtime === 0
      ) {
        refluxWarnedNoTracker = true;
        sendToRenderer(
          'reflux:log',
          '아직 tracker.tsv 갱신이 없습니다. Reflux 콘솔에서 Hook/오프셋 메시지를 확인하거나, 게임/앱을 관리자 권한으로 다시 실행해보세요.'
        );
      }
    } catch {
      // ignore
    }
  }, 1500);
}

function getBundledRefluxDir() {
  const candidates = [
    path.join(process.resourcesPath, 'Reflux'),
    path.join(app.getAppPath(), 'Reflux.1.16.2'),
    path.join(__dirname, 'Reflux.1.16.2')
  ];
  return candidates.find((p) => fs.existsSync(path.join(p, 'Reflux.exe'))) || '';
}

function getRefluxRuntimeDir() {
  return path.join(app.getPath('userData'), 'reflux-runtime');
}

function getRefluxRuntimeExe() {
  return path.join(getRefluxRuntimeDir(), 'current', 'Reflux.exe');
}

function getRefluxLauncherCmdPath() {
  return path.join(getRefluxRuntimeDir(), 'launch-reflux.cmd');
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function execAsync(command) {
  return new Promise((resolve, reject) => {
    exec(command, { windowsHide: true }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || stdout || err.message));
      else resolve({ stdout, stderr });
    });
  });
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { headers: { 'User-Agent': 'INFINITAS-Table-Maker' } },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          if ((res.statusCode || 500) >= 400) {
            reject(new Error(`HTTP ${res.statusCode} while fetching ${url}`));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(20000, () => req.destroy(new Error(`Timeout while fetching ${url}`)));
  });
}

function downloadToFile(url, filePath) {
  return new Promise((resolve, reject) => {
    ensureDir(path.dirname(filePath));
    const file = fs.createWriteStream(filePath);
    const req = https.get(
      url,
      { headers: { 'User-Agent': 'INFINITAS-Table-Maker' } },
      (res) => {
        const status = res.statusCode || 0;
        if (status >= 400) {
          file.close();
          fs.unlink(filePath, () => reject(new Error(`HTTP ${status} while downloading ${url}`)));
          return;
        }
        if (res.headers.location && [301, 302, 303, 307, 308].includes(status)) {
          file.close();
          fs.unlink(filePath, () => {
            downloadToFile(new URL(res.headers.location, url).toString(), filePath).then(resolve).catch(reject);
          });
          return;
        }
        res.pipe(file);
        file.on('finish', () => {
          file.close(() => resolve(filePath));
        });
      }
    );
    req.on('error', (err) => {
      file.close();
      fs.unlink(filePath, () => reject(err));
    });
    req.setTimeout(30000, () => req.destroy(new Error(`Timeout while downloading ${url}`)));
  });
}

async function ensureBundledRefluxInstalled() {
  const bundledDir = getBundledRefluxDir();
  if (!bundledDir) return false;
  const runtimeCurrent = path.join(getRefluxRuntimeDir(), 'current');
  const runtimeExe = path.join(runtimeCurrent, 'Reflux.exe');
  if (fs.existsSync(runtimeExe)) return true;
  ensureDir(runtimeCurrent);
  fs.cpSync(bundledDir, runtimeCurrent, { recursive: true, force: true });
  return fs.existsSync(runtimeExe);
}

async function checkAndUpdateReflux() {
  await ensureBundledRefluxInstalled();
  const runtimeDir = getRefluxRuntimeDir();
  const metaPath = path.join(runtimeDir, 'meta.json');
  let localTag = '';
  if (fs.existsSync(metaPath)) {
    try {
      localTag = JSON.parse(fs.readFileSync(metaPath, 'utf8'))?.tag || '';
    } catch {
      localTag = '';
    }
  }
  const latest = await fetchJson('https://api.github.com/repos/olji/Reflux/releases/latest');
  const latestTag = latest?.tag_name || '';
  const asset = (latest?.assets || []).find((a) => /\.zip$/i.test(a?.name || ''));
  const upToDate = !!latestTag && latestTag === localTag;
  let updated = false;

  if (!upToDate && asset?.browser_download_url) {
    const zipPath = path.join(runtimeDir, 'download.zip');
    const tmpExtract = path.join(runtimeDir, 'tmp_extract');
    const currentDir = path.join(runtimeDir, 'current');
    await downloadToFile(asset.browser_download_url, zipPath);
    if (fs.existsSync(tmpExtract)) fs.rmSync(tmpExtract, { recursive: true, force: true });
    ensureDir(tmpExtract);
    const zipSafe = zipPath.replace(/'/g, "''");
    const tmpSafe = tmpExtract.replace(/'/g, "''");
    await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -Path '${zipSafe}' -DestinationPath '${tmpSafe}' -Force"`);
    const stack = [tmpExtract];
    let foundDir = '';
    while (stack.length) {
      const dir = stack.pop();
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) stack.push(full);
        else if (e.isFile() && e.name.toLowerCase() === 'reflux.exe') {
          foundDir = path.dirname(full);
          break;
        }
      }
      if (foundDir) break;
    }
    if (foundDir) {
      if (fs.existsSync(currentDir)) fs.rmSync(currentDir, { recursive: true, force: true });
      ensureDir(path.dirname(currentDir));
      fs.cpSync(foundDir, currentDir, { recursive: true, force: true });
      fs.writeFileSync(metaPath, JSON.stringify({ tag: latestTag, updatedAt: new Date().toISOString() }, null, 2), 'utf8');
      updated = true;
    }
    if (fs.existsSync(zipPath)) fs.rmSync(zipPath, { force: true });
    if (fs.existsSync(tmpExtract)) fs.rmSync(tmpExtract, { recursive: true, force: true });
  }

  const exePath = getRefluxRuntimeExe();
  const exists = fs.existsSync(exePath);
  return { exists, exePath, latestTag, localTag, upToDate: upToDate || updated, updated };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 980,
    minWidth: 1380,
    minHeight: 820,
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'assets', 'icon', 'infinitas.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.removeMenu();
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
}

function closeOauthPopupWindow() {
  if (oauthPopupWindow && !oauthPopupWindow.isDestroyed()) {
    oauthPopupWindow.close();
  }
  oauthPopupWindow = null;
}

app.whenReady().then(() => {
  app.setName('INFINITAS Table Maker');
  Menu.setApplicationMenu(null);
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.infinitastablemaker.app');
  }

  ipcMain.handle('dialog:openTracker', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'tracker.tsv 선택',
      filters: [{ name: 'TSV Files', extensions: ['tsv'] }],
      properties: ['openFile']
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    const filePath = result.filePaths[0];
    const content = fs.readFileSync(filePath, 'utf8');
    return { filePath, content };
  });

  ipcMain.handle('tracker:read', async (_event, filePath) => {
    if (!filePath || !fs.existsSync(filePath)) {
      return null;
    }
    const content = fs.readFileSync(filePath, 'utf8');
    return { filePath, content };
  });

  ipcMain.handle('tracker:writeAdjacent', async (_event, { exePath, content }) => {
    if (!exePath || typeof exePath !== 'string' || !fs.existsSync(exePath)) {
      return { saved: false, reason: 'exe_not_found' };
    }
    const target = path.join(path.dirname(exePath), 'tracker.tsv');
    fs.writeFileSync(target, content || '', 'utf8');
    return { saved: true, filePath: target };
  });

  ipcMain.handle('dialog:pickRefluxExe', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Reflux ?? ?? ??',
      filters: [{ name: 'Executable', extensions: ['exe'] }],
      properties: ['openFile']
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('reflux:ensure', async () => {
    return checkAndUpdateReflux();
  });

  ipcMain.handle('tsv:save', async (_event, { fileName, content }) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'TSV ?? ??',
      defaultPath: fileName,
      filters: [{ name: 'TSV Files', extensions: ['tsv'] }]
    });
    if (result.canceled || !result.filePath) return { saved: false };
    fs.writeFileSync(result.filePath, content || '', 'utf8');
    return { saved: true, filePath: result.filePath };
  });

  ipcMain.handle('reflux:start', async (_event, { exePath }) => {
    let pathToRun = exePath;
    if (!pathToRun || !fs.existsSync(pathToRun)) {
      const ensured = await checkAndUpdateReflux();
      if (!ensured.exists || !ensured.exePath) {
        throw new Error('Reflux 실행 파일 경로를 찾을 수 없습니다.');
      }
      pathToRun = ensured.exePath;
    }
    if (refluxMonitorTimer) {
      return { started: true, alreadyRunning: true };
    }
    const workDir = path.dirname(pathToRun);
    const cmdLine = `/k title Reflux Console && cd /d "${workDir}" && "${pathToRun}"`;
    const psScript = [
      `$arg = '${cmdLine.replace(/'/g, "''")}'`,
      `$wd = '${workDir.replace(/'/g, "''")}'`,
      '$p = Start-Process -FilePath "cmd.exe" -ArgumentList $arg -WorkingDirectory $wd -PassThru',
      'Write-Output $p.Id'
    ].join('; ');
    let startedPid = 0;
    try {
      const out = await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${psScript}"`);
      const m = String(out.stdout || '').match(/(\d+)/);
      startedPid = m ? Number(m[1]) : 0;
    } catch (err) {
      sendToRenderer('reflux:log', `ERROR: Reflux 콘솔 실행 실패 - ${err.message}`);
      throw err;
    }
    refluxProcess = startedPid ? { pid: startedPid } : null;
    sendToRenderer('reflux:status', { running: true, gameDetected: false });
    sendToRenderer('reflux:log', 'Reflux 콘솔 창을 실행했습니다. 콘솔에서 진행 로그를 확인하세요.');
    startRefluxMonitor(pathToRun);
    return { started: true, alreadyRunning: false, exePath: pathToRun, pid: startedPid };
  });

  ipcMain.handle('reflux:stop', async () => {
    stopRefluxInternal();
    sendToRenderer('reflux:status', { running: false, gameDetected: false });
    return { stopped: true };
  });

  ipcMain.handle('ranktables:fetch', async () => {
    return fetchRankTables();
  });

  ipcMain.handle('ranktables:get', async () => {
    const cached = getCachedRankTables();
    if (cached?.tables) return applyNotesRadarToTables(cached.tables, readNotesRadarData());
    const tables = await fetchRankTables();
    writeUserRankCache(tables);
    return tables;
  });

  ipcMain.handle('ranktables:refresh', async () => {
    const tables = await fetchRankTables();
    writeUserRankCache(tables);
    return tables;
  });

  ipcMain.handle('state:read', async () => {
    return readState();
  });

  ipcMain.handle('state:write', async (_event, state) => {
    writeState(state);
    return true;
  });

  ipcMain.handle('oauth:openPopup', async (_event, payload) => {
    const oauthUrl = String(payload?.url || '').trim();
    const successPrefix = String(payload?.successPrefix || '').trim();
    if (!oauthUrl) throw new Error('OAuth URL이 비어 있습니다.');
    if (!successPrefix) throw new Error('OAuth 성공 URL prefix가 비어 있습니다.');

    closeOauthPopupWindow();

    return new Promise((resolve) => {
      let resolved = false;
      const done = (result) => {
        if (resolved) return;
        resolved = true;
        closeOauthPopupWindow();
        resolve(result);
      };

      oauthPopupWindow = new BrowserWindow({
        width: 520,
        height: 760,
        minWidth: 480,
        minHeight: 680,
        icon: path.join(__dirname, 'assets', 'icon', 'infinitas.png'),
        parent: mainWindow,
        modal: true,
        autoHideMenuBar: true,
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true
        }
      });
      oauthPopupWindow.removeMenu();
      oauthPopupWindow.setMenuBarVisibility(false);
      oauthPopupWindow.setTitle('Google 로그인');

      const normalizedSuccessPrefix = successPrefix.replace(/\/+$/, '');
      const tryHandleUrl = (targetUrl) => {
        const nextUrl = String(targetUrl || '');
        if (!nextUrl) return false;
        const matched =
          nextUrl === successPrefix ||
          nextUrl.startsWith(`${successPrefix}?`) ||
          nextUrl.startsWith(`${successPrefix}#`) ||
          nextUrl.startsWith(`${normalizedSuccessPrefix}/`) ||
          nextUrl.startsWith(`${normalizedSuccessPrefix}?`) ||
          nextUrl.startsWith(`${normalizedSuccessPrefix}#`);
        if (matched) {
          done({ ok: true, finalUrl: nextUrl });
          return true;
        }
        return false;
      };

      oauthPopupWindow.webContents.on('will-redirect', (event, targetUrl) => {
        if (tryHandleUrl(targetUrl)) event.preventDefault();
      });
      oauthPopupWindow.webContents.on('will-navigate', (event, targetUrl) => {
        if (tryHandleUrl(targetUrl)) event.preventDefault();
      });
      oauthPopupWindow.webContents.on('did-navigate', (_event2, targetUrl) => {
        tryHandleUrl(targetUrl);
      });
      oauthPopupWindow.on('closed', () => {
        oauthPopupWindow = null;
        done({ ok: false, canceled: true });
      });
      oauthPopupWindow.loadURL(oauthUrl).catch((err) => {
        done({ ok: false, canceled: false, error: err.message });
      });
    });
  });

  ipcMain.handle('export:image', async (_event, { fileName, dataUrl }) => {
    const pngData = dataUrl.replace(/^data:image\/png;base64,/, '');
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '서열표 이미지 저장',
      defaultPath: fileName,
      filters: [{ name: 'PNG Image', extensions: ['png'] }]
    });

    if (result.canceled || !result.filePath) {
      return { saved: false };
    }

    fs.writeFileSync(result.filePath, pngData, 'base64');
    return { saved: true, filePath: result.filePath };
  });

  ipcMain.handle('goals:export', async (_event, { fileName, json }) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '목표 내보내기',
      defaultPath: fileName,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (result.canceled || !result.filePath) {
      return { saved: false };
    }
    fs.writeFileSync(result.filePath, json, 'utf8');
    return { saved: true, filePath: result.filePath };
  });

  ipcMain.handle('goals:import', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '목표 불러오기',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile']
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const filePath = result.filePaths[0];
    const content = fs.readFileSync(filePath, 'utf8');
    return { filePath, content };
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  stopRefluxInternal();
  closeOauthPopupWindow();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});





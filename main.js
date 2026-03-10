const { app, BrowserWindow, dialog, ipcMain, Menu } = require('electron');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { exec } = require('child_process');
const { PDFParse } = require('pdf-parse');

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
const NOTES_RADAR_DRIVE_FOLDER_ID = '1vsHfrRj__nFks3UlZlLqIjHNSkY8E5ep';
const NOTES_RADAR_TIME_SKEW_MS = 10 * 60 * 1000;

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

function getBundledNotesRadarExtraPath() {
  return path.join(app.getAppPath(), 'assets', 'notes-radar-sp-extra.json');
}

function getUserNotesRadarPath() {
  return path.join(app.getPath('userData'), 'notes-radar-sp.json');
}

function getUserNotesRadarMetaPath() {
  return path.join(app.getPath('userData'), 'notes-radar-sp.meta.json');
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
  const user = readJsonSafe(getUserNotesRadarPath());
  const bundled = readBundledNotesRadarDataSafe();
  const hasUserCharts = Array.isArray(user?.charts) && user.charts.length > 0;
  const hasBundledCharts = Array.isArray(bundled?.charts) && bundled.charts.length > 0;
  if (hasUserCharts) {
    return mergeNotesRadarPayloadAddOnly(user, bundled).payload;
  }
  if (hasBundledCharts) return bundled;
  return null;
}

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuote = !inQuote;
      }
      continue;
    }
    if (ch === ',' && !inQuote) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function formatCsvLine(cols) {
  return cols
    .map((value) => {
      const s = String(value ?? '');
      if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r')) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    })
    .join(',');
}

function parseCsvRecords(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  const text = fs.readFileSync(filePath, 'utf8');
  const lines = String(text || '')
    .split(/\r?\n/g)
    .filter((line) => line.trim().length > 0);
  if (!lines.length) return [];
  const header = parseCsvLine(lines[0]).map((h) => String(h || '').trim());
  if (!header.length) return [];
  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = parseCsvLine(lines[i]);
    if (!cols.length) continue;
    const row = {};
    header.forEach((key, idx) => {
      row[key] = String(cols[idx] || '').trim();
    });
    rows.push(row);
  }
  return rows;
}

function mapChartType(chartName, chartIndexRaw) {
  const name = String(chartName || '').trim().toUpperCase();
  const m = name.match(/^SP([BNHAL])$/);
  if (m) return m[1];
  const idx = Number(chartIndexRaw);
  if (idx === 0) return 'B';
  if (idx === 1) return 'N';
  if (idx === 2) return 'H';
  if (idx === 3) return 'A';
  if (idx === 4) return 'L';
  return '';
}

function toRadarScale100(value) {
  const v = Number(value);
  if (!Number.isFinite(v) || v <= 0) return 0;
  return Math.min(200, Math.round(v * 10000) / 100);
}

function hasPositiveRadar(radar) {
  return RADAR_AXES.some((axis) => Number(radar?.[axis] || 0) > 0);
}

function buildRuntimeRadarEntryFromCsv(row) {
  const title = normalizeRadarTitle(row?.title_ascii || row?.title || '');
  const type = mapChartType(row?.chart_name, row?.chart_index);
  if (!title || !type) return null;
  const radar = {
    NOTES: toRadarScale100(row?.radar_notes),
    PEAK: toRadarScale100(row?.radar_peak),
    SCRATCH: toRadarScale100(row?.radar_scratch),
    SOFLAN: toRadarScale100(row?.radar_soflan),
    CHARGE: toRadarScale100(row?.radar_charge),
    CHORD: toRadarScale100(row?.radar_chord)
  };
  if (!hasPositiveRadar(radar)) return null;
  const notes = Number(String(row?.note_count || '').replace(/[^\d]/g, '')) || 0;
  return {
    title,
    type,
    notes,
    radar,
    radarTop: dominantAxis(radar)
  };
}

function readBundledNotesRadarDataSafe() {
  const bundled = readJsonSafe(getBundledNotesRadarPath());
  const base = bundled && Array.isArray(bundled.charts) ? bundled : { generatedAt: nowIso(), charts: [], count: 0 };
  const extra = readJsonSafe(getBundledNotesRadarExtraPath());
  if (!extra || !Array.isArray(extra.charts) || !extra.charts.length) return base;
  return mergeNotesRadarPayloadAddOnly(base, extra).payload;
}

function nowIso() {
  return new Date().toISOString();
}

function cloneNotesRadarPayload(payload) {
  const charts = Array.isArray(payload?.charts)
    ? payload.charts.map((x) => ({
      title: String(x?.title || '').trim(),
      type: String(x?.type || '').trim().toUpperCase(),
      notes: Number(x?.notes || 0),
      radar: {
        NOTES: Number(x?.radar?.NOTES || 0),
        PEAK: Number(x?.radar?.PEAK || 0),
        SCRATCH: Number(x?.radar?.SCRATCH || 0),
        SOFLAN: Number(x?.radar?.SOFLAN || 0),
        CHARGE: Number(x?.radar?.CHARGE || 0),
        CHORD: Number(x?.radar?.CHORD || 0)
      },
      radarTop: String(x?.radarTop || '').trim().toUpperCase()
    }))
    : [];
  return {
    ...payload,
    charts,
    count: charts.length
  };
}

function normalizeNotesRadarType(value) {
  const t = String(value || '').trim().toUpperCase();
  return /^[BNHAL]$/.test(t) ? t : '';
}

function normalizeNotesRadarChart(row) {
  const title = normalizeRadarTitle(row?.title || '');
  const type = normalizeNotesRadarType(row?.type);
  if (!title || !type) return null;
  const radar = {
    NOTES: Number(row?.radar?.NOTES || 0),
    PEAK: Number(row?.radar?.PEAK || 0),
    SCRATCH: Number(row?.radar?.SCRATCH || 0),
    SOFLAN: Number(row?.radar?.SOFLAN || 0),
    CHARGE: Number(row?.radar?.CHARGE || 0),
    CHORD: Number(row?.radar?.CHORD || 0)
  };
  return {
    title,
    type,
    notes: Number(row?.notes || 0),
    radar,
    radarTop: String(row?.radarTop || dominantAxis(radar)).trim().toUpperCase()
  };
}

function mergeNotesRadarPayloadAddOnly(basePayload, incomingPayload) {
  const base = cloneNotesRadarPayload(basePayload || { generatedAt: nowIso(), charts: [], count: 0 });
  const chartIndex = new Set(
    (base.charts || [])
      .filter((x) => String(x?.title || '').trim())
      .map((x) => radarKeyOf(x.title, x.type))
  );
  let added = 0;
  for (const row of incomingPayload?.charts || []) {
    const next = normalizeNotesRadarChart(row);
    if (!next) continue;
    const key = radarKeyOf(next.title, next.type);
    if (chartIndex.has(key)) continue;
    base.charts.push(next);
    chartIndex.add(key);
    added += 1;
  }
  base.count = Array.isArray(base.charts) ? base.charts.length : 0;
  return { payload: base, added };
}

function getRadarHudMergedCacheCsvPath() {
  const localRoot = process.env.LOCALAPPDATA || app.getPath('home');
  return path.join(localRoot, 'INFINITAS Table Maker', 'radar-hud', 'cache', 'radar_with_title_fixed.csv');
}

function ensureAbyssHudFallbackRows(progress) {
  const log = (msg) => {
    try { progress?.(msg); } catch { /* ignore */ }
  };
  const csvPath = getRadarHudMergedCacheCsvPath();
  if (!fs.existsSync(csvPath)) {
    return { changed: false, reason: 'csv_not_found', csvPath };
  }
  const text = fs.readFileSync(csvPath, 'utf8');
  const lines = String(text || '').split(/\r?\n/g);
  if (!lines.length || !String(lines[0] || '').trim()) {
    return { changed: false, reason: 'empty_csv', csvPath };
  }
  const header = parseCsvLine(lines[0]).map((x) => String(x || '').trim());
  const has = new Set(
    parseCsvRecords(csvPath)
      .filter((row) => normalizeRadarTitle(row?.title_ascii || row?.title || '') === 'Abyss -The Heavens Remix-')
      .map((row) => String(row?.chart_name || '').trim().toUpperCase())
  );
  const fallbackRows = [
    {
      song_id: 9051,
      title_ascii: 'Abyss -The Heavens Remix-',
      chart_index: 0,
      chart_name: 'SPB',
      level: 3,
      note_count: 288,
      total_seconds: 0,
      bpm_min: 0,
      bpm_max: 0,
      radar_notes: 0.2453,
      radar_peak: 0.2142,
      radar_scratch: 0.2172,
      radar_soflan: 0,
      radar_charge: 0,
      radar_chord: 0.004,
      source: 'manual_seed'
    },
    {
      song_id: 9051,
      title_ascii: 'Abyss -The Heavens Remix-',
      chart_index: 1,
      chart_name: 'SPN',
      level: 7,
      note_count: 766,
      total_seconds: 0,
      bpm_min: 0,
      bpm_max: 0,
      radar_notes: 0.6525,
      radar_peak: 0.5714,
      radar_scratch: 0.391,
      radar_soflan: 0,
      radar_charge: 0,
      radar_chord: 0.2481,
      source: 'manual_seed'
    },
    {
      song_id: 9051,
      title_ascii: 'Abyss -The Heavens Remix-',
      chart_index: 4,
      chart_name: 'SPL',
      level: 11,
      note_count: 1637,
      total_seconds: 0,
      bpm_min: 0,
      bpm_max: 0,
      radar_notes: 0,
      radar_peak: 0,
      radar_scratch: 0,
      radar_soflan: 0,
      radar_charge: 0,
      radar_chord: 0,
      source: 'manual_seed'
    }
  ];
  const appendLines = [];
  let added = 0;
  for (const row of fallbackRows) {
    if (has.has(row.chart_name)) continue;
    const cols = header.map((key) => row[key] ?? '');
    appendLines.push(formatCsvLine(cols));
    added += 1;
  }
  if (!appendLines.length) {
    return { changed: false, reason: 'already_present', csvPath };
  }
  const suffix = (text.endsWith('\n') ? '' : '\n') + appendLines.join('\n') + '\n';
  fs.appendFileSync(csvPath, suffix, 'utf8');
  log(`노트 레이더 HUD 캐시 보정: Abyss SPB/SPN/SPL ${added}건 추가`);
  return { changed: true, csvPath, added };
}

function mergeHudSurveyCacheIntoNotesRadar(progress) {
  const log = (msg) => {
    try { progress?.(msg); } catch { /* ignore */ }
  };
  const csvPath = getRadarHudMergedCacheCsvPath();
  if (!fs.existsSync(csvPath)) {
    return {
      changed: false,
      reason: 'csv_not_found',
      csvPath
    };
  }

  const rows = parseCsvRecords(csvPath);
  const runtimeCharts = rows.map(buildRuntimeRadarEntryFromCsv).filter(Boolean);
  if (!runtimeCharts.length) {
    return {
      changed: false,
      reason: 'no_runtime_rows',
      csvPath,
      rowCount: rows.length
    };
  }

  const base = readNotesRadarData() || readBundledNotesRadarDataSafe();
  const next = cloneNotesRadarPayload(base);
  const official = readBundledNotesRadarDataSafe();
  const officialKeys = new Set(
    (official.charts || [])
      .filter((x) => String(x?.title || '').trim() && hasPositiveRadar(x?.radar))
      .map((x) => radarKeyOf(x.title, x.type))
  );

  const chartIndex = new Map();
  next.charts.forEach((x, idx) => {
    if (!x?.title) return;
    chartIndex.set(radarKeyOf(x.title, x.type), idx);
  });

  let added = 0;
  let updated = 0;
  let skippedOfficial = 0;
  for (const row of runtimeCharts) {
    const key = radarKeyOf(row.title, row.type);
    const at = chartIndex.get(key);
    if (officialKeys.has(key)) {
      skippedOfficial += 1;
      continue;
    }
    if (at == null) {
      next.charts.push(row);
      chartIndex.set(key, next.charts.length - 1);
      added += 1;
      continue;
    }
    next.charts[at] = { ...row };
    updated += 1;
  }

  if (added === 0 && updated === 0) {
    return {
      changed: false,
      reason: 'no_changes',
      csvPath,
      rowCount: rows.length,
      runtimeCount: runtimeCharts.length,
      skippedOfficial
    };
  }

  next.generatedAt = nowIso();
  next.count = Array.isArray(next.charts) ? next.charts.length : 0;
  next.sourceDir = next.sourceDir || path.dirname(csvPath);
  next.runtimeCacheMergedAt = nowIso();
  next.runtimeCachePath = csvPath;

  const outPath = getUserNotesRadarPath();
  ensureDir(path.dirname(outPath));
  fs.writeFileSync(outPath, JSON.stringify(next, null, 2), 'utf8');

  log(`노트 레이더 캐시 병합 완료: +${added} / ~${updated} (공식 데이터 유지 ${skippedOfficial})`);
  return {
    changed: true,
    csvPath,
    outPath,
    rowCount: rows.length,
    runtimeCount: runtimeCharts.length,
    added,
    updated,
    skippedOfficial
  };
}

function buildNotesRadarIndex(data) {
  const idx = new Map();
  const idxLoose = new Map();
  const idxFolded = new Map();
  for (const row of data?.charts || []) {
    const title = String(row?.title || '').trim();
    const type = String(row?.type || 'A').trim().toUpperCase();
    if (!title || !/^[BNHAL]$/.test(type)) continue;
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
  if (!t || !/^[BNHAL]$/.test(c)) return null;
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

function readJsonSafe(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function normalizeRadarTitle(s) {
  return String(s || '')
    .normalize('NFKC')
    .replace(/[’`]/gu, "'")
    .replace(/\s+/gu, ' ')
    .trim();
}

function detectAxisFromName(fileName) {
  const upper = String(fileName || '').toUpperCase();
  return RADAR_AXES.find((axis) => upper.includes(axis)) || '';
}

function parseRadarRowsFromText(text) {
  const rows = [];
  String(text || '')
    .split(/\r?\n/g)
    .forEach((line) => {
      if (!line || !line.includes('\t')) return;
      const cols = line
        .split('\t')
        .map((x) => x.replace(/\s+/g, ' ').trim())
        .filter(Boolean);
      if (cols.length < 5) return;
      if (cols[1] !== 'SP') return;
      const type = (cols[2] || '').toUpperCase();
      if (!/^[HAL]$/.test(type)) return;
      const notes = Number(String(cols[3] || '').replace(/[^\d]/g, '')) || 0;
      const score = Number(String(cols[4] || '').replace(/[^\d.]/g, '')) || 0;
      const title = normalizeRadarTitle(cols[0]);
      if (!title || notes <= 0 || score <= 0) return;
      rows.push({ title, type, notes, score });
    });
  return rows;
}

function radarKeyOf(title, type) {
  return `${normalizeRadarTitle(title)}|${String(type || 'A').toUpperCase()}`;
}

function dominantAxis(radar) {
  let best = '';
  let bestValue = -1;
  RADAR_AXES.forEach((axis) => {
    const v = Number(radar?.[axis] || 0);
    if (v > bestValue) {
      bestValue = v;
      best = axis;
    }
  });
  return best;
}

async function parseRadarPdf(filePath, axis) {
  const parser = new PDFParse({ data: fs.readFileSync(filePath) });
  try {
    const result = await parser.getText();
    const rows = parseRadarRowsFromText(result?.text || '');
    return rows.map((r) => ({ ...r, axis }));
  } finally {
    await parser.destroy();
  }
}

async function buildNotesRadarJsonFromPdfDir(sourceDir) {
  const pdfFiles = fs
    .readdirSync(sourceDir)
    .filter((name) => /\.pdf$/i.test(name))
    .map((name) => ({ name, axis: detectAxisFromName(name) }))
    .filter((x) => !!x.axis);
  if (!pdfFiles.length) throw new Error(`No radar pdf files found in ${sourceDir}`);
  const merged = new Map();
  for (const file of pdfFiles) {
    const full = path.join(sourceDir, file.name);
    const rows = await parseRadarPdf(full, file.axis);
    rows.forEach((row) => {
      const key = radarKeyOf(row.title, row.type);
      const prev = merged.get(key) || {
        title: row.title,
        type: row.type,
        notes: row.notes,
        radar: { NOTES: 0, PEAK: 0, SCRATCH: 0, SOFLAN: 0, CHARGE: 0, CHORD: 0 }
      };
      prev.notes = prev.notes || row.notes;
      prev.radar[row.axis] = row.score;
      merged.set(key, prev);
    });
  }
  const charts = [...merged.values()]
    .map((x) => ({ ...x, radarTop: dominantAxis(x.radar) }))
    .sort((a, b) => {
      const t = a.title.localeCompare(b.title);
      if (t !== 0) return t;
      return a.type.localeCompare(b.type);
    });
  return {
    generatedAt: new Date().toISOString(),
    sourceDir,
    count: charts.length,
    charts
  };
}

function extractDriveFileIdsFromFolderHtml(html) {
  const ids = new Set();
  const re = /\/file\/d\/([a-zA-Z0-9_-]{20,})\/view/g;
  let m;
  while ((m = re.exec(String(html || '')))) ids.add(m[1]);
  return [...ids];
}

function parseMetaContent(html, itemProp) {
  const re = new RegExp(`<meta\\s+itemprop=["']${itemProp}["']\\s+content=["']([^"']+)["']`, 'i');
  const m = String(html || '').match(re);
  return m ? decodeHtmlEntities(m[1]).trim() : '';
}

function parseDateMsFlexible(v) {
  const s = String(v || '').trim();
  if (!s) return 0;
  const ms = Date.parse(s);
  if (Number.isFinite(ms)) return ms;
  const ms2 = Date.parse(s.replace(/\./g, '-'));
  return Number.isFinite(ms2) ? ms2 : 0;
}

async function fetchDriveRadarFileMetas() {
  const folderUrl = `https://drive.google.com/embeddedfolderview?id=${NOTES_RADAR_DRIVE_FOLDER_ID}#list`;
  const folderHtml = await fetchHtml(folderUrl);
  const ids = extractDriveFileIdsFromFolderHtml(folderHtml);
  const metas = [];
  for (const id of ids) {
    const fileHtml = await fetchHtml(`https://drive.google.com/file/d/${id}/view`);
    const name = parseMetaContent(fileHtml, 'name');
    const axis = detectAxisFromName(name);
    if (!axis || !/\.pdf$/i.test(name)) continue;
    const upperName = String(name || '').toUpperCase();
    if (!upperName.includes('SP_') || upperName.includes('DP_')) continue;
    const modifiedRaw = parseMetaContent(fileHtml, 'dateModified');
    const modifiedMs = parseDateMsFlexible(modifiedRaw);
    metas.push({
      id,
      name,
      axis,
      modifiedRaw,
      modifiedMs,
      downloadUrl: `https://drive.google.com/uc?export=download&id=${id}`
    });
  }
  const byAxis = new Map();
  metas.forEach((m) => {
    const prev = byAxis.get(m.axis);
    if (!prev || (m.modifiedMs || 0) > (prev.modifiedMs || 0)) byAxis.set(m.axis, m);
  });
  return [...byAxis.values()];
}

function shouldUpdateNotesRadar(remoteFiles, localMeta) {
  if (!Array.isArray(remoteFiles) || remoteFiles.length === 0) return false;
  if (!localMeta?.files) return true;
  return remoteFiles.some((f) => {
    const prev = localMeta.files[f.id];
    const prevMs = Number(prev?.modifiedMs || 0);
    const nextMs = Number(f.modifiedMs || 0);
    if (!nextMs) return false;
    return nextMs > prevMs + NOTES_RADAR_TIME_SKEW_MS;
  });
}

async function maybeUpdateNotesRadarFromDrive(progress) {
  const log = (msg) => {
    try { progress?.(msg); } catch { /* ignore */ }
  };
  log('1/2 노트 레이더: Google Drive PDF 최신 여부를 확인합니다. (출처: notesradarbot Google Drive)');
  const remoteFiles = await fetchDriveRadarFileMetas();
  if (!remoteFiles.length) {
    log('노트 레이더: Drive에서 SP PDF를 찾지 못해 기존 데이터를 유지합니다.');
    return { updated: false, reason: 'no_remote_files' };
  }
  const localMeta = readJsonSafe(getUserNotesRadarMetaPath());
  if (!shouldUpdateNotesRadar(remoteFiles, localMeta)) {
    log('노트 레이더: 기존 로컬 데이터가 최신입니다. (UTC/KST 시간 오차 허용 비교 적용)');
    return { updated: false, reason: 'up_to_date', files: remoteFiles };
  }

  const tempDir = path.join(app.getPath('userData'), 'notes-radar-download');
  if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
  ensureDir(tempDir);
  for (const f of remoteFiles) {
    log(`노트 레이더 다운로드: ${f.name}`);
    await downloadToFile(f.downloadUrl, path.join(tempDir, f.name));
  }
  const payload = await buildNotesRadarJsonFromPdfDir(tempDir);
  if (!payload || !Array.isArray(payload.charts) || Number(payload.count || 0) <= 0) {
    log('노트 레이더: PDF 파싱 결과가 0건이라 기존 데이터를 유지합니다.');
    return { updated: false, reason: 'empty_payload', files: remoteFiles };
  }
  const base = readNotesRadarData() || readBundledNotesRadarDataSafe();
  const merged = mergeNotesRadarPayloadAddOnly(base, payload);
  const outPath = getUserNotesRadarPath();
  if (merged.added > 0) {
    merged.payload.generatedAt = nowIso();
    merged.payload.sourceDir = payload.sourceDir || merged.payload.sourceDir || '';
    ensureDir(path.dirname(outPath));
    fs.writeFileSync(outPath, JSON.stringify(merged.payload, null, 2), 'utf8');
  }
  const metaOut = {
    folderId: NOTES_RADAR_DRIVE_FOLDER_ID,
    checkedAt: new Date().toISOString(),
    files: Object.fromEntries(
      remoteFiles.map((f) => [f.id, { name: f.name, axis: f.axis, modifiedRaw: f.modifiedRaw, modifiedMs: f.modifiedMs }])
    )
  };
  fs.writeFileSync(getUserNotesRadarMetaPath(), JSON.stringify(metaOut, null, 2), 'utf8');
  if (merged.added > 0) {
    log(`노트 레이더 업데이트 완료: 추가된 곡 ${merged.added}건 반영 (총 ${merged.payload.count} charts)`);
    return { updated: true, count: merged.payload.count, added: merged.added, files: remoteFiles };
  }
  log('노트 레이더 업데이트 완료: 추가된 곡이 없어 기존 데이터를 유지합니다.');
  return { updated: false, reason: 'no_new_charts', count: base?.count || 0, files: remoteFiles };
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
let refluxHudAutoInjectEnabled = false;
let refluxHudInjectedPid = 0;


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

function getRadarHudToolPaths() {
  const candidates = [
    path.join(process.resourcesPath || '', 'radar-hud'),
    path.join(app.getAppPath(), 'radar-hud'),
    path.join(__dirname, 'radar-hud'),
    path.join('D:\\client\\build\\bin\\x64\\Release')
  ];
  for (const dir of candidates) {
    const injector = path.join(dir, 'iidx_chart_tap_injector.exe');
    const dll = path.join(dir, 'iidx_overlay_radar_only.dll');
    if (fs.existsSync(injector) && fs.existsSync(dll)) {
      return { injector, dll };
    }
  }
  return null;
}

async function getBm2dxPid() {
  try {
    const cmd = 'powershell -NoProfile -ExecutionPolicy Bypass -Command "(Get-Process bm2dx -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Id)"';
    const out = await execAsync(cmd);
    const m = String(out.stdout || '').match(/(\d+)/);
    return m ? Number(m[1]) : 0;
  } catch {
    return 0;
  }
}

async function tryInjectRadarHud() {
  if (!refluxHudAutoInjectEnabled || refluxHudInjectedPid) return;
  const pid = await getBm2dxPid();
  if (!pid) return;
  const tools = getRadarHudToolPaths();
  if (!tools) {
    sendToRenderer('reflux:log', '노트 레이더 HUD 파일을 찾지 못했습니다. (injector/dll)');
    return;
  }
  try {
    const cmd = `"${tools.injector}" --pid ${pid} --dll "${tools.dll}"`;
    await execAsync(cmd);
    refluxHudInjectedPid = pid;
    sendToRenderer('reflux:log', `노트 레이더 HUD 주입 완료 (PID ${pid})`);
  } catch (e) {
    sendToRenderer('reflux:log', `노트 레이더 HUD 주입 실패: ${e.message}`);
  }
}

function startRefluxMonitor(exePath, options = {}) {
  const trackerPath = path.join(path.dirname(exePath), 'tracker.tsv');
  refluxLastTrackerMtime = 0;
  refluxGameDetected = false;
  refluxWarnedNoTracker = false;
  refluxGameWasRunning = false;
  refluxTrackerUpdatedAfterGame = false;
  refluxReadySent = false;
  refluxHudAutoInjectEnabled = options.noteRadarHudEnabled === true;
  refluxHudInjectedPid = 0;
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
          tryInjectRadarHud();
        }
        if (found) {
          refluxGameWasRunning = true;
        } else if (refluxGameWasRunning && !refluxReadySent) {
          refluxGameWasRunning = false;
          refluxHudInjectedPid = 0;
          if (refluxTrackerUpdatedAfterGame && refluxLastTrackerMtime > 0) {
            try {
              const merged = mergeHudSurveyCacheIntoNotesRadar((msg) => sendToRenderer('reflux:log', msg));
              if (!merged?.changed && merged?.reason === 'csv_not_found') {
                sendToRenderer('reflux:log', '노트 레이더 조사 캐시 CSV를 찾지 못해 기존 레이더 데이터를 유지합니다.');
              } else if (!merged?.changed && merged?.reason === 'no_runtime_rows') {
                sendToRenderer('reflux:log', '노트 레이더 조사 캐시에서 병합 가능한 행을 찾지 못했습니다.');
              } else if (merged?.changed) {
                sendToRenderer(
                  'reflux:log',
                  `노트 레이더 조사 캐시 반영: 추가 ${merged.added}, 갱신 ${merged.updated}, 공식 유지 ${merged.skippedOfficial}`
                );
              }
            } catch (e) {
              sendToRenderer('reflux:log', `노트 레이더 조사 캐시 병합 실패: ${e.message || e}`);
            }
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

  ipcMain.handle('app:getVersion', async () => app.getVersion());

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

  ipcMain.handle('reflux:start', async (_event, payload = {}) => {
    const exePath = payload?.exePath;
    const hudEnabledFromPayload = payload?.noteRadarHudEnabled === true;
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
    try {
      ensureAbyssHudFallbackRows((msg) => sendToRenderer('reflux:log', msg));
    } catch (e) {
      sendToRenderer('reflux:log', `노트 레이더 HUD 캐시 보정 실패: ${e.message || e}`);
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
    startRefluxMonitor(pathToRun, {
      noteRadarHudEnabled: hudEnabledFromPayload || readState()?.settings?.noteRadarHudEnabled === true
    });
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
    const progress = (message) => sendToRenderer('ranktables:progress', { message: String(message || '') });
    progress('1/2 노트 레이더 갱신을 시작합니다.');
    try {
      await maybeUpdateNotesRadarFromDrive(progress);
    } catch (e) {
      progress(`노트 레이더 갱신 중 경고: ${e.message || e} (기존 데이터로 진행)`);
    }
    progress('2/2 서열표 소스(beatmania.app / atwiki / 나무위키) 갱신을 시작합니다.');
    const tables = await fetchRankTables();
    writeUserRankCache(tables);
    progress('서열표 데이터 갱신 완료');
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
      let timeoutId = null;
      let lastSeenUrl = '';
      const done = (result) => {
        if (resolved) return;
        resolved = true;
        if (timeoutId) clearTimeout(timeoutId);
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
        lastSeenUrl = nextUrl;
        const matched =
          nextUrl === successPrefix ||
          nextUrl.startsWith(`${successPrefix}?`) ||
          nextUrl.startsWith(`${successPrefix}#`) ||
          nextUrl.startsWith(`${normalizedSuccessPrefix}/`) ||
          nextUrl.startsWith(`${normalizedSuccessPrefix}?`) ||
          nextUrl.startsWith(`${normalizedSuccessPrefix}#`);
        if (matched) {
          let hasAuthPayload = false;
          let isLocalCallback = false;
          try {
            const parsed = new URL(nextUrl);
            const q = parsed.searchParams;
            const h = new URLSearchParams((parsed.hash || '').replace(/^#/, ''));
            isLocalCallback = parsed.origin === 'http://localhost:54321' && parsed.pathname.startsWith('/auth/callback');
            hasAuthPayload =
              q.has('code') ||
              q.has('access_token') ||
              q.has('error') ||
              h.has('access_token') ||
              h.has('refresh_token') ||
              h.has('error');
          } catch {
            hasAuthPayload = false;
          }
          // Desktop callback can be a blank localhost page; close immediately once reached.
          if (!isLocalCallback && !hasAuthPayload) return false;
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
      oauthPopupWindow.webContents.on('did-fail-load', (_event2, errorCode, errorDescription, validatedURL, isMainFrame) => {
        if (!isMainFrame) return;
        const u = String(validatedURL || '').trim() || String(lastSeenUrl || '').trim();
        if (tryHandleUrl(u)) return;
        if (errorCode === -102 && /^http:\/\/localhost:54321(\/|$)/i.test(u)) {
          // Desktop OAuth callback target is intentionally non-listening localhost.
          done({ ok: true, finalUrl: u });
          return;
        }
        if (errorCode === -102) {
          // Some environments report chrome-error URL here even though redirect happened.
          // Fallback to the last seen URL or success prefix so renderer can continue parsing.
          done({ ok: true, finalUrl: u || successPrefix });
          return;
        }
        if (errorCode === -3) return; // aborted by redirect
        done({ ok: false, canceled: false, error: `페이지 로드 실패 (${errorCode}): ${errorDescription}` });
      });
      oauthPopupWindow.on('closed', () => {
        oauthPopupWindow = null;
        done({ ok: false, canceled: true });
      });
      timeoutId = setTimeout(() => {
        done({ ok: false, canceled: false, error: 'OAuth 팝업 응답 시간 초과(120초)' });
      }, 120000);
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





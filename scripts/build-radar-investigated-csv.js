const fs = require('fs');
const path = require('path');

function normalizeTitle(s) {
  return String(s || '')
    .replace(/\u0000/g, '')
    .normalize('NFKC')
    .replace(/[’`]/gu, "'")
    .replace(/\s+/gu, ' ')
    .trim();
}

function escapeCsv(v) {
  const s = String(v ?? '').replace(/\u0000/g, '');
  if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function toNum(v) {
  const n = Number(v || 0);
  if (!Number.isFinite(n)) return 0;
  return n;
}

function main() {
  const inPath = path.resolve(process.argv[2] || path.join('assets', 'notes-radar-sp.json'));
  const outPath = path.resolve(process.argv[3] || 'D:\\infinitas\\_work\\live_chart_dump\\radar_investigated_sp.csv');
  if (!fs.existsSync(inPath)) {
    throw new Error(`Input JSON not found: ${inPath}`);
  }

  const raw = JSON.parse(fs.readFileSync(inPath, 'utf8'));
  const charts = Array.isArray(raw?.charts) ? raw.charts : [];
  if (!charts.length) {
    throw new Error(`No charts in JSON: ${inPath}`);
  }

  const lines = [];
  lines.push('title,type,radar_notes,radar_peak,radar_scratch,radar_soflan,radar_charge,radar_chord,notes,radar_top');
  for (const row of charts) {
    const title = normalizeTitle(row?.title || '');
    const type = String(row?.type || '').toUpperCase().trim();
    if (!title || !/^[HAL]$/.test(type)) continue;
    const radar = row?.radar || {};
    lines.push([
      escapeCsv(title),
      type,
      toNum(radar.NOTES),
      toNum(radar.PEAK),
      toNum(radar.SCRATCH),
      toNum(radar.SOFLAN),
      toNum(radar.CHARGE),
      toNum(radar.CHORD),
      toNum(row?.notes),
      escapeCsv(String(row?.radarTop || '').toUpperCase().trim())
    ].join(','));
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, lines.join('\n') + '\n', 'utf8');
  process.stdout.write(`investigated radar csv generated: ${outPath} (${lines.length - 1} rows)\n`);
}

main();

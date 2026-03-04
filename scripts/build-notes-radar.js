const fs = require('fs');
const path = require('path');
const { PDFParse } = require('pdf-parse');

const RADAR_AXES = ['NOTES', 'PEAK', 'SCRATCH', 'SOFLAN', 'CHARGE', 'CHORD'];

function normalizeTitle(s) {
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
      const title = normalizeTitle(cols[0]);
      if (!title || notes <= 0 || score <= 0) return;
      rows.push({ title, type, notes, score });
    });
  return rows;
}

function keyOf(title, type) {
  return `${normalizeTitle(title)}|${String(type || 'A').toUpperCase()}`;
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

async function parsePdf(filePath, axis) {
  const parser = new PDFParse({ data: fs.readFileSync(filePath) });
  try {
    const result = await parser.getText();
    const rows = parseRadarRowsFromText(result?.text || '');
    return rows.map((r) => ({ ...r, axis }));
  } finally {
    await parser.destroy();
  }
}

async function main() {
  const sourceDir = path.resolve(process.argv[2] || path.join('assets', 'NotesRader', '20260304'));
  const outPath = path.resolve(process.argv[3] || path.join('assets', 'notes-radar-sp.json'));
  if (!fs.existsSync(sourceDir)) {
    throw new Error(`Source directory not found: ${sourceDir}`);
  }
  const pdfFiles = fs
    .readdirSync(sourceDir)
    .filter((name) => /\.pdf$/i.test(name))
    .map((name) => ({ name, axis: detectAxisFromName(name) }))
    .filter((x) => !!x.axis);
  if (!pdfFiles.length) {
    throw new Error(`No radar pdf files found in: ${sourceDir}`);
  }

  const merged = new Map();
  for (const file of pdfFiles) {
    const full = path.join(sourceDir, file.name);
    const rows = await parsePdf(full, file.axis);
    rows.forEach((row) => {
      const key = keyOf(row.title, row.type);
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

  const payload = {
    generatedAt: new Date().toISOString(),
    sourceDir,
    count: charts.length,
    charts
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');
  process.stdout.write(`notes-radar generated: ${outPath} (${charts.length} charts)\n`);
}

main().catch((err) => {
  process.stderr.write(`${err?.stack || err?.message || err}\n`);
  process.exit(1);
});

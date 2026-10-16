import { getDb } from '../db/index.js';
import { asBool } from './subjectService.js';

const DEFAULTS = {
  'stats.avgWindow': '8',
  'stats.declineThreshold': '3',
  'stats.gradeEquivalentChart': 'false',
  'export.defaultFormat': 'xlsx',
};

function readAll() {
  const rows = getDb().prepare('SELECT key, value FROM app_config').all();
  const m = new Map(rows.map((r) => [r.key, r.value]));
  for (const [k, v] of Object.entries(DEFAULTS)) if (!m.has(k)) m.set(k, v);
  return m;
}

export function getConfig() {
  const m = readAll();
  return {
    stats: {
      avgWindow: Number(m.get('stats.avgWindow') ?? 8),
      declineThreshold: Number(m.get('stats.declineThreshold') ?? 3),
      gradeEquivalentChart: (m.get('stats.gradeEquivalentChart') ?? 'false') === 'true',
    },
    export: {
      defaultFormat: m.get('export.defaultFormat') ?? 'xlsx',
    },
  };
}

export function getStatParams() {
  const c = getConfig();
  return c.stats;
}

export function subjectAliasMap() {
  const raw = readAll().get('subject_alias');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

export function patchConfig(patch = {}) {
  const db = getDb();
  const updated = [];
  const put = (key, value) => {
    db.prepare(`INSERT INTO app_config (key, value, updated_at) VALUES (?, ?, datetime('now','localtime'))
                ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now','localtime')`)
      .run(key, String(value));
    updated.push(key);
  };
  if (patch.stats) {
    if (patch.stats.avgWindow != null) put('stats.avgWindow', patch.stats.avgWindow);
    if (patch.stats.declineThreshold != null) put('stats.declineThreshold', patch.stats.declineThreshold);
    if (patch.stats.gradeEquivalentChart != null) put('stats.gradeEquivalentChart', patch.stats.gradeEquivalentChart ? 'true' : 'false');
  }
  if (patch.export) {
    if (patch.export.defaultFormat != null) put('export.defaultFormat', patch.export.defaultFormat);
  }
  return { updated };
}

export const boolFromDb = asBool;

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

/** 数据库中的值转整数；空串/非数字返回 null（允许留空） */
function toIntOrNull(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 1 ? n : null;
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
    /** 排名人数：管理页统一填写，录入成绩时自动带入，允许为空 */
    rank: {
      classSize: toIntOrNull(m.get('rank.classSize')),
      gradeSize: toIntOrNull(m.get('rank.gradeSize')),
    },
  };
}

export function getRankSizes() {
  return getConfig().rank;
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
  // 人数允许显式清空（null/空串 → 存空串，读取时转 null）
  if (patch.rank) {
    if ('classSize' in patch.rank) put('rank.classSize', patch.rank.classSize ?? '');
    if ('gradeSize' in patch.rank) put('rank.gradeSize', patch.rank.gradeSize ?? '');
  }
  return { updated };
}

export const boolFromDb = asBool;

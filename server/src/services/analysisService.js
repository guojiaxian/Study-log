import crypto from 'node:crypto';
import { getDb, audit } from '../db/index.js';
import { Err } from '../lib/errors.js';
import { buildSummary } from './statsService.js';
import { getExam } from './examService.js';
import { buildFallbackReport } from '../lib/ruleAnalysis.js';
import { aiConfig, analyzeWithAi } from './aiService.js';

function sha16(s) {
  return crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
}

function shapeReport(row) {
  if (!row) return null;
  const parse = (v) => { try { return v ? JSON.parse(v) : []; } catch { return []; } };
  return {
    reportId: row.id,
    scopeType: row.scope_type,
    scopeRef: (() => { try { return JSON.parse(row.scope_ref); } catch { return {}; } })(),
    examId: row.exam_id ?? null,
    model: row.model,
    isFallback: row.is_fallback === 1,
    createdAt: row.created_at,
    contentMd: row.content_md,
    strengths: parse(row.strengths),
    weaknesses: parse(row.weaknesses),
    suggestions: parse(row.suggestions),
  };
}

export async function createReport(scope = {}) {
  const scopeType = scope.scopeType === 'exam' && scope.examId ? 'exam' : 'range';
  let scopeRef = scope.scopeRef ?? {};
  let examId = null;

  if (scopeType === 'exam') {
    const e = getExam(scope.examId);
    examId = e.examId;
    scopeRef = { examId: e.examId, from: e.examDate, to: e.examDate };
  }

  const summary = buildSummary({ scopeType, scopeRef });
  if (!summary.examCount) throw Err.constraint('所选范围内没有可分析的考试记录');

  const digest = sha16(JSON.stringify(summary));
  const db = getDb();

  const cached = db
    .prepare(`SELECT * FROM analysis_report WHERE data_digest = ?
              AND is_fallback = 0 AND created_at > datetime('now','localtime','-24 hours')
              ORDER BY created_at DESC, id DESC LIMIT 1`)
    .get(digest);
  if (cached) {
    return { reportId: cached.id, isFallback: false, model: cached.model, reused: true };
  }

  let report = null;
  if (aiConfig().apiKey) {
    try {
      const r = await analyzeWithAi(summary);
      report = { model: r.model, isFallback: 0, ...r.parsed };
    } catch (err) {
      // AI 失败时降级为规则分析；记录原因与原始返回便于排查（不静默）
      const raw = err.data?.raw ? ` | raw=${String(err.data.raw).slice(0, 300)}` : '';
      console.error(`[analysis] AI 分析失败，降级为规则分析：${err.message}${raw}`);
      report = null;
    }
  }
  if (!report) {
    const f = buildFallbackReport(summary);
    report = {
      model: 'rule-based', isFallback: 1,
      contentMd: f.contentMd, strengths: f.strengths, weaknesses: f.weaknesses, suggestions: f.suggestions,
    };
  }

  const info = db
    .prepare(`INSERT INTO analysis_report
      (scope_type, scope_ref, exam_id, model, data_digest, is_fallback, content_md, strengths, weaknesses, suggestions)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(scopeType, JSON.stringify(scopeRef), examId, report.model, digest, report.isFallback,
      report.contentMd, JSON.stringify(report.strengths ?? []), JSON.stringify(report.weaknesses ?? []), JSON.stringify(report.suggestions ?? []));

  audit('analysis.create', `report:${Number(info.lastInsertRowid)}`, report.model);
  return { reportId: Number(info.lastInsertRowid), isFallback: Boolean(report.isFallback), model: report.model, reused: false };
}

export function listReports({ page = 1, pageSize = 20 } = {}) {
  const db = getDb();
  const p = Math.max(1, Number(page) || 1);
  const ps = Math.min(200, Math.max(1, Number(pageSize) || 20));
  const total = Number(db.prepare('SELECT COUNT(*) AS c FROM analysis_report').get().c);
  const rows = db
    .prepare(`SELECT id, scope_type, scope_ref, exam_id, model, is_fallback, created_at,
              substr(content_md, 1, 160) AS excerpt
              FROM analysis_report ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`)
    .all(ps, (p - 1) * ps);
  const list = rows.map((r) => ({
    reportId: r.id, scopeType: r.scope_type,
    scopeRef: (() => { try { return JSON.parse(r.scope_ref); } catch { return {}; } })(),
    examId: r.exam_id, model: r.model, isFallback: r.is_fallback === 1,
    createdAt: r.created_at, excerpt: String(r.excerpt || '').replace(/[#*`]/g, '').slice(0, 100),
  }));
  return { list, total, page: p, pageSize: ps };
}

export function getReport(id) {
  const row = getDb().prepare('SELECT * FROM analysis_report WHERE id = ?').get(id);
  if (!row) throw Err.notFound('分析报告不存在');
  return shapeReport(row);
}

export function deleteReport(id) {
  const info = getDb().prepare('DELETE FROM analysis_report WHERE id = ?').run(id);
  if (info.changes === 0) throw Err.notFound('分析报告不存在');
  return { deleted: true };
}

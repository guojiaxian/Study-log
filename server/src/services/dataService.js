import fs from 'node:fs';
import path from 'node:path';
import { getDb, transaction, audit } from '../db/index.js';
import { Err } from '../lib/errors.js';

const TABLES = ['subject', 'exam_type_dict', 'app_config', 'target_school'];

/* ------------------------------------------------------------------ */
/* 导出                                                               */
/* ------------------------------------------------------------------ */

export function exportJson() {
  const db = getDb();
  const exams = db.prepare('SELECT * FROM exam ORDER BY exam_date ASC, id ASC').all();
  const scoresByExam = new Map();
  for (const s of db.prepare('SELECT * FROM exam_score ORDER BY exam_id, subject_id').all()) {
    if (!scoresByExam.has(s.exam_id)) scoresByExam.set(s.exam_id, []);
    scoresByExam.get(s.exam_id).push(s);
  }
  const schools = db.prepare('SELECT * FROM target_school ORDER BY sort_order, id').all();
  const admissions = db.prepare('SELECT * FROM school_admission_score ORDER BY school_id, year').all();

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    subjects: db.prepare('SELECT * FROM subject ORDER BY sort_order, id').all(),
    examTypes: db.prepare('SELECT * FROM exam_type_dict ORDER BY sort_order, id').all(),
    exams: exams.map((e) => ({ ...e, scores: scoresByExam.get(e.id) ?? [] })),
    schools: schools.map((s) => ({ ...s, admissionScores: admissions.filter((a) => a.school_id === s.id) })),
    config: db.prepare('SELECT key, value FROM app_config ORDER BY key').all(),
    reports: db.prepare('SELECT * FROM analysis_report ORDER BY id').all(),
  };
}

function csvCell(v) {
  if (v == null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function exportCsv({ from, to } = {}) {
  const db = getDb();
  const where = ["e.status = 'confirmed'"];
  const params = [];
  if (from) { where.push('e.exam_date >= ?'); params.push(from); }
  if (to) { where.push('e.exam_date <= ?'); params.push(to); }

  const exams = db.prepare(`SELECT exam_id AS id, name, exam_type, exam_date, class_rank, class_size, grade_rank, grade_size,
                            total_score FROM v_exam_summary e WHERE ${where.join(' AND ')} ORDER BY e.exam_date ASC`).all(...params);
  const subjects = db.prepare('SELECT id, code, name, full_score, counts_to_total FROM subject ORDER BY sort_order, id').all();
  const visible = subjects.filter((s) => s.counts_to_total === 1);

  const scores = db.prepare(`SELECT exam_id, subject_id, score, grade_level, is_absent FROM exam_score`).all();
  const idx = new Map();
  for (const s of scores) idx.set(`${s.exam_id}:${s.subject_id}`, s);

  const header = ['日期', '考试名称', '类型', '总分', '班级排名', '年级排名',
    ...visible.map((s) => s.name), '生物', '地理'];
  const lines = [header.map(csvCell).join(',')];
  const bio = subjects.find((s) => s.code === 'biology');
  const geo = subjects.find((s) => s.code === 'geography');

  for (const e of exams) {
    const row = [
      e.exam_date, e.name, e.exam_type, e.total_score,
      e.class_rank ? `${e.class_rank}/${e.class_size ?? ''}` : '',
      e.grade_rank ? `${e.grade_rank}/${e.grade_size ?? ''}` : '',
      ...visible.map((s) => {
        const r = idx.get(`${e.id}:${s.id}`);
        if (!r) return '';
        if (r.is_absent) return '缺考';
        return r.score ?? '';
      }),
      bio ? (idx.get(`${e.id}:${bio.id}`)?.grade_level ?? '') : '',
      geo ? (idx.get(`${e.id}:${geo.id}`)?.grade_level ?? '') : '',
    ];
    lines.push(row.map(csvCell).join(','));
  }
  // UTF-8 BOM 便于 Excel 正确识别中文
  return `\uFEFF${lines.join('\r\n')}`;
}

export function exportData({ format = 'json', from, to } = {}) {
  const stamp = new Date().toISOString().slice(0, 10);
  if (format === 'csv' || format === 'xlsx') {
    return {
      contentType: 'text/csv; charset=utf-8',
      filename: `studylog-${stamp}.csv`,
      body: exportCsv({ from, to }),
      note: format === 'xlsx' ? 'Excel 导出以 CSV（UTF-8 BOM）呈现，可直接用 Excel 打开' : undefined,
    };
  }
  return {
    contentType: 'application/json; charset=utf-8',
    filename: `studylog-${stamp}.json`,
    body: JSON.stringify(exportJson(), null, 2),
  };
}

/* ------------------------------------------------------------------ */
/* 导入（覆盖式恢复，事务内完成）                                     */
/* ------------------------------------------------------------------ */

function snapshot() {
  try {
    const src = path.resolve(process.env.DB_PATH || './data/studylog.db');
    if (!fs.existsSync(src)) return null;
    const dst = `${src}.pre-import-${Date.now()}.bak`;
    fs.copyFileSync(src, dst);
    return dst;
  } catch { return null; }
}

export function importData(payload = {}) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.subjects)) {
    throw Err.validation('备份文件格式不合法（缺少 subjects 数组）');
  }
  const snap = snapshot();
  const db = getDb();

  return transaction((tx) => {
    // 清空（按外键安全顺序）
    tx.exec(`DELETE FROM exam_score; DELETE FROM exam; DELETE FROM analysis_report; DELETE FROM ai_parse_task;
             DELETE FROM school_admission_score; DELETE FROM target_school;
             DELETE FROM subject; DELETE FROM exam_type_dict; DELETE FROM app_config;`);
    try { tx.exec('DELETE FROM sqlite_sequence;'); } catch { /* 表可能不存在 */ }

    const insSubject = tx.prepare(`INSERT INTO subject (id, code, name, full_score, score_mode, counts_to_total, start_grade, sort_order, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const s of payload.subjects) {
      insSubject.run(s.id, s.code, s.name, s.full_score, s.score_mode, s.counts_to_total, s.start_grade, s.sort_order, s.is_active);
    }

    const insType = tx.prepare('INSERT INTO exam_type_dict (id, code, name, sort_order, is_active) VALUES (?, ?, ?, ?, ?)');
    for (const t of payload.examTypes ?? []) insType.run(t.id, t.code, t.name, t.sort_order, t.is_active);

    const insExam = tx.prepare(`INSERT INTO exam (id, name, exam_type, exam_date, grade, term, status, source, remark,
      class_rank, class_size, grade_rank, grade_size) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insScore = tx.prepare(`INSERT INTO exam_score (exam_id, subject_id, score, grade_level, is_absent, class_rank, grade_rank, remark)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    let examCount = 0;
    let scoreCount = 0;
    for (const e of payload.exams ?? []) {
      insExam.run(e.id, e.name, e.exam_type, e.exam_date, e.grade, e.term, e.status, e.source, e.remark,
        e.class_rank, e.class_size, e.grade_rank, e.grade_size);
      examCount += 1;
      for (const s of e.scores ?? []) {
        insScore.run(e.id, s.subject_id, s.score, s.grade_level, s.is_absent, s.class_rank, s.grade_rank, s.remark);
        scoreCount += 1;
      }
    }

    const insSchool = tx.prepare('INSERT INTO target_school (id, name, short_name, is_target, sort_order, remark) VALUES (?, ?, ?, ?, ?, ?)');
    const insAdm = tx.prepare(`INSERT INTO school_admission_score (id, school_id, year, admission_type, min_score, total_full_score, batch, remark)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const s of payload.schools ?? []) {
      insSchool.run(s.id, s.name, s.short_name, s.is_target, s.sort_order, s.remark);
      for (const a of s.admissionScores ?? []) {
        insAdm.run(a.id, s.id, a.year, a.admission_type, a.min_score, a.total_full_score, a.batch, a.remark);
      }
    }

    const insCfg = tx.prepare('INSERT INTO app_config (key, value) VALUES (?, ?)');
    for (const c of payload.config ?? []) insCfg.run(c.key, c.value);

    const insReport = tx.prepare(`INSERT INTO analysis_report (id, scope_type, scope_ref, exam_id, model, data_digest, is_fallback, content_md, strengths, weaknesses, suggestions, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const r of payload.reports ?? []) {
      insReport.run(r.id, r.scope_type, r.scope_ref, r.exam_id, r.model, r.data_digest, r.is_fallback,
        r.content_md, r.strengths, r.weaknesses, r.suggestions, r.created_at);
    }

    audit('data.import', null, `exams=${examCount},scores=${scoreCount}`);
    return { imported: { exams: examCount, scores: scoreCount }, snapshot: snap };
  });
}

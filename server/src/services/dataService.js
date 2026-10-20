import fs from 'node:fs';
import path from 'node:path';
import { getDb, transaction, audit } from '../db/index.js';
import { Err } from '../lib/errors.js';

const TABLES = ['subject', 'subject_grade', 'exam_type_dict', 'app_config', 'target_school'];

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
    version: 2,
    exportedAt: new Date().toISOString(),
    subjects: db.prepare('SELECT * FROM subject ORDER BY sort_order, id').all(),
    // 按 (科目, 学段) 的满分/计分/启用配置（迁移 004）
    subjectGrades: db.prepare('SELECT * FROM subject_grade ORDER BY grade, sort_order, subject_id').all(),
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

export function exportCsv({ from, to, grade } = {}) {
  const db = getDb();
  const where = ["e.status = 'confirmed'"];
  const params = [];
  if (from) { where.push('e.exam_date >= ?'); params.push(from); }
  if (to) { where.push('e.exam_date <= ?'); params.push(to); }
  if (grade) { where.push('e.grade = ?'); params.push(Number(grade)); }

  const exams = db.prepare(`SELECT exam_id AS id, name, exam_type, exam_date, grade, class_rank, class_size,
                            grade_rank, grade_size, total_score, entered_full_score
                            FROM v_exam_summary e WHERE ${where.join(' AND ')} ORDER BY e.exam_date ASC`).all(...params);

  // 列 = 两个学段「计入总分的计分科目」按 code 去重的并集（初三口径在前，初二独有科目追加）
  const sgRows = db.prepare(`SELECT sg.subject_id AS id, sg.grade, sg.full_score AS fullScore,
                             sg.counts_to_total AS countsToTotal, sg.is_active AS isActive, sg.sort_order AS sortOrder,
                             s.code, s.name, s.score_mode AS scoreMode
                             FROM subject_grade sg JOIN subject s ON s.id = sg.subject_id
                             ORDER BY sg.grade DESC, sg.sort_order, sg.subject_id`).all();
  const byGrade = new Map();
  for (const r of sgRows) {
    if (!byGrade.has(r.grade)) byGrade.set(r.grade, []);
    byGrade.get(r.grade).push(r);
  }
  const scoreCols = [];
  const seenCode = new Set();
  for (const g of [9, 8]) {
    for (const s of byGrade.get(g) ?? []) {
      if (!s.countsToTotal || s.scoreMode !== 'score' || seenCode.has(s.code)) continue;
      seenCode.add(s.code);
      scoreCols.push(s);
    }
  }
  const gradeCols = [];
  for (const g of [9, 8]) {
    for (const s of byGrade.get(g) ?? []) {
      if (s.scoreMode !== 'grade' || seenCode.has(s.code)) continue;
      seenCode.add(s.code);
      gradeCols.push(s);
    }
  }
  // 「科目 id 在各学段的计分口径」——决定某次考试该科目是否计入总分
  const countByGrade = new Map();
  for (const r of sgRows) {
    if (!countByGrade.has(r.grade)) countByGrade.set(r.grade, new Set());
    if (r.countsToTotal) countByGrade.get(r.grade).add(r.id);
  }

  const scores = db.prepare('SELECT exam_id, subject_id, score, grade_level, is_absent FROM exam_score').all();
  const idx = new Map();
  for (const s of scores) idx.set(`${s.exam_id}:${s.subject_id}`, s);

  const scoreCell = (examId, sub) => {
    const r = idx.get(`${examId}:${sub.id}`);
    if (!r) return '';
    if (r.is_absent) return '缺考';
    return r.score ?? '';
  };

  const header = ['日期', '考试名称', '类型', '学段', '总分', '总分满分', '班级排名', '年级排名',
    ...scoreCols.map((s) => s.name), ...gradeCols.map((s) => s.name)];
  const lines = [header.map(csvCell).join(',')];

  for (const e of exams) {
    const counted = countByGrade.get(e.grade) ?? new Set();
    const row = [
      e.exam_date, e.name, e.exam_type, e.grade === 8 ? '初二' : e.grade === 9 ? '初三' : e.grade,
      e.total_score, e.entered_full_score,
      e.class_rank ? `${e.class_rank}/${e.class_size ?? ''}` : '',
      e.grade_rank ? `${e.grade_rank}/${e.grade_size ?? ''}` : '',
      // 该学段未计入总分 / 未开设的科目输出空值，避免与 0 分混淆
      ...scoreCols.map((s) => (counted.has(s.id) ? scoreCell(e.id, s) : '')),
      // 等级制科目（生物/地理）输出等级字母
      ...gradeCols.map((s) => idx.get(`${e.id}:${s.id}`)?.grade_level ?? ''),
    ];
    lines.push(row.map(csvCell).join(','));
  }
  // UTF-8 BOM 便于 Excel 正确识别中文
  return `\uFEFF${lines.join('\r\n')}`;
}

export function exportData({ format = 'json', from, to, grade } = {}) {
  const stamp = new Date().toISOString().slice(0, 10);
  if (format === 'csv' || format === 'xlsx') {
    return {
      contentType: 'text/csv; charset=utf-8',
      filename: `studylog-${stamp}.csv`,
      body: exportCsv({ from, to, grade }),
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
             DELETE FROM subject_grade; DELETE FROM subject; DELETE FROM exam_type_dict; DELETE FROM app_config;`);
    try { tx.exec('DELETE FROM sqlite_sequence;'); } catch { /* 表可能不存在 */ }

    const insSubject = tx.prepare(`INSERT INTO subject (id, code, name, full_score, score_mode, counts_to_total, start_grade, sort_order, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const s of payload.subjects) {
      insSubject.run(s.id, s.code, s.name, s.full_score, s.score_mode, s.counts_to_total, s.start_grade, s.sort_order, s.is_active);
    }

    // 按学段的科目配置（迁移 004）。旧版备份文件无该字段时跳过，由迁移的默认字典兜底。
    const insSubGrade = tx.prepare(`INSERT INTO subject_grade (subject_id, grade, full_score, counts_to_total, is_active, sort_order)
      VALUES (?, ?, ?, ?, ?, ?)`);
    let gradeCfgCount = 0;
    for (const g of payload.subjectGrades ?? []) {
      insSubGrade.run(g.subject_id, g.grade, g.full_score, g.counts_to_total, g.is_active, g.sort_order);
      gradeCfgCount += 1;
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

    const insSchool = tx.prepare(`INSERT INTO target_school (id, name, short_name, is_target, sort_order, remark, line_mode, custom_line)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    const insAdm = tx.prepare(`INSERT INTO school_admission_score (id, school_id, year, admission_type, min_score, total_full_score, batch, remark)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const s of payload.schools ?? []) {
      insSchool.run(s.id, s.name, s.short_name, s.is_target, s.sort_order, s.remark,
        s.line_mode ?? 'avg3y', s.custom_line ?? null);
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

    audit('data.import', null, `exams=${examCount},scores=${scoreCount},gradeCfg=${gradeCfgCount}`);
    return { imported: { exams: examCount, scores: scoreCount, subjectGrades: gradeCfgCount }, snapshot: snap };
  });
}

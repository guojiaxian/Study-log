import { getDb, audit } from '../db/index.js';
import { Err } from '../lib/errors.js';
import { subjectMap, asBool, gradeFullScore } from './subjectService.js';
import { getExam } from './examService.js';
import { pickLineScore, gapOf, latestPerSubjectTotal, round1 } from '../lib/schoolCompare.js';

/**
 * 目标院校录取线是**中考（初三 730）口径**，因此对比基数只取初三学段的成绩：
 * 初二尚未开设化学、也无体育/实验成绩，混入会让差距虚高（产品手册 FR-7 学段约定）。
 */
export const TARGET_GRADE = 9;

const LINE_MODES = ['avg3y', 'latest', 'custom'];

/** 归一化采用线方式：非法值回退 avg3y；custom 需要有效分数线，否则视为未设置 */
function normalizeLineMode(lineMode, customLine) {
  const mode = LINE_MODES.includes(lineMode) ? lineMode : 'avg3y';
  const line = customLine == null || customLine === '' ? null : Number(customLine);
  if (mode === 'custom' && (line == null || !Number.isFinite(line) || line < 0)) return { mode: 'avg3y', customLine: null };
  return { mode, customLine: line };
}

function shapeSchool(row, scores = []) {
  return {
    schoolId: row.id,
    name: row.name,
    shortName: row.shortName ?? null,
    isTarget: asBool(row.isTarget),
    sortOrder: row.sortOrder,
    remark: row.remark ?? null,
    lineMode: row.lineMode ?? 'avg3y',
    customLine: row.customLine ?? null,
    admissionScores: scores,
    avgScore3y: pickLineScore(scores, 'avg3y').score,
  };
}

function admissionRows(schoolId) {
  return getDb()
    .prepare(`SELECT id, year, admission_type AS admissionType, min_score AS minScore,
              total_full_score AS totalFullScore, batch, remark
              FROM school_admission_score WHERE school_id = ? ORDER BY year DESC`)
    .all(schoolId);
}

export function listSchools() {
  const rows = getDb()
    .prepare(`SELECT id, name, short_name AS shortName, is_target AS isTarget, sort_order AS sortOrder, remark,
              line_mode AS lineMode, custom_line AS customLine
              FROM target_school ORDER BY sort_order, id`)
    .all();
  return rows.map((r) => shapeSchool(r, admissionRows(r.id)));
}

export function getSchool(id) {
  const row = getDb()
    .prepare(`SELECT id, name, short_name AS shortName, is_target AS isTarget, sort_order AS sortOrder, remark,
              line_mode AS lineMode, custom_line AS customLine
              FROM target_school WHERE id = ?`)
    .get(id);
  if (!row) throw Err.notFound('目标院校不存在');
  return shapeSchool(row, admissionRows(id));
}

export function createSchool(input = {}) {
  const db = getDb();
  const { name, shortName = null, isTarget = 1, sortOrder = 0, remark = null, admissionScores = [] } = input;
  if (!name) throw Err.validation('院校名称为必填');
  if (db.prepare('SELECT id FROM target_school WHERE name = ?').get(name)) throw Err.conflict(`院校「${name}」已存在`);
  return (() => {
    const info = db.prepare('INSERT INTO target_school (name, short_name, is_target, sort_order, remark) VALUES (?, ?, ?, ?, ?)')
      .run(name, shortName, isTarget ? 1 : 0, Number(sortOrder), remark);
    const schoolId = Number(info.lastInsertRowid);
    for (const s of admissionScores) insertAdmission(schoolId, s);
    audit('school.create', `school:${schoolId}`);
    return getSchool(schoolId);
  })();
}

export function updateSchool(id, patch = {}) {
  const db = getDb();
  const cur = db.prepare('SELECT * FROM target_school WHERE id = ?').get(id);
  if (!cur) throw Err.notFound('目标院校不存在');
  const { mode, customLine } = normalizeLineMode(
    patch.lineMode ?? cur.line_mode,
    patch.customLine ?? cur.custom_line,
  );
  db.prepare(`UPDATE target_school SET name=?, short_name=?, is_target=?, sort_order=?, remark=?,
              line_mode=?, custom_line=?, updated_at=datetime('now','localtime') WHERE id=?`)
    .run(patch.name ?? cur.name, patch.shortName ?? cur.short_name,
      (patch.isTarget ?? cur.is_target) ? 1 : 0, Number(patch.sortOrder ?? cur.sort_order),
      patch.remark ?? cur.remark, mode, customLine, id);
  audit('school.update', `school:${id}`);
  return getSchool(id);
}

export function deleteSchool(id) {
  const cur = getDb().prepare('SELECT id FROM target_school WHERE id = ?').get(id);
  if (!cur) throw Err.notFound('目标院校不存在');
  getDb().prepare('DELETE FROM target_school WHERE id = ?').run(id);
  audit('school.delete', `school:${id}`);
  return { schoolId: id, deleted: true };
}

function insertAdmission(schoolId, s) {
  if (s.year == null || s.minScore == null) throw Err.validation('录取线需提供 year 与 minScore');
  const db = getDb();
  const info = db.prepare(`INSERT INTO school_admission_score
    (school_id, year, admission_type, min_score, total_full_score, batch, remark) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(schoolId, Number(s.year), s.admissionType ?? '统招', Number(s.minScore),
      Number(s.totalFullScore ?? 730), s.batch ?? null, s.remark ?? null);
  return Number(info.lastInsertRowid);
}

export function createAdmissionScore(schoolId, input = {}) {
  const cur = getDb().prepare('SELECT id FROM target_school WHERE id = ?').get(schoolId);
  if (!cur) throw Err.notFound('目标院校不存在');
  const exist = getDb()
    .prepare('SELECT id FROM school_admission_score WHERE school_id=? AND year=? AND admission_type=?')
    .get(schoolId, Number(input.year), input.admissionType ?? '统招');
  if (exist) throw Err.conflict('该院校该年度该口径的录取线已存在');
  const id = insertAdmission(Number(schoolId), input);
  audit('admission.create', `school:${schoolId}/admission:${id}`);
  return { scoreId: id };
}

export function updateAdmissionScore(schoolId, scoreId, patch = {}) {
  const db = getDb();
  const cur = db.prepare('SELECT * FROM school_admission_score WHERE id=? AND school_id=?').get(scoreId, schoolId);
  if (!cur) throw Err.notFound('录取线记录不存在');
  db.prepare(`UPDATE school_admission_score SET year=?, admission_type=?, min_score=?, total_full_score=?, batch=?, remark=? WHERE id=?`)
    .run(Number(patch.year ?? cur.year), patch.admissionType ?? cur.admission_type,
      Number(patch.minScore ?? cur.min_score), Number(patch.totalFullScore ?? cur.total_full_score),
      patch.batch ?? cur.batch, patch.remark ?? cur.remark, scoreId);
  audit('admission.update', `school:${schoolId}/admission:${scoreId}`);
  return { scoreId: Number(scoreId) };
}

export function deleteAdmissionScore(schoolId, scoreId) {
  const info = getDb().prepare('DELETE FROM school_admission_score WHERE id=? AND school_id=?').run(scoreId, schoolId);
  if (info.changes === 0) throw Err.notFound('录取线记录不存在');
  audit('admission.delete', `school:${schoolId}/admission:${scoreId}`);
  return { deleted: true };
}

/* ------------------------------------------------------------------ */
/* 目标对比                                                           */
/* ------------------------------------------------------------------ */

export function compareSchools(opts = {}) {
  const db = getDb();
  const mode = opts.examId ? 'examId' : 'latestPerSubject';

  let myTotal = null;
  let components = [];
  let missingSubjects = [];

  if (opts.examId) {
    const e = getExam(opts.examId);
    if (e.grade !== TARGET_GRADE) {
      throw Err.validation('目标院校录取线为中考口径，仅支持按初三（grade=9）的考试对比');
    }
    myTotal = e.totalScore;
  } else {
    const subs = subjectMap(TARGET_GRADE);
    const scoreSubjects = [...subs.values()].filter((s) => s.countsToTotal && s.scoreMode === 'score');
    const rows = db
      .prepare(`SELECT s.subject_id AS subjectId, s.score, s.is_absent AS isAbsent,
                e.id AS examId, e.exam_date AS examDate, sub.name AS subjectName,
                COALESCE(sg.counts_to_total, sub.counts_to_total) AS countsToTotal,
                sub.score_mode AS scoreMode
                FROM exam_score s
                JOIN exam e ON e.id = s.exam_id
                JOIN subject sub ON sub.id = s.subject_id
                LEFT JOIN subject_grade sg ON sg.subject_id = s.subject_id AND sg.grade = ?
                WHERE e.status = 'confirmed' AND e.grade = ?`)
      .all(TARGET_GRADE, TARGET_GRADE);
    const res = latestPerSubjectTotal(rows);
    myTotal = res.total;
    components = res.components;
    const got = new Set(res.components.map((c) => c.subjectId));
    missingSubjects = scoreSubjects.filter((s) => !got.has(s.id)).map((s) => s.id);
  }

  const schools = db
    .prepare(`SELECT id, name, short_name AS shortName, sort_order AS sortOrder,
              line_mode AS lineMode, custom_line AS customLine
              FROM target_school WHERE is_target = 1 ORDER BY sort_order, id`)
    .all();

  const schoolRows = schools.map((sch) => {
    const rows = db
      .prepare(`SELECT year, min_score AS minScore, total_full_score AS totalFullScore
                FROM school_admission_score WHERE school_id = ? AND admission_type = '统招' ORDER BY year DESC`)
      .all(sch.id);
    // 采用线方式按院校逐校配置（管理页可改）：avg3y / latest / custom
    let picked;
    if (sch.lineMode === 'custom' && sch.customLine != null) {
      picked = { score: round1(sch.customLine), years: [], mode: 'custom' };
    } else {
      picked = pickLineScore(rows, sch.lineMode === 'latest' ? 'latest' : 'avg3y');
    }
    const gap = gapOf(picked.score, myTotal);
    return {
      schoolId: sch.id,
      name: sch.name,
      shortName: sch.shortName,
      lineMode: picked.mode,
      lineScore: picked.score,
      lineYears: picked.years,
      gap,
      status: gap == null ? 'unknown' : gap <= 0 ? 'above' : 'below',
      yearly: rows.map((r) => ({ year: r.year, minScore: r.minScore })).sort((a, b) => a.year - b.year),
    };
  });

  return {
    basis: { mode, grade: TARGET_GRADE, myTotal, totalFullScore: gradeFullScore(TARGET_GRADE), components, missingSubjects },
    schools: schoolRows,
    notes: [
      'gap = 录取线 − 中考口径总分；负值表示还需提分，正值表示已超线',
      '各校采用线方式独立配置（近三年均值/最近一年/自定义），见管理页「目标院校」',
      '中考口径总分只取初三学段各计分科目「最近一次已录入得分」',
      '若 missingSubjects 非空，说明存在从未录入的计入总分科目，对比结果偏低',
    ],
  };
}

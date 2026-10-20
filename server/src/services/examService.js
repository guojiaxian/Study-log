import { getDb, transaction, audit } from '../db/index.js';
import { Err } from '../lib/errors.js';
import { getRankSizes } from './configService.js';
import { subjectMap, asBool, gradeFullScore, GRADE_LABEL } from './subjectService.js';
import { assertExamType, listExamTypes } from './examTypeService.js';
import { round2 } from '../lib/metrics.js';

/**
 * 各学段总分满分（初二 570 / 初三 730），由该学段科目字典推导，
 * 不再是全局常量——两学段科目与满分本就不同（见迁移 004）。
 */
export { gradeFullScore, GRADE_LABEL };

const EXAM_COLS = `e.id AS examId, e.name, e.exam_type AS examType, e.exam_date AS examDate,
  e.grade, e.term, e.status, e.source, e.remark,
  e.class_rank AS classRank, e.class_size AS classSize,
  e.grade_rank AS gradeRank, e.grade_size AS gradeSize,
  e.created_at AS createdAt, e.updated_at AS updatedAt,
  v.entered_subject_count AS enteredSubjectCount, v.total_score AS totalScore,
  v.entered_full_score AS enteredFullScore`;

/** 单项测试类型：只覆盖 1 科，默认不进入趋势/对比，避免总分口径断裂 */
export const SPECIAL_EXAM_TYPES = ['sport', 'lab'];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const GRADE_LEVELS = ['A', 'B', 'C', 'D'];

function typeNameMap() {
  return new Map(listExamTypes({ includeInactive: true }).map((t) => [t.code, t.name]));
}

function shapeExam(row, typeMap = typeNameMap()) {
  if (!row) return row;
  return {
    ...row,
    examTypeName: typeMap.get(row.examType) ?? row.examType,
    totalScore: round2(row.totalScore ?? 0),
    gradeLabel: GRADE_LABEL[row.grade] ?? null,
    totalFullScore: gradeFullScore(row.grade),
    enteredFullScore: round2(row.enteredFullScore ?? 0),
    enteredSubjectCount: Number(row.enteredSubjectCount ?? 0),
  };
}

function assertRank(name, rank, size) {
  if (rank == null) return;
  if (size == null) throw Err.constraint(`${name}排名已填写，请先在「管理 → 排名人数设置」中填写${name}人数`);
  if (Number(rank) < 1) throw Err.constraint(`${name}排名必须 ≥ 1`);
  if (Number(rank) > Number(size)) throw Err.constraint(`${name}排名不能大于${name}人数`);
}

/** 人数来源：请求未显式提供时取「管理 → 排名人数设置」的全局配置（可为 null，即允许不填） */
function sizeOrDefault(requested, configured) {
  return requested != null ? requested : configured;
}

export function listExams(q = {}) {
  const db = getDb();
  const where = [];
  const params = [];
  if (q.type) { where.push('e.exam_type = ?'); params.push(q.type); }
  if (q.grade) { where.push('e.grade = ?'); params.push(Number(q.grade)); }
  if (q.status) { where.push('e.status = ?'); params.push(q.status); }
  if (q.from) { where.push('e.exam_date >= ?'); params.push(q.from); }
  if (q.to) { where.push('e.exam_date <= ?'); params.push(q.to); }
  if (q.keyword) { where.push('e.name LIKE ?'); params.push(`%${q.keyword}%`); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const page = Math.max(1, Number(q.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(q.pageSize) || 20));
  const total = Number(db.prepare(`SELECT COUNT(*) AS c FROM exam e ${w}`).get(...params).c);
  const rows = db
    .prepare(`SELECT ${EXAM_COLS} FROM exam e
              LEFT JOIN v_exam_summary v ON v.exam_id = e.id
              ${w} ORDER BY e.exam_date DESC, e.id DESC LIMIT ? OFFSET ?`)
    .all(...params, pageSize, (page - 1) * pageSize);

  const tm = typeNameMap();
  return { list: rows.map((r) => shapeExam(r, tm)), total, page, pageSize };
}

export function getExamRow(id) {
  const row = getDb()
    .prepare(`SELECT ${EXAM_COLS} FROM exam e LEFT JOIN v_exam_summary v ON v.exam_id = e.id WHERE e.id = ?`)
    .get(id);
  return row ? shapeExam(row) : null;
}

export function getExamScores(examId) {
  return getDb()
    .prepare(`SELECT s.id, s.exam_id AS examId, s.subject_id AS subjectId,
              sub.code AS subjectCode, sub.name AS subjectName, sub.score_mode AS scoreMode,
              e.grade AS grade,
              COALESCE(sg.counts_to_total, sub.counts_to_total) AS countsToTotal,
              COALESCE(sg.full_score, sub.full_score) AS fullScore,
              s.score, s.grade_level AS gradeLevel, s.is_absent AS isAbsent,
              s.class_rank AS classRank, s.grade_rank AS gradeRank, s.remark
              FROM exam_score s
              JOIN exam e ON e.id = s.exam_id
              JOIN subject sub ON sub.id = s.subject_id
              LEFT JOIN subject_grade sg ON sg.subject_id = s.subject_id AND sg.grade = e.grade
              WHERE s.exam_id = ? ORDER BY COALESCE(sg.sort_order, sub.sort_order), sub.id`)
    .all(examId)
    .map((r) => ({ ...r, isAbsent: asBool(r.isAbsent), countsToTotal: asBool(r.countsToTotal) }));
}

export function getExam(id) {
  const exam = getExamRow(id);
  if (!exam) throw Err.notFound('考试不存在');
  return { ...exam, scores: getExamScores(id) };
}

/** 校验单条成绩写入 */
function validateScoreItem(item, sub) {
  if (!sub) throw Err.validation(`科目 ${item.subjectId} 不存在或未在该学段开课`);
  if (!sub.isActive) throw Err.validation(`科目「${sub.name}」已停用，不能录入`);
  const isAbsent = item.isAbsent ? 1 : 0;
  if (isAbsent) return { score: null, gradeLevel: null, isAbsent: 1, classRank: null, gradeRank: null, remark: item.remark ?? null };
  if (sub.scoreMode === 'grade') {
    if (item.score != null) throw Err.constraint(`科目「${sub.name}」为等级制，不应填写分数`);
    if (!GRADE_LEVELS.includes(item.gradeLevel)) throw Err.constraint(`科目「${sub.name}」等级必须为 A/B/C/D`);
    return { score: null, gradeLevel: item.gradeLevel, isAbsent: 0, classRank: null, gradeRank: null, remark: item.remark ?? null };
  }
  if (item.score == null || Number.isNaN(Number(item.score))) throw Err.constraint(`科目「${sub.name}」必须填写得分`);
  const score = Number(item.score);
  if (score < 0 || score > sub.fullScore) {
    throw Err.constraint(`科目「${sub.name}」得分必须在 0 ~ ${sub.fullScore} 之间（中考口径满分）`);
  }
  return {
    score, gradeLevel: null, isAbsent: 0,
    classRank: item.classRank ?? null, gradeRank: item.gradeRank ?? null,
    remark: item.remark ?? null,
  };
}

/** 整体替换某次考试的成绩（事务内先删后写） */
function writeScores(db, examId, scores) {
  // 满分/是否计入总分按「本次考试的学段」取，故先取 grade
  const examRow = db.prepare('SELECT grade FROM exam WHERE id = ?').get(examId);
  const subs = subjectMap(examRow?.grade);
  const seen = new Set();
  const prepared = [];
  for (const item of scores || []) {
    if (seen.has(item.subjectId)) throw Err.conflict(`科目 ${item.subjectId} 在同一次考试中重复`);
    seen.add(item.subjectId);
    const sub = subs.get(item.subjectId);
    prepared.push({ item, v: validateScoreItem(item, sub) });
  }
  db.prepare('DELETE FROM exam_score WHERE exam_id = ?').run(examId);
  const ins = db.prepare(`INSERT INTO exam_score
    (exam_id, subject_id, score, grade_level, is_absent, class_rank, grade_rank, remark)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const { item, v } of prepared) {
    ins.run(examId, item.subjectId, v.score, v.gradeLevel, v.isAbsent, v.classRank, v.gradeRank, v.remark);
  }
  return prepared.length;
}

function assertExamMeta(payload, { partial = false } = {}) {
  const p = payload || {};
  if (!partial || p.name != null) {
    if (!p.name || !String(p.name).trim()) throw Err.validation('考试名称为必填');
  }
  if (!partial || p.examType != null) assertExamType(p.examType);
  if (!partial || p.examDate != null) {
    if (!DATE_RE.test(String(p.examDate))) throw Err.validation('examDate 格式应为 YYYY-MM-DD');
  }
  if (p.status != null && !['draft', 'confirmed'].includes(p.status)) {
    throw Err.validation('status 只能为 draft 或 confirmed');
  }
  if (!partial || p.grade != null) {
    const g = Number(p.grade ?? 9);
    if (![8, 9].includes(g)) throw Err.validation('grade 只能为 8（初二）或 9（初三）');
  }
  assertRank('班级', p.classRank, p.classSize);
  assertRank('年级', p.gradeRank, p.gradeSize);
}

export function createExam(payload = {}) {
  const sizes = getRankSizes();
  const p = {
    ...payload,
    classSize: sizeOrDefault(payload.classSize, sizes.classSize),
    gradeSize: sizeOrDefault(payload.gradeSize, sizes.gradeSize),
  };
  assertExamMeta(p);
  return transaction((db) => {
    const info = db.prepare(`INSERT INTO exam
      (name, exam_type, exam_date, grade, term, status, source, remark, class_rank, class_size, grade_rank, grade_size)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(p.name.trim(), p.examType, p.examDate, Number(p.grade ?? 9), p.term ?? null,
        p.status ?? 'confirmed', p.source === 'ai_import' ? 'ai_import' : 'manual', p.remark ?? null,
        p.classRank ?? null, p.classSize ?? null, p.gradeRank ?? null, p.gradeSize ?? null);
    const examId = Number(info.lastInsertRowid);
    const written = writeScores(db, examId, p.scores || []);
    audit('exam.create', `exam:${examId}`, `scores=${written}`);
    return { examId, written };
  });
}

export function updateExam(id, patch = {}) {
  const cur = getDb().prepare('SELECT * FROM exam WHERE id = ?').get(id);
  if (!cur) throw Err.notFound('考试不存在');
  // 人数统一以「管理 → 排名人数设置」为准：请求未显式提供时取全局配置
  const sizes = getRankSizes();
  const merged = {
    name: patch.name ?? cur.name,
    examType: patch.examType ?? cur.exam_type,
    examDate: patch.examDate ?? cur.exam_date,
    grade: patch.grade ?? cur.grade,
    term: patch.term ?? cur.term,
    status: patch.status ?? cur.status,
    remark: patch.remark ?? cur.remark,
    classRank: patch.classRank !== undefined ? patch.classRank : cur.class_rank,
    classSize: patch.classSize !== undefined ? patch.classSize : cur.class_size ?? sizes.classSize,
    gradeRank: patch.gradeRank !== undefined ? patch.gradeRank : cur.grade_rank,
    gradeSize: patch.gradeSize !== undefined ? patch.gradeSize : cur.grade_size ?? sizes.gradeSize,
  };
  assertExamMeta(merged);

  return transaction((db) => {
    db.prepare(`UPDATE exam SET name=?, exam_type=?, exam_date=?, grade=?, term=?, status=?, remark=?,
                class_rank=?, class_size=?, grade_rank=?, grade_size=?,
                updated_at=datetime('now','localtime') WHERE id=?`)
      .run(merged.name.trim(), merged.examType, merged.examDate, Number(merged.grade), merged.term,
        merged.status, merged.remark, merged.classRank ?? null, merged.classSize ?? null,
        merged.gradeRank ?? null, merged.gradeSize ?? null, id);
    let written = null;
    if (Array.isArray(patch.scores)) written = writeScores(db, id, patch.scores);
    audit('exam.update', `exam:${id}`, written != null ? `scores=${written}` : null);
    const fields = Object.keys(patch).filter((k) => k !== 'scores');
    return { examId: id, updated: fields, written };
  });
}

export function deleteExam(id) {
  const exam = getDb().prepare('SELECT id FROM exam WHERE id = ?').get(id);
  if (!exam) throw Err.notFound('考试不存在');
  const db = getDb();
  db.prepare('DELETE FROM exam WHERE id = ?').run(id);
  audit('exam.delete', `exam:${id}`);
  return { examId: id, deleted: true };
}

export function replaceScores(examId, scores = []) {
  const exam = getDb().prepare('SELECT id FROM exam WHERE id = ?').get(examId);
  if (!exam) throw Err.notFound('考试不存在');
  return transaction((db) => {
    const written = writeScores(db, examId, scores);
    audit('score.replace', `exam:${examId}`, `written=${written}`);
    return { written };
  });
}

export function patchScore(examId, subjectId, patch = {}) {
  const db = getDb();
  const exam = db.prepare('SELECT id, grade FROM exam WHERE id = ?').get(examId);
  if (!exam) throw Err.notFound('考试不存在');
  // 满分按「本次考试的学段」取，避免历史（初二 70 / 初三 50）按错误口径校验
  const subs = subjectMap(exam.grade);
  const sub = subs.get(Number(subjectId));
  const v = validateScoreItem({ ...patch, subjectId: Number(subjectId) }, sub);

  const exist = db.prepare('SELECT id FROM exam_score WHERE exam_id=? AND subject_id=?').get(examId, subjectId);
  if (exist) {
    db.prepare(`UPDATE exam_score SET score=?, grade_level=?, is_absent=?, class_rank=?, grade_rank=?, remark=?,
                updated_at=datetime('now','localtime') WHERE id=?`)
      .run(v.score, v.gradeLevel, v.isAbsent, v.classRank, v.gradeRank, v.remark, exist.id);
  } else {
    db.prepare(`INSERT INTO exam_score (exam_id, subject_id, score, grade_level, is_absent, class_rank, grade_rank, remark)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(examId, subjectId, v.score, v.gradeLevel, v.isAbsent, v.classRank, v.gradeRank, v.remark);
  }
  audit('score.patch', `exam:${examId}/subject:${subjectId}`);
  return { examId: Number(examId), subjectId: Number(subjectId) };
}

export function deleteScore(examId, subjectId) {
  const info = getDb().prepare('DELETE FROM exam_score WHERE exam_id=? AND subject_id=?').run(examId, subjectId);
  if (info.changes === 0) throw Err.notFound('成绩记录不存在');
  audit('score.delete', `exam:${examId}/subject:${subjectId}`);
  return { deleted: true };
}

/** 统计用：按范围取已确认考试（升序） */
export function findExamsForStats({ from, to, types, grade, includeDraft = false } = {}) {
  const db = getDb();
  const where = [];
  const params = [];
  if (!includeDraft) where.push("e.status = 'confirmed'");
  if (from) { where.push('e.exam_date >= ?'); params.push(from); }
  if (to) { where.push('e.exam_date <= ?'); params.push(to); }
  // 学段过滤：不传/传 all 表示不限制（两学段混看）
  if (grade != null && grade !== '' && grade !== 'all') { where.push('e.grade = ?'); params.push(Number(grade)); }
  if (types && types.length) {
    where.push(`e.exam_type IN (${types.map(() => '?').join(',')})`);
    params.push(...types);
  } else {
    where.push(`e.exam_type NOT IN (${SPECIAL_EXAM_TYPES.map(() => '?').join(',')})`);
    params.push(...SPECIAL_EXAM_TYPES);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return db.prepare(`SELECT ${EXAM_COLS} FROM exam e
      LEFT JOIN v_exam_summary v ON v.exam_id = e.id
      ${w} ORDER BY e.exam_date ASC, e.id ASC`).all(...params).map((r) => shapeExam(r));
}

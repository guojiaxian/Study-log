import { getDb, audit } from '../db/index.js';
import { Err } from '../lib/errors.js';

/**
 * 科目字典按「学段」提供：初二(8) / 初三(9)。
 * 科目身份（code/name/score_mode）存在 subject 表；
 * 满分/是否计入总分/是否启用/排序存在 subject_grade（按 (科目, 学段) 维护）。
 * 读取一律以 subject_grade 为准（缺失时回退 subject 旧列）。
 */
export const GRADES = [8, 9];
export const GRADE_LABEL = { 8: '初二', 9: '初三' };

export const asBool = (v) => v === 1 || v === true;

const COLS = `s.id, s.code, s.name, s.score_mode AS scoreMode,
  sg.grade AS grade,
  COALESCE(sg.full_score, s.full_score) AS fullScore,
  COALESCE(sg.counts_to_total, s.counts_to_total) AS countsToTotal,
  COALESCE(sg.is_active, s.is_active) AS isActive,
  COALESCE(sg.sort_order, s.sort_order) AS sortOrder`;

const FROM = `FROM subject s JOIN subject_grade sg ON sg.subject_id = s.id`;

function shape(row) {
  if (!row) return row;
  return {
    ...row,
    gradeLabel: GRADE_LABEL[row.grade] ?? null,
    countsToTotal: asBool(row.countsToTotal),
    isActive: asBool(row.isActive),
  };
}

function assertGrade(grade) {
  if (!GRADES.includes(Number(grade))) throw Err.validation('学段 grade 只能为 8（初二）或 9（初三）');
}

/** 内部/统计用：按学段取科目（默认含停用）。不给 grade 则返回全部学段的科目 */
export function listSubjectsRaw({ grade, includeInactive = true } = {}) {
  const where = [];
  const params = [];
  if (grade != null) { where.push('sg.grade = ?'); params.push(Number(grade)); }
  if (!includeInactive) where.push('COALESCE(sg.is_active, s.is_active) = 1');
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return getDb()
    .prepare(`SELECT ${COLS} ${FROM} ${w} ORDER BY COALESCE(sg.sort_order, s.sort_order), s.id`)
    .all(...params)
    .map(shape);
}

/** examId 校验用：某学段 id -> 科目行 */
export function subjectMap(grade) {
  const m = new Map();
  for (const s of listSubjectsRaw({ grade, includeInactive: true })) m.set(s.id, s);
  return m;
}

export function listSubjects({ grade, includeInactive = false } = {}) {
  return listSubjectsRaw({ grade, includeInactive });
}

export function getSubject(id, grade = null) {
  const rows = listSubjectsRaw({ grade, includeInactive: true }).filter((s) => s.id === Number(id));
  return rows[0] ?? null;
}

/* ------------------------------------------------------------------ */
/* 学段口径                                                            */
/* ------------------------------------------------------------------ */

const _fullScoreCache = new Map();

/** 某学段的「全科满分」= 启用且计入总分科目的满分之和（初二 570 / 初三 730） */
export function gradeFullScore(grade) {
  const g = Number(grade);
  if (_fullScoreCache.has(g)) return _fullScoreCache.get(g);
  const row = getDb()
    .prepare('SELECT COALESCE(SUM(full_score), 0) AS v FROM subject_grade WHERE grade = ? AND counts_to_total = 1 AND is_active = 1')
    .get(g);
  const v = Number(row?.v ?? 0);
  _fullScoreCache.set(g, v);
  return v;
}

export function invalidateSubjectCache() {
  _fullScoreCache.clear();
}

/** 学段列表（供前端下拉） */
export function listGrades() {
  return GRADES.map((g) => ({ grade: g, label: GRADE_LABEL[g], fullScore: gradeFullScore(g) }));
}

/* ------------------------------------------------------------------ */
/* 增删改（均以「学段」为粒度）                                        */
/* ------------------------------------------------------------------ */

/**
 * 在指定学段新增科目：
 * - code 已存在 → 仅给该学段补一条配置（即"把已有科目加到该学段"）
 * - code 不存在 → 新建科目并写入该学段配置
 */
export function createSubject(input = {}) {
  const db = getDb();
  const {
    code, name, grade, fullScore = 100, scoreMode = 'score',
    countsToTotal = 1, sortOrder = 0, isActive = 1,
  } = input;
  assertGrade(grade);
  if (!code || !name) throw Err.validation('code 与 name 为必填');
  if (!['score', 'grade'].includes(scoreMode)) throw Err.validation('scoreMode 只能为 score 或 grade');
  const g = Number(grade);

  let sub = db.prepare('SELECT id FROM subject WHERE code = ?').get(code);
  if (!sub) {
    const info = db.prepare(`INSERT INTO subject (code, name, full_score, score_mode, counts_to_total, start_grade, sort_order, is_active)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(code, name, Number(fullScore), scoreMode, countsToTotal ? 1 : 0, g, Number(sortOrder), isActive ? 1 : 0);
    sub = { id: Number(info.lastInsertRowid) };
  }
  const dup = db.prepare('SELECT 1 AS x FROM subject_grade WHERE subject_id = ? AND grade = ?').get(sub.id, g);
  if (dup) throw Err.conflict(`科目「${code}」在${GRADE_LABEL[g]}已存在`);

  db.prepare(`INSERT INTO subject_grade (subject_id, grade, full_score, counts_to_total, is_active, sort_order)
              VALUES (?, ?, ?, ?, ?, ?)`)
    .run(sub.id, g, Number(fullScore), countsToTotal ? 1 : 0, isActive ? 1 : 0, Number(sortOrder));
  invalidateSubjectCache();
  audit('subject.create', `subject:${sub.id}/grade:${g}`);
  return getSubject(sub.id, g);
}

/** 更新某学段下的科目配置（名称变更作用于科目本身） */
export function updateSubject(id, patch = {}) {
  const db = getDb();
  const grade = patch.grade != null ? Number(patch.grade) : null;
  if (grade == null) throw Err.validation('grade 为必填（8 或 9）');
  assertGrade(grade);

  const cur = getSubject(id, grade);
  if (!cur) throw Err.notFound('该学段下不存在此科目');

  const next = {
    name: patch.name ?? cur.name,
    fullScore: patch.fullScore ?? cur.fullScore,
    scoreMode: patch.scoreMode ?? cur.scoreMode,
    countsToTotal: patch.countsToTotal ?? (cur.countsToTotal ? 1 : 0),
    sortOrder: patch.sortOrder ?? cur.sortOrder,
    isActive: patch.isActive ?? (cur.isActive ? 1 : 0),
  };
  if (!['score', 'grade'].includes(next.scoreMode)) throw Err.validation('scoreMode 只能为 score 或 grade');
  if (!(Number(next.fullScore) > 0)) throw Err.validation('满分必须大于 0');

  db.prepare('UPDATE subject SET name = ?, score_mode = ?, updated_at = datetime(\'now\',\'localtime\') WHERE id = ?')
    .run(next.name, next.scoreMode, id);
  db.prepare(`UPDATE subject_grade SET full_score=?, counts_to_total=?, is_active=?, sort_order=?,
              updated_at=datetime('now','localtime') WHERE subject_id=? AND grade=?`)
    .run(Number(next.fullScore), next.countsToTotal ? 1 : 0, next.isActive ? 1 : 0, Number(next.sortOrder), id, grade);
  invalidateSubjectCache();
  audit('subject.update', `subject:${id}/grade:${grade}`);
  return getSubject(id, grade);
}

/**
 * 删除某学段下的科目配置：
 * - 该学段已有成绩引用 → 仅停用（软删除）
 * - 无引用 → 删除该学段配置；若科目已无任何学段配置则一并删除科目
 */
export function deleteSubject(id, grade) {
  const db = getDb();
  const g = Number(grade);
  assertGrade(g);
  const cur = getSubject(id, g);
  if (!cur) throw Err.notFound('该学段下不存在此科目');

  const used = db.prepare(`SELECT COUNT(*) AS c FROM exam_score s
                           JOIN exam e ON e.id = s.exam_id
                           WHERE s.subject_id = ? AND e.grade = ?`).get(id, g).c;
  if (used > 0) {
    db.prepare(`UPDATE subject_grade SET is_active = 0, updated_at = datetime('now','localtime')
                WHERE subject_id = ? AND grade = ?`).run(id, g);
    invalidateSubjectCache();
    audit('subject.disable', `subject:${id}/grade:${g}`, `已被 ${used} 条成绩引用`);
    return { deleted: false, disabled: true, referenced: used };
  }

  db.prepare('DELETE FROM subject_grade WHERE subject_id = ? AND grade = ?').run(id, g);
  const left = db.prepare('SELECT COUNT(*) AS c FROM subject_grade WHERE subject_id = ?').get(id).c;
  if (!left) db.prepare('DELETE FROM subject WHERE id = ?').run(id);
  invalidateSubjectCache();
  audit('subject.delete', `subject:${id}/grade:${g}`);
  return { deleted: true, disabled: false, referenced: 0 };
}

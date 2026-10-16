import { getDb, audit } from '../db/index.js';
import { Err } from '../lib/errors.js';

const COLS = `id, code, name, full_score AS fullScore, score_mode AS scoreMode,
  counts_to_total AS countsToTotal, start_grade AS startGrade,
  sort_order AS sortOrder, is_active AS isActive`;

export const asBool = (v) => v === 1 || v === true;

function shape(row) {
  if (!row) return row;
  return { ...row, countsToTotal: asBool(row.countsToTotal), isActive: asBool(row.isActive) };
}

/** 供内部统计使用：含停用科目 */
export function listSubjectsRaw() {
  return getDb().prepare(`SELECT ${COLS} FROM subject ORDER BY sort_order, id`).all().map(shape);
}

export function subjectMap() {
  const m = new Map();
  for (const s of listSubjectsRaw()) m.set(s.id, s);
  return m;
}

export function listSubjects({ includeInactive = false } = {}) {
  const where = includeInactive ? '' : 'WHERE is_active = 1';
  return getDb()
    .prepare(`SELECT ${COLS} FROM subject ${where} ORDER BY sort_order, id`)
    .all()
    .map(shape);
}

export function getSubject(id) {
  const row = getDb().prepare(`SELECT ${COLS} FROM subject WHERE id = ?`).get(id);
  return row ? shape(row) : null;
}

export function createSubject(input) {
  const db = getDb();
  const {
    code, name, fullScore = 100, scoreMode = 'score',
    countsToTotal = 1, startGrade = 7, sortOrder = 0, isActive = 1,
  } = input || {};
  if (!code || !name) throw Err.validation('code 与 name 为必填');
  if (!['score', 'grade'].includes(scoreMode)) throw Err.validation('scoreMode 只能为 score 或 grade');
  if (![7, 8, 9].includes(Number(startGrade))) throw Err.validation('startGrade 只能为 7/8/9');
  const dup = db.prepare('SELECT id FROM subject WHERE code = ?').get(code);
  if (dup) throw Err.conflict(`科目 code「${code}」已存在`);

  const info = db
    .prepare(`INSERT INTO subject (code, name, full_score, score_mode, counts_to_total, start_grade, sort_order, is_active)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(code, name, Number(fullScore), scoreMode, countsToTotal ? 1 : 0, Number(startGrade), Number(sortOrder), isActive ? 1 : 0);
  audit('subject.create', `subject:${Number(info.lastInsertRowid)}`);
  return getSubject(Number(info.lastInsertRowid));
}

export function updateSubject(id, patch = {}) {
  const db = getDb();
  const cur = getSubject(id);
  if (!cur) throw Err.notFound('科目不存在');

  const next = {
    name: patch.name ?? cur.name,
    fullScore: patch.fullScore ?? cur.fullScore,
    scoreMode: patch.scoreMode ?? cur.scoreMode,
    countsToTotal: patch.countsToTotal ?? (cur.countsToTotal ? 1 : 0),
    startGrade: patch.startGrade ?? cur.startGrade,
    sortOrder: patch.sortOrder ?? cur.sortOrder,
    isActive: patch.isActive ?? (cur.isActive ? 1 : 0),
  };
  if (!['score', 'grade'].includes(next.scoreMode)) throw Err.validation('scoreMode 只能为 score 或 grade');

  db.prepare(`UPDATE subject SET name=?, full_score=?, score_mode=?, counts_to_total=?, start_grade=?, sort_order=?, is_active=?,
              updated_at=datetime('now','localtime') WHERE id=?`)
    .run(next.name, Number(next.fullScore), next.scoreMode, next.countsToTotal ? 1 : 0,
      Number(next.startGrade), Number(next.sortOrder), next.isActive ? 1 : 0, id);
  audit('subject.update', `subject:${id}`);
  return getSubject(id);
}

export function deleteSubject(id) {
  const db = getDb();
  const cur = getSubject(id);
  if (!cur) throw Err.notFound('科目不存在');
  const used = db.prepare('SELECT COUNT(*) AS c FROM exam_score WHERE subject_id = ?').get(id).c;
  if (used > 0) {
    // 软删除：仅停用
    db.prepare(`UPDATE subject SET is_active = 0, updated_at = datetime('now','localtime') WHERE id = ?`).run(id);
    audit('subject.disable', `subject:${id}`, `已被 ${used} 条成绩引用`);
    return { deleted: false, disabled: true, referenced: used };
  }
  db.prepare('DELETE FROM subject WHERE id = ?').run(id);
  audit('subject.delete', `subject:${id}`);
  return { deleted: true, disabled: false, referenced: 0 };
}

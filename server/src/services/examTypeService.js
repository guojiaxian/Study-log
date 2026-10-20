import { getDb, audit } from '../db/index.js';
import { Err } from '../lib/errors.js';

export const asBool = (v) => v === 1 || v === true;

export function listExamTypes({ includeInactive = false } = {}) {
  const where = includeInactive ? '' : 'WHERE is_active = 1';
  return getDb()
    .prepare(`SELECT id, code, name, sort_order AS sortOrder, is_active AS isActive FROM exam_type_dict ${where} ORDER BY sort_order, id`)
    .all()
    .map((r) => ({ ...r, isActive: asBool(r.isActive) }));
}

export function examTypeCodes() {
  return new Set(listExamTypes({ includeInactive: true }).map((t) => t.code));
}

export function assertExamType(code) {
  const row = getDb().prepare('SELECT id FROM exam_type_dict WHERE code = ? AND is_active = 1').get(code);
  if (!row) throw Err.validation(`examType「${code}」不存在或已停用`);
}

export function createExamType(input = {}) {
  const db = getDb();
  const { code, name, sortOrder = 0, isActive = 1 } = input;
  if (!code || !name) throw Err.validation('code 与 name 为必填');
  if (db.prepare('SELECT id FROM exam_type_dict WHERE code = ?').get(code)) {
    throw Err.conflict(`考试类型「${code}」已存在`);
  }
  const info = db.prepare('INSERT INTO exam_type_dict (code, name, sort_order, is_active) VALUES (?, ?, ?, ?)')
    .run(code, name, Number(sortOrder), isActive ? 1 : 0);
  audit('examType.create', `examType:${Number(info.lastInsertRowid)}`);
  return Number(info.lastInsertRowid);
}

export function updateExamType(id, patch = {}) {
  const db = getDb();
  const cur = db.prepare('SELECT * FROM exam_type_dict WHERE id = ?').get(id);
  if (!cur) throw Err.notFound('考试类型不存在');
  db.prepare(`UPDATE exam_type_dict SET name=?, sort_order=?, is_active=? WHERE id=?`)
    .run(patch.name ?? cur.name, Number(patch.sortOrder ?? cur.sort_order),
      (patch.isActive ?? cur.is_active) ? 1 : 0, id);
  audit('examType.update', `examType:${id}`);
  return id;
}

/** 删除考试类型；已被成绩引用的类型不允许删除（避免历史成绩类型无法回显） */
export function deleteExamType(id) {
  const db = getDb();
  const cur = db.prepare('SELECT * FROM exam_type_dict WHERE id = ?').get(id);
  if (!cur) throw Err.notFound('考试类型不存在');
  const used = db.prepare('SELECT COUNT(*) AS n FROM exam WHERE exam_type = ?').get(cur.code).n;
  if (used > 0) {
    throw Err.conflict(`类型「${cur.name}」已被 ${used} 场考试使用，不能删除；如不再使用可在名称前加「（停用）」标记`);
  }
  db.prepare('DELETE FROM exam_type_dict WHERE id = ?').run(id);
  audit('examType.delete', `examType:${id}`);
  return id;
}

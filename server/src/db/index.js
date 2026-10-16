import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';

const DEFAULT_DB_PATH = './data/studylog.db';

let _db = null;

/** 解析并确保父目录存在 */
function resolveDbPath(dbPath) {
  const abs = path.resolve(dbPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  return abs;
}

/** 建立连接并施加 PRAGMA 调优（对应开发手册 4.2） */
export function openDb(dbPath = process.env.DB_PATH || DEFAULT_DB_PATH) {
  const abs = resolveDbPath(dbPath);
  const db = new DatabaseSync(abs);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 5000;
    PRAGMA cache_size = -8000;
    PRAGMA temp_store = MEMORY;
    PRAGMA mmap_size = 134217728;
  `);
  return db;
}

/** 进程内单例连接 */
export function getDb() {
  if (!_db) _db = openDb();
  return _db;
}

/** 同步事务封装；抛错自动回滚 */
export function transaction(fn) {
  const db = getDb();
  db.exec('BEGIN');
  try {
    const result = fn(db);
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  }
}

export function closeDb() {
  if (_db) {
    try { _db.close(); } catch { /* ignore */ }
    _db = null;
  }
}

/** 统一的写入审计日志（表存在时） */
export function audit(action, target = null, detail = null) {
  try {
    getDb().prepare('INSERT INTO audit_log (action, target, detail) VALUES (?, ?, ?)')
      .run(action, target, detail);
  } catch { /* 审计失败不影响主流程 */ }
}

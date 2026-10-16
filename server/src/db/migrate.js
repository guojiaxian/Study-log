import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getDb } from './index.js';
import { loadEnv } from '../lib/loadEnv.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

/**
 * 顺序迁移执行器（schema_version 驱动）。
 * 每个迁移文件在单事务内执行，失败即回滚并拒绝启动。
 */
export function runMigrations() {
  const db = getDb();

  const hasTable = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'")
    .get();
  const current = hasTable
    ? Number(db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM schema_version').get().v)
    : 0;

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .sort();

  for (const file of files) {
    const version = Number.parseInt(file.slice(0, 3), 10);
    if (version <= current) continue;

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    const snapshot = snapshotBefore(db, version);

    db.exec('BEGIN');
    try {
      db.exec(sql);
      db.exec('COMMIT');
      console.log(`[migrate] applied ${file}${snapshot ? ` (snapshot: ${path.basename(snapshot)})` : ''}`);
    } catch (err) {
      try { db.exec('ROLLBACK'); } catch { /* ignore */ }
      throw new Error(`迁移失败 ${file}: ${err.message}`);
    }
  }
}

/** 迁移前对数据库文件做一次快照备份 */
function snapshotBefore(_db, version) {
  try {
    const src = path.resolve(process.env.DB_PATH || './data/studylog.db');
    if (!fs.existsSync(src)) return null;
    const dst = `${src}.bak.${String(version).padStart(3, '0')}`;
    fs.copyFileSync(src, dst);
    return dst;
  } catch {
    return null;
  }
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCli) {
  loadEnv();
  try {
    runMigrations();
    console.log('[migrate] done.');
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

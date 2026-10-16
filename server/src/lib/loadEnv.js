import fs from 'node:fs';
import path from 'node:path';

/**
 * 极简 .env 加载器（零依赖）。
 * 生产环境由 systemd `EnvironmentFile` 注入；本地直接 `node server/src/server.js`
 * 时由本模块兜底读取项目根目录的 .env。
 * 已存在的进程环境变量优先（不覆盖）。
 */
export function loadEnv(file = '.env') {
  const p = path.resolve(process.cwd(), file);
  if (!fs.existsSync(p)) return false;
  const text = fs.readFileSync(p, 'utf8');
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
  return true;
}

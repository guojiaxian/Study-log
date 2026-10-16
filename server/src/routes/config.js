import { ok } from '../lib/errors.js';
import * as svc from '../services/configService.js';

export default async function configRoutes(app) {
  // 注意：不含 AI 字段（AI 仅走 .env）
  app.get('/config', async () => ok(svc.getConfig()));
  app.patch('/config', async (req) => ok(svc.patchConfig(req.body || {})));
}

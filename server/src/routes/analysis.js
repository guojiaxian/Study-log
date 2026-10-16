import { ok, Err } from '../lib/errors.js';
import * as svc from '../services/analysisService.js';

export default async function analysisRoutes(app) {
  app.post('/analysis/reports', async (req, reply) => {
    const body = req.body || {};
    if (!['exam', 'range'].includes(body.scopeType)) throw Err.validation('scopeType 只能为 exam 或 range');
    if (body.scopeType === 'exam' && !body.examId) throw Err.validation('scopeType=exam 时必须提供 examId');
    const result = await svc.createReport(body);
    reply.code(201);
    return ok(result);
  });

  app.get('/analysis/reports', async (req) => ok(svc.listReports(req.query || {})));

  app.get('/analysis/reports/:id', async (req) => ok(svc.getReport(Number(req.params.id))));

  app.delete('/analysis/reports/:id', async (req) => ok(svc.deleteReport(Number(req.params.id))));
}

import { ok, Err } from '../lib/errors.js';
import * as svc from '../services/statsService.js';

const typesOf = (q) => (q?.types ? String(q.types).split(',').map((s) => s.trim()).filter(Boolean) : []);
const codesOf = (q) => (q?.subjectCodes ? String(q.subjectCodes).split(',').map((s) => s.trim()).filter(Boolean) : []);

export default async function statsRoutes(app) {
  app.get('/stats/overview', async () => ok(svc.overview()));

  app.get('/stats/trend', async (req) => {
    const q = req.query || {};
    return ok(svc.trend({ from: q.from, to: q.to, types: typesOf(q), subjectCodes: codesOf(q) }));
  });

  app.get('/stats/rank-trend', async (req) => {
    const q = req.query || {};
    return ok(svc.rankTrend({ from: q.from, to: q.to, types: typesOf(q) }));
  });

  app.get('/stats/compare', async (req) => {
    const q = req.query || {};
    const examId = Number(q.examId);
    if (!examId) throw Err.validation('examId 为必填');
    return ok(svc.compare(examId, { window: q.window ? Number(q.window) : undefined }));
  });

  app.get('/stats/matrix', async (req) => {
    const q = req.query || {};
    return ok(svc.matrix({ from: q.from, to: q.to, types: typesOf(q), page: q.page, pageSize: q.pageSize }));
  });
}

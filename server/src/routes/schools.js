import { ok } from '../lib/errors.js';
import * as svc from '../services/schoolService.js';

export default async function schoolRoutes(app) {
  app.get('/schools', async () => ok({ list: svc.listSchools() }));

  // 注意：/schools/compare 必须在 /schools/:id 之前注册
  app.get('/schools/compare', async (req) => {
    const q = req.query || {};
    return ok(svc.compareSchools({
      examId: q.examId ? Number(q.examId) : undefined,
      lineMode: q.lineMode,
    }));
  });

  app.post('/schools', async (req, reply) => {
    const created = svc.createSchool(req.body || {});
    reply.code(201);
    return ok(created);
  });

  app.get('/schools/:id', async (req) => ok(svc.getSchool(Number(req.params.id))));

  app.patch('/schools/:id', async (req) => ok(svc.updateSchool(Number(req.params.id), req.body || {})));

  app.delete('/schools/:id', async (req) => ok(svc.deleteSchool(Number(req.params.id))));

  app.get('/schools/:id/scores', async (req) => ok({ list: svc.getSchool(Number(req.params.id)).admissionScores }));

  app.post('/schools/:id/scores', async (req, reply) => {
    const result = svc.createAdmissionScore(Number(req.params.id), req.body || {});
    reply.code(201);
    return ok(result);
  });

  app.patch('/schools/:id/scores/:scoreId', async (req) => ok(svc.updateAdmissionScore(Number(req.params.id), Number(req.params.scoreId), req.body || {})));

  app.delete('/schools/:id/scores/:scoreId', async (req) => ok(svc.deleteAdmissionScore(Number(req.params.id), Number(req.params.scoreId))));
}

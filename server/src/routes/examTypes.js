import { ok } from '../lib/errors.js';
import * as svc from '../services/examTypeService.js';

export default async function examTypeRoutes(app) {
  app.get('/exam-types', async (req) => {
    const includeInactive = req.query?.includeInactive === 'true';
    return ok({ list: svc.listExamTypes({ includeInactive }) });
  });

  app.post('/exam-types', async (req, reply) => {
    const id = svc.createExamType(req.body);
    reply.code(201);
    return ok({ id });
  });

  app.patch('/exam-types/:id', async (req) => ok({ id: svc.updateExamType(Number(req.params.id), req.body || {}) }));

  app.delete('/exam-types/:id', async (req) => ok({ id: svc.deleteExamType(Number(req.params.id)) }));
}

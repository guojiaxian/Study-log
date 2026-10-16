import { ok } from '../lib/errors.js';
import * as svc from '../services/subjectService.js';

export default async function subjectRoutes(app) {
  app.get('/subjects', async (req) => {
    const includeInactive = req.query?.includeInactive === 'true';
    return ok({ list: svc.listSubjects({ includeInactive }) });
  });

  app.post('/subjects', async (req, reply) => {
    const created = svc.createSubject(req.body);
    reply.code(201);
    return ok(created);
  });

  app.patch('/subjects/:id', async (req) => ok(svc.updateSubject(Number(req.params.id), req.body || {})));

  app.delete('/subjects/:id', async (req) => ok(svc.deleteSubject(Number(req.params.id))));
}

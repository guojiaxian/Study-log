import { ok } from '../lib/errors.js';
import * as svc from '../services/aiService.js';

export default async function aiRoutes(app) {
  app.get('/ai/status', async () => ok(svc.status()));

  app.post('/ai/parse-score', async (req) => ok(await svc.parseScore(req.body || {})));

  app.post('/ai/parse-score/commit', async (req, reply) => {
    const result = svc.commitParse(req.body || {});
    reply.code(201);
    return ok(result);
  });

  app.get('/ai/tasks/:id', async (req) => ok(svc.getParseTask(Number(req.params.id))));
}

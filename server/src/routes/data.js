import { ok } from '../lib/errors.js';
import * as svc from '../services/dataService.js';

export default async function dataRoutes(app) {
  app.get('/export', async (req, reply) => {
    const q = req.query || {};
    const { contentType, filename, body } = svc.exportData({ format: q.format, from: q.from, to: q.to, grade: q.grade });
    reply
      .header('Content-Type', contentType)
      .header('Content-Disposition', `attachment; filename="${filename}"`);
    return body;
  });

  app.post('/import', async (req) => {
    const payload = req.body?.backup ?? req.body;
    return ok(svc.importData(payload));
  });
}

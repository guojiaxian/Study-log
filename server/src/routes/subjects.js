import { ok, Err } from '../lib/errors.js';
import * as svc from '../services/subjectService.js';

const gradeOf = (q) => (q?.grade != null && q.grade !== '' && q.grade !== 'all' ? Number(q.grade) : undefined);

export default async function subjectRoutes(app) {
  /** 学段列表（含各学段总分满分），供前端下拉 */
  app.get('/grades', async () => ok({ list: svc.listGrades() }));

  app.get('/subjects', async (req) => {
    const includeInactive = req.query?.includeInactive === 'true';
    const grade = gradeOf(req.query);
    return ok({ list: svc.listSubjects({ grade, includeInactive }), grades: svc.listGrades() });
  });

  app.post('/subjects', async (req, reply) => {
    const created = svc.createSubject(req.body);
    reply.code(201);
    return ok(created);
  });

  app.patch('/subjects/:id', async (req) => ok(svc.updateSubject(Number(req.params.id), req.body || {})));

  app.delete('/subjects/:id', async (req) => {
    const grade = gradeOf(req.query);
    if (grade == null) throw Err.validation('grade 为必填（8 或 9）');
    return ok(svc.deleteSubject(Number(req.params.id), grade));
  });
}

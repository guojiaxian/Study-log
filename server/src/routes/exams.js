import { ok } from '../lib/errors.js';
import * as svc from '../services/examService.js';

export default async function examRoutes(app) {
  app.get('/exams', async (req) => ok(svc.listExams(req.query || {})));

  app.get('/exams/:id', async (req) => ok(svc.getExam(Number(req.params.id))));

  app.post('/exams', async (req, reply) => {
    const result = svc.createExam(req.body || {});
    reply.code(201);
    return ok(result);
  });

  app.patch('/exams/:id', async (req) => ok(svc.updateExam(Number(req.params.id), req.body || {})));

  app.delete('/exams/:id', async (req) => ok(svc.deleteExam(Number(req.params.id))));

  // 成绩
  app.put('/exams/:examId/scores', async (req) => {
    const scores = Array.isArray(req.body) ? req.body : req.body?.scores;
    return ok(svc.replaceScores(Number(req.params.examId), scores || []));
  });

  app.patch('/exams/:examId/scores/:subjectId', async (req) => ok(svc.patchScore(Number(req.params.examId), Number(req.params.subjectId), req.body || {})));

  app.delete('/exams/:examId/scores/:subjectId', async (req) => ok(svc.deleteScore(Number(req.params.examId), Number(req.params.subjectId))));
}

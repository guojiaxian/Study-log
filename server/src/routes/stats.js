import { ok, Err } from '../lib/errors.js';
import * as svc from '../services/statsService.js';

const typesOf = (q) => (q?.types ? String(q.types).split(',').map((s) => s.trim()).filter(Boolean) : []);
const codesOf = (q) => (q?.subjectCodes ? String(q.subjectCodes).split(',').map((s) => s.trim()).filter(Boolean) : []);
/** 学段：8 / 9 / comparable（跨学段可比）；缺省表示跟随最近一次考试 */
const gradeOf = (q) => (q?.grade != null && q.grade !== '' ? q.grade : undefined);

export default async function statsRoutes(app) {
  app.get('/stats/overview', async (req) => ok(svc.overview({ grade: gradeOf(req.query) })));

  app.get('/stats/trend', async (req) => {
    const q = req.query || {};
    return ok(svc.trend({
      from: q.from, to: q.to, types: typesOf(q),
      grade: gradeOf(q), subjectCodes: codesOf(q),
    }));
  });

  app.get('/stats/rank-trend', async (req) => {
    const q = req.query || {};
    return ok(svc.rankTrend({ from: q.from, to: q.to, types: typesOf(q), grade: gradeOf(q) }));
  });

  app.get('/stats/compare', async (req) => {
    const q = req.query || {};
    const examId = Number(q.examId);
    if (!examId) throw Err.validation('examId 为必填');
    return ok(svc.compare(examId, { window: q.window ? Number(q.window) : undefined }));
  });

  app.get('/stats/matrix', async (req) => {
    const q = req.query || {};
    return ok(svc.matrix({
      from: q.from, to: q.to, types: typesOf(q),
      grade: gradeOf(q), page: q.page, pageSize: q.pageSize,
    }));
  });

  /** 单科趋势可选科目（按学段或跨学段可比） */
  app.get('/stats/selectable-subjects', async (req) => {
    const q = req.query || {};
    const grade = q.grade === 'comparable' ? 'comparable' : (gradeOf(q) ?? svc.resolveGrade(undefined));
    return ok({ grade, subjects: svc.selectableSubjects(grade) });
  });
}

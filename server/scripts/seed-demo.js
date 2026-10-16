/**
 * 演示数据种子脚本：10 次常规考试 + 体育/实验操作各 1 条。
 * 用法（项目根目录）：node --disable-warning=ExperimentalWarning server/scripts/seed-demo.js
 * 仅清空考试相关数据，保留科目/考试类型/目标院校等基础字典。
 */
import { loadEnv } from '../src/lib/loadEnv.js';
import { runMigrations } from '../src/db/migrate.js';
import { getDb, transaction, closeDb } from '../src/db/index.js';

loadEnv();
runMigrations();

// 科目 id：1语文 2数学 3英语 4物理 5化学 6道法 7历史 8体育 9实验操作
const S = (subjectId, score, extra = {}) => ({ subjectId, score, isAbsent: false, ...extra });

const CULTURE = (lang, math, eng, phy, chem, pol, his) => [
  S(1, lang), S(2, math), S(3, eng), S(4, phy), S(5, chem), S(6, pol), S(7, his),
];

const exams = [
  { name: '周测一', examType: 'week', examDate: '2026-09-07', classRank: 18, classSize: 50, gradeRank: 140, gradeSize: 800, scores: CULTURE(101, 91, 102, 54, 30, 48, 38) },
  { name: '周测二', examType: 'week', examDate: '2026-09-14', classRank: 15, classSize: 50, gradeRank: 120, gradeSize: 800, scores: CULTURE(104, 92, 100, 56, 33, 52, 40) },
  { name: '周测三', examType: 'week', examDate: '2026-09-28', classRank: 11, classSize: 50, gradeRank: 88, gradeSize: 800, scores: CULTURE(102, 95, 99, 55, 35, 57, 41) },
  { name: '初三上第一次月考', examType: 'month', examDate: '2026-10-12', classRank: 8, classSize: 50, gradeRank: 63, gradeSize: 800, scores: CULTURE(98, 104, 96, 58, 38, 62, 43).map((s) => (s.subjectId === 2 ? { ...s, classRank: 3 } : s)) },
  { name: '周测四', examType: 'week', examDate: '2026-10-26', classRank: 7, classSize: 50, gradeRank: 58, gradeSize: 800, scores: CULTURE(103, 101, 98, 59, 39, 60, 44) },
  { name: '周测五', examType: 'week', examDate: '2026-11-09', classRank: 6, classSize: 50, gradeRank: 52, gradeSize: 800, scores: CULTURE(105, 99, 101, 57, 41, 58, 45) },
  { name: '初三上期中考试', examType: 'midterm', examDate: '2026-11-23', classRank: 5, classSize: 50, gradeRank: 45, gradeSize: 800, scores: CULTURE(100, 106, 101, 61, 42, 64, 46) },
  { name: '初三上第二次月考', examType: 'month', examDate: '2026-12-07', classRank: 7, classSize: 50, gradeRank: 55, gradeSize: 800, scores: CULTURE(102, 103, 100, 60, 43, 61, 47) },
  { name: '周测六', examType: 'week', examDate: '2026-12-21', classRank: 4, classSize: 50, gradeRank: 36, gradeSize: 800, scores: CULTURE(106, 107, 98, 62, 44, 63, 45) },
  { name: '初三上期末考试', examType: 'final', examDate: '2027-01-11', classRank: 3, classSize: 50, gradeRank: 28, gradeSize: 800, scores: CULTURE(108, 109, 96, 64, 46, 66, 48).map((s) => (s.subjectId === 2 ? { ...s, classRank: 1 } : s)) },
  // 单项测试：仅用于"中考口径总分 / 730"与目标院校对比
  { name: '体育测试', examType: 'sport', examDate: '2026-10-08', scores: [S(8, 92)] },
  { name: '实验操作测试', examType: 'lab', examDate: '2026-10-09', scores: [S(9, 27)] },
];

const db = getDb();
transaction((tx) => {
  tx.exec('DELETE FROM exam_score; DELETE FROM exam;');
  const insExam = tx.prepare(`INSERT INTO exam
    (name, exam_type, exam_date, grade, term, status, source, remark, class_rank, class_size, grade_rank, grade_size)
    VALUES (?, ?, ?, 9, ?, 'confirmed', 'manual', NULL, ?, ?, ?, ?)`);
  const insScore = tx.prepare(`INSERT INTO exam_score
    (exam_id, subject_id, score, grade_level, is_absent, class_rank, grade_rank, remark)
    VALUES (?, ?, ?, NULL, 0, ?, ?, NULL)`);

  let scoreCount = 0;
  for (const e of exams) {
    const info = insExam.run(
      e.name, e.examType, e.examDate,
      e.examDate < '2027-01-01' ? '2026-2027-1' : '2026-2027-2',
      e.classRank ?? null, e.classSize ?? null, e.gradeRank ?? null, e.gradeSize ?? null,
    );
    const examId = Number(info.lastInsertRowid);
    for (const s of e.scores) {
      insScore.run(examId, s.subjectId, s.score, s.classRank ?? null, s.gradeRank ?? null);
      scoreCount += 1;
    }
  }
  return { exams: exams.length, scoreCount };
});

const total = db.prepare('SELECT COUNT(*) AS c FROM exam').get().c;
const scoresCnt = db.prepare('SELECT COUNT(*) AS c FROM exam_score').get().c;
const culture = db.prepare(`SELECT COUNT(*) AS c FROM exam WHERE exam_type NOT IN ('sport','lab')`).get().c;
console.log(`[seed-demo] exams=${total} (常规考试 ${culture}) scores=${scoresCnt}`);
closeDb();

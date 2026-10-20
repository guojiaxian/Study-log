/**
 * 灌入学生真实成绩（3 次考试：初二 2 次 + 初三 1 次）。
 *
 * 数据来源：家长收到的学校成绩通知（2026-10-20 手工誊录）。
 *   - 初二下学期期中（2026-04）：语114 数120 英120 物70 政69 历61 → 总分 554 / 满分 570
 *   - 初二下学期期末（2026-06）：语116 数120 英117 物70 政67 历56 → 总分 546 / 满分 570
 *   - 初三上学期月考（2026-10）：语111 数120 英119 物70 化50 政69 历34 → 总分 573 / 满分 600
 *
 * 注意：
 *   1) 通知里未提供班级/年级排名，故 rank 字段留空，需在「管理 → 手动录入」中补充；
 *   2) 初三 10 月月考尚未考体育（100）与理化生实验（30），故本卷满分 600，
 *      而学段（中考）口径满分仍为 730——两者分离记录，见迁移 004；
 *   3) 本脚本会清空既有考试与成绩（含分析报告），但保留科目字典、考试类型、目标院校。
 *
 * 用法：node server/scripts/load-real-scores.js
 */

import { loadEnv } from '../src/lib/loadEnv.js';
import { openDb, closeDb, getDb } from '../src/db/index.js';

loadEnv();
openDb();

const db = getDb();

/** 按 code 取科目 id（字典由迁移 001/004 建立，此处只读） */
function subjectIds() {
  const rows = db.prepare('SELECT id, code FROM subject').all();
  const m = new Map();
  for (const r of rows) m.set(r.code, r.id);
  return m;
}

const SID = subjectIds();

const EXAMS = [
  {
    name: '初二下学期期中考试',
    examType: 'midterm',
    examDate: '2026-04-15',
    grade: 8,
    scores: {
      chinese: 114, math: 120, english: 120,
      physics: 70, politics: 69, history: 61,
    },
  },
  {
    name: '初二下学期期末考试',
    examType: 'final',
    examDate: '2026-06-15',
    grade: 8,
    scores: {
      chinese: 116, math: 120, english: 117,
      physics: 70, politics: 67, history: 56,
    },
  },
  {
    name: '初三上学期第一次月考',
    examType: 'month',
    examDate: '2026-10-15',
    grade: 9,
    scores: {
      chinese: 111, math: 120, english: 119,
      physics: 70, chemistry: 50,
      politics: 69, history: 34,
    },
  },
];

function main() {
  // 1) 清空成绩类数据（保留字典与目标院校）
  db.exec(`
    DELETE FROM exam_score;
    DELETE FROM exam;
    DELETE FROM analysis_report;
    DELETE FROM ai_parse_task;
  `);

  // 2) 逐场写入
  const insExam = db.prepare(`INSERT INTO exam
    (name, exam_type, exam_date, grade, term, status, source, class_rank, class_size, grade_rank, grade_size, remark)
    VALUES (?, ?, ?, ?, ?, 'confirmed', 'manual', NULL, NULL, NULL, NULL, ?)`);
  const insScore = db.prepare(`INSERT INTO exam_score
    (exam_id, subject_id, score, grade_level, is_absent, class_rank, grade_rank, remark)
    VALUES (?, ?, ?, NULL, 0, NULL, NULL, NULL)`);

  const summary = [];
  for (const e of EXAMS) {
    const info = insExam.run(
      e.name, e.examType, e.examDate, e.grade,
      e.examDate <= '2026-06-30' ? '下学期' : '上学期',
      '由家长收到的成绩通知誊录',
    );
    const examId = Number(info.lastInsertRowid);

    let total = 0;
    for (const [code, score] of Object.entries(e.scores)) {
      const subjectId = SID.get(code);
      if (!subjectId) throw new Error(`科目 code 不存在：${code}`);
      insScore.run(examId, subjectId, score);
      total += score;
    }

    // 与通知上的总分核对（通知的 总分 是计入总分科目之和）
    const expect = { '初二下学期期中考试': 554, '初二下学期期末考试': 546, '初三上学期第一次月考': 573 }[e.name];
    if (expect != null && total !== expect) {
      throw new Error(`${e.name} 总分核对失败：录入合计 ${total}，通知为 ${expect}`);
    }
    summary.push({ examId, name: e.name, grade: e.grade, total, subjects: Object.keys(e.scores).length });
  }

  // 3) 打印结果（含各学段口径满分，便于人工核对）
  const fulls = db
    .prepare('SELECT grade, SUM(full_score) AS v FROM subject_grade WHERE counts_to_total = 1 AND is_active = 1 GROUP BY grade')
    .all();
  const fullByGrade = new Map(fulls.map((r) => [r.grade, r.v]));

  console.log('已写入真实成绩：');
  for (const s of summary) {
    console.log(`  [${s.grade === 8 ? '初二' : '初三'}] ${s.name}（${s.examId}）  ${s.subjects} 科  总分 ${s.total}  ·  ${s.grade === 8 ? '初二' : '初三'}口径满分 ${fullByGrade.get(s.grade)}`);
  }
  console.log('\n提示：通知未提供班级/年级排名，请在「管理 → 手动录入」中补充，排名趋势与「较上次」对比才会显示。');
}

try {
  main();
} finally {
  closeDb();
}

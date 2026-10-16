import { getDb } from '../db/index.js';
import { listSubjectsRaw, asBool } from './subjectService.js';
import { findExamsForStats, getExam, TOTAL_FULL_SCORE } from './examService.js';
import { getStatParams } from './configService.js';
import { mean, stddev, declineRun, totalOfScores, rankDelta, round2 } from '../lib/metrics.js';
import { compareSchools } from './schoolService.js';

/** 科目元数据 */
function subjectMeta() {
  const list = listSubjectsRaw();
  return { list, byId: new Map(list.map((s) => [s.id, s])) };
}

/** examId -> Map(subjectId -> scoreRow) */
function loadScores(examIds) {
  const m = new Map();
  if (!examIds.length) return m;
  const ph = examIds.map(() => '?').join(',');
  const rows = getDb()
    .prepare(`SELECT exam_id AS examId, subject_id AS subjectId, score,
              grade_level AS gradeLevel, is_absent AS isAbsent,
              class_rank AS classRank, grade_rank AS gradeRank
              FROM exam_score WHERE exam_id IN (${ph})`)
    .all(...examIds);
  for (const r of rows) {
    if (!m.has(r.examId)) m.set(r.examId, new Map());
    m.get(r.examId).set(r.subjectId, { ...r, isAbsent: asBool(r.isAbsent) });
  }
  return m;
}

function totalOfExam(scoreMap, byId) {
  const arr = [...scoreMap.entries()].map(([subjectId, r]) => ({ subjectId, score: r.score, isAbsent: r.isAbsent }));
  return totalOfScores(arr, byId);
}

/** 取某科目在若干次考试中的得分序列（按考试升序） */
function seriesOf(exams, scores, subjectId) {
  return exams.map((e) => {
    const r = scores.get(e.examId)?.get(subjectId);
    if (!r || r.isAbsent || r.score == null) return null;
    return r.score;
  });
}

/* ------------------------------------------------------------------ */
/* 趋势                                                               */
/* ------------------------------------------------------------------ */

export function trend(q = {}) {
  const exams = findExamsForStats({ from: q.from, to: q.to, types: q.types, includeDraft: false });
  const { list, byId } = subjectMeta();
  const scores = loadScores(exams.map((e) => e.examId));

  const selected = q.subjectCodes?.length
    ? q.subjectCodes.map((c) => list.find((s) => s.code === c)).filter(Boolean)
    : [];

  const points = exams.map((e) => {
    const sm = scores.get(e.examId) ?? new Map();
    const t = totalOfExam(sm, byId);
    const values = { total: t.entered > 0 ? t.total : null };
    for (const s of selected) {
      const r = sm.get(s.id);
      values[s.code] = !r || r.isAbsent || r.score == null ? null : r.score;
    }
    return { examId: e.examId, examDate: e.examDate, examName: e.name, values };
  });

  // 该口径满分 = 实际出现在所展示考试中、计入总分科目的满分之和（如仅 7 门文化课 = 600）
  const presentIds = new Set();
  for (const sm of scores.values()) {
    for (const [subjectId, r] of sm) {
      const sub = byId.get(subjectId);
      if (sub && sub.countsToTotal && !r.isAbsent && r.score != null) presentIds.add(subjectId);
    }
  }
  const totalFullScore = [...presentIds].reduce((a, id) => a + (byId.get(id)?.fullScore ?? 0), 0);
  const series = [
    { key: 'total', name: '总分', unit: 'score', fullScore: totalFullScore },
    ...selected.map((s) => ({ key: s.code, name: s.name, unit: 'score', fullScore: s.fullScore })),
  ];

  return {
    points,
    series,
    notes: [
      'values 中某科为 null 表示该次考试该科缺考或未录入，前端须渲染为断点，不得按 0 处理',
      'total 为本次已录入且计入总分科目得分之和，跨考试比较请对齐覆盖科目',
    ],
  };
}

/* ------------------------------------------------------------------ */
/* 排名趋势（名次越小越好，Y 轴需反向渲染）                            */
/* ------------------------------------------------------------------ */

export function rankTrend(q = {}) {
  const exams = findExamsForStats({ from: q.from, to: q.to, types: q.types, includeDraft: false });
  const points = exams.map((e) => ({
    examId: e.examId,
    examDate: e.examDate,
    examName: e.name,
    classRank: e.classRank ?? null,
    classSize: e.classSize ?? null,
    gradeRank: e.gradeRank ?? null,
    gradeSize: e.gradeSize ?? null,
  }));
  return {
    points,
    series: [
      { key: 'classRank', name: '班级排名', reverseAxis: true, sizeKey: 'classSize' },
      { key: 'gradeRank', name: '年级排名', reverseAxis: true, sizeKey: 'gradeSize' },
    ],
    notes: ['reverseAxis=true 表示名次越小越好，前端必须将 Y 轴反向渲染'],
  };
}

/* ------------------------------------------------------------------ */
/* 单次对比（进退 + 均值 + 连续下滑）                                  */
/* ------------------------------------------------------------------ */

export function compare(examId, opts = {}) {
  const params = getStatParams();
  const window = Number(opts.window ?? params.avgWindow ?? 8);
  const exam = getExam(examId);

  const scoredSubjects = exam.scores.filter((s) => s.countsToTotal && s.scoreMode === 'score');

  // 与趋势一致的考试口径：默认排除单项测试（sport/lab），避免"上次"取到只考 1 科的测试
  let scope = findExamsForStats({});
  let idx = scope.findIndex((e) => e.examId === examId);
  if (idx === -1) {
    scope = findExamsForStats({ types: [exam.examType] });
    idx = scope.findIndex((e) => e.examId === examId);
  }

  const prevRow = idx > 0 ? scope[idx - 1] : null;
  let prev = null;
  let prevMap = new Map();
  if (prevRow) {
    prev = getExam(prevRow.examId);
    prevMap = new Map(prev.scores.map((s) => [s.subjectId, s]));
  }

  const vsPrevious = {
    previousExamId: prev?.examId ?? null,
    previousExamDate: prev?.examDate ?? null,
    totalDelta: prev ? round2(exam.totalScore - prev.totalScore) : null,
    rankDelta: {
      classRankDelta: prev ? rankDelta(prev.classRank, exam.classRank) : null,
      gradeRankDelta: prev ? rankDelta(prev.gradeRank, exam.gradeRank) : null,
    },
    subjects: scoredSubjects.map((s) => {
      const p = prevMap.get(s.subjectId);
      const prevScore = p && !p.isAbsent ? p.score : null;
      const delta = prevScore == null || s.score == null ? null : round2(s.score - prevScore);
      return {
        subjectId: s.subjectId,
        subjectName: s.subjectName,
        score: s.score,
        prevScore,
        scoreDelta: delta,
        trend: delta == null ? 'flat' : delta > 0.5 ? 'up' : delta < -0.5 ? 'down' : 'flat',
      };
    }),
  };

  // 均值窗口：最近 window 次（含本次）
  const recentExams = scope.slice(Math.max(0, idx - window + 1), idx + 1);
  const windowScores = loadScores(recentExams.map((e) => e.examId));

  const vsAverage = {
    window,
    sampleCount: recentExams.length,
    subjects: scoredSubjects.map((s) => {
      const series = seriesOf(recentExams, windowScores, s.subjectId);
      const avg = mean(series);
      const delta = avg == null || s.score == null ? null : round2(s.score - avg);
      return {
        subjectId: s.subjectId,
        subjectName: s.subjectName,
        score: s.score,
        avgScore: avg,
        scoreDelta: delta,
        verdict: delta == null ? 'flat' : delta > 0.5 ? 'above' : delta < -0.5 ? 'below' : 'flat',
      };
    }),
  };

  // 连续下滑：以本次为终点的完整序列
  const historyExams = scope.slice(0, idx + 1);
  const historyScores = loadScores(historyExams.map((e) => e.examId));
  const declining = [];
  for (const s of scoredSubjects) {
    const series = seriesOf(historyExams, historyScores, s.subjectId).filter((v) => v != null);
    const n = declineRun(series);
    if (n >= (params.declineThreshold ?? 3)) {
      declining.push({ subjectId: s.subjectId, subjectName: s.subjectName, consecutive: n, values: series });
    }
  }

  return {
    exam: {
      examId: exam.examId, name: exam.name, examDate: exam.examDate,
      totalScore: exam.totalScore, totalFullScore: TOTAL_FULL_SCORE,
      enteredFullScore: exam.enteredFullScore,
      classRank: exam.classRank, classSize: exam.classSize,
      gradeRank: exam.gradeRank, gradeSize: exam.gradeSize,
    },
    vsPrevious,
    vsAverage,
    declining,
  };
}

/* ------------------------------------------------------------------ */
/* 全量矩阵                                                           */
/* ------------------------------------------------------------------ */

export function matrix(q = {}) {
  const exams = findExamsForStats({ from: q.from, to: q.to, types: q.types, includeDraft: false });
  const { list } = subjectMeta();
  const activeIds = new Set(list.filter((s) => s.isActive).map((s) => s.id));
  const scores = loadScores(exams.map((e) => e.examId));
  const usedIds = new Set();
  for (const sm of scores.values()) for (const id of sm.keys()) usedIds.add(id);
  const columns = list
    .filter((s) => activeIds.has(s.id) || usedIds.has(s.id))
    .map((s) => ({ subjectId: s.id, code: s.code, name: s.name, scoreMode: s.scoreMode, fullScore: s.fullScore }));

  const ordered = [...exams].reverse();
  const page = Math.max(1, Number(q.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(q.pageSize) || 20));
  const slice = ordered.slice((page - 1) * pageSize, page * pageSize);

  const rows = slice.map((e) => {
    const sm = scores.get(e.examId) ?? new Map();
    return {
      examId: e.examId, examDate: e.examDate, name: e.name, examType: e.examType,
      totalScore: e.totalScore,
      classRank: e.classRank, classSize: e.classSize,
      gradeRank: e.gradeRank, gradeSize: e.gradeSize,
      cells: columns.map((c) => {
        const r = sm.get(c.subjectId);
        if (!r) return { subjectId: c.subjectId, score: null, gradeLevel: null, classRank: null, isAbsent: false, entered: false };
        return {
          subjectId: c.subjectId, score: r.score, gradeLevel: r.gradeLevel,
          classRank: r.classRank, isAbsent: r.isAbsent, entered: true,
        };
      }),
    };
  });

  return { columns, rows, total: ordered.length, page, pageSize };
}

/* ------------------------------------------------------------------ */
/* 首页仪表盘                                                         */
/* ------------------------------------------------------------------ */

export function overview() {
  const db = getDb();
  const latestRow = db
    .prepare(`SELECT id FROM exam WHERE status='confirmed' ORDER BY exam_date DESC, id DESC LIMIT 1`)
    .get();

  if (!latestRow) {
    return { latestExam: null, subjectOverview: [], totalTrend: [], rankTrend: [], targetGap: null, latestReport: null };
  }

  const exam = getExam(latestRow.id);
  const cmp = compare(latestRow.id);
  const params = getStatParams();

  const subjectOverview = exam.scores
    .filter((s) => s.scoreMode === 'score')
    .map((s) => {
      const prev = cmp.vsPrevious.subjects.find((x) => x.subjectId === s.subjectId);
      const avg = cmp.vsAverage.subjects.find((x) => x.subjectId === s.subjectId);
      return {
        subjectId: s.subjectId, subjectName: s.subjectName, fullScore: s.fullScore,
        latest: s.score, isAbsent: s.isAbsent,
        deltaVsPrev: prev?.scoreDelta ?? null,
        avgScore: avg?.avgScore ?? null,
        deltaVsAvg: avg?.scoreDelta ?? null,
        classRank: s.classRank ?? null,
      };
    });

  const trendData = trend({ subjectCodes: [] });
  const target = safeCompareSchools({ lineMode: 'avg3y' });

  let latestReport = null;
  const rep = db
    .prepare('SELECT id, created_at AS createdAt, model, is_fallback AS isFallback FROM analysis_report ORDER BY created_at DESC, id DESC LIMIT 1')
    .get();
  if (rep) latestReport = { reportId: rep.id, createdAt: rep.createdAt, model: rep.model, isFallback: asBool(rep.isFallback) };

  return {
    latestExam: {
      examId: exam.examId, name: exam.name, examDate: exam.examDate, examType: exam.examType,
      totalScore: exam.totalScore, totalFullScore: TOTAL_FULL_SCORE,
      enteredFullScore: exam.enteredFullScore,
      deltaVsPrev: cmp.vsPrevious.totalDelta,
      classRank: exam.classRank, classSize: exam.classSize,
      gradeRank: exam.gradeRank, gradeSize: exam.gradeSize,
    },
    subjectOverview,
    totalTrend: trendData.points.slice(-8),
    totalFullScoreCulture: trendData.series[0]?.fullScore ?? 600,
    rankTrend: rankTrend({}).points.slice(-8),
    targetGap: target,
    declineThreshold: params.declineThreshold,
    latestReport,
  };
}

function safeCompareSchools(opts) {
  try { return compareSchools(opts); } catch { return null; }
}

/* ------------------------------------------------------------------ */
/* AI 分析输入摘要                                                    */
/* ------------------------------------------------------------------ */

export function buildSummary(scope = {}) {
  const params = getStatParams();
  const scopeType = scope.scopeType ?? 'range';
  const { from, to } = scope.scopeRef ?? {};
  const exams = findExamsForStats({ from, to, includeDraft: false });
  const { list, byId } = subjectMeta();
  const scores = loadScores(exams.map((e) => e.examId));

  const scoreSubjects = list.filter((s) => s.countsToTotal && s.scoreMode === 'score');

  const subjects = scoreSubjects.map((s) => {
    const series = seriesOf(exams, scores, s.id);
    const filled = series.filter((v) => v != null);
    const latest = filled.length ? filled[filled.length - 1] : null;
    const prev = filled.length > 1 ? filled[filled.length - 2] : null;
    const avg = mean(filled);
    return {
      subjectId: s.id, code: s.code, name: s.name, fullScore: s.fullScore,
      values: series,
      latest,
      prevScore: prev,
      deltaVsPrev: latest != null && prev != null ? round2(latest - prev) : null,
      avgScore: avg,
      deltaVsAvg: latest != null && avg != null ? round2(latest - avg) : null,
      stddev: stddev(filled),
      decline: declineRun(filled),
    };
  });

  const totalSeries = exams.map((e) => {
    const t = totalOfExam(scores.get(e.examId) ?? new Map(), byId);
    return t.entered > 0 ? t.total : null;
  });

  const rankPairs = exams
    .filter((e) => e.classRank != null || e.gradeRank != null)
    .map((e) => ({ classRank: e.classRank, gradeRank: e.gradeRank }));
  const rankTrendObj = {
    classStart: rankPairs.find((r) => r.classRank != null)?.classRank ?? null,
    classEnd: [...rankPairs].reverse().find((r) => r.classRank != null)?.classRank ?? null,
    gradeStart: rankPairs.find((r) => r.gradeRank != null)?.gradeRank ?? null,
    gradeEnd: [...rankPairs].reverse().find((r) => r.gradeRank != null)?.gradeRank ?? null,
  };
  rankTrendObj.classDelta = rankDelta(rankTrendObj.classStart, rankTrendObj.classEnd);
  rankTrendObj.gradeDelta = rankDelta(rankTrendObj.gradeStart, rankTrendObj.gradeEnd);

  return {
    scopeType,
    range: { from: from ?? null, to: to ?? null },
    examCount: exams.length,
    declineThreshold: params.declineThreshold,
    exams: exams.map((e) => ({
      examId: e.examId, name: e.name, examDate: e.examDate, examType: e.examType,
      total: e.totalScore, classRank: e.classRank, classSize: e.classSize,
      gradeRank: e.gradeRank, gradeSize: e.gradeSize,
    })),
    totalSeries,
    subjects,
    rankTrend: rankTrendObj,
    target: safeCompareSchools({ lineMode: 'avg3y' }),
  };
}

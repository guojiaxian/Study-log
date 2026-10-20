import { getDb } from '../db/index.js';
import { listSubjectsRaw, asBool, gradeFullScore, GRADE_LABEL, GRADES } from './subjectService.js';
import { findExamsForStats, getExam } from './examService.js';
import { getStatParams } from './configService.js';
import { mean, stddev, declineRun, totalOfScores, rankDelta, round2 } from '../lib/metrics.js';
import { compareSchools } from './schoolService.js';

/**
 * 学段口径（见迁移 004）：
 *   8          初二，总分满分 570
 *   9          初三，总分满分 730（中考口径）
 *   'comparable' 跨学段可比 —— 仅保留两学段满分相同的科目（语数英物理道法），总分不参与
 *   'all'      全部学段 —— 两学段的考试画在同一张图中（满分口径不同，仅供总览参考）
 *   undefined  跟随最近一次已确认考试所属学段
 */
export function resolveGrade(raw) {
  if (raw === 'comparable' || raw === 'all') return raw;
  const n = Number(raw);
  if (n === 8 || n === 9) return n;
  const row = getDb().prepare("SELECT grade FROM exam WHERE status='confirmed' ORDER BY exam_date DESC, id DESC LIMIT 1").get();
  return Number(row?.grade ?? 9);
}

function normalizeGrade(raw) {
  const n = Number(raw);
  return n === 8 || n === 9 ? n : null;
}

/** 学段 -> (subjectId -> 科目行)：算总分时用对应学段的计分科目 */
function subjectIndexByGrade() {
  const m = new Map();
  for (const g of GRADES) m.set(g, new Map(listSubjectsRaw({ grade: g }).map((s) => [s.id, s])));
  return m;
}

/** 可选科目（单科趋势的 chips）：等级制科目不计入可选（无分数不可绘图） */
export function selectableSubjects(scope) {
  const scoreOnly = (s) => s.scoreMode === 'score';
  if (scope === 'comparable') {
    const byCode = new Map();
    for (const s of listSubjectsRaw({})) {
      if (!byCode.has(s.code)) byCode.set(s.code, []);
      byCode.get(s.code).push(s);
    }
    return [...byCode.values()]
      .filter((rows) => rows.length === GRADES.length && rows.every((r) => r.isActive)
        && rows.every((r) => r.fullScore === rows[0].fullScore) && scoreOnly(rows[0]))
      .map((rows) => ({ code: rows[0].code, name: rows[0].name, fullScore: rows[0].fullScore, grades: [...GRADES], scoreMode: rows[0].scoreMode }));
  }
  if (scope === 'all') {
    // 全部学段：两学段可选科目按 code 去重合并；满分不一致的科目 fullScore 置 null（参考线不可用）
    const byCode = new Map();
    for (const g of GRADES) {
      for (const s of listSubjectsRaw({ grade: g })) {
        if (!s.isActive || !scoreOnly(s)) continue;
        const prev = byCode.get(s.code);
        if (!prev) byCode.set(s.code, { code: s.code, name: s.name, fullScore: s.fullScore, grades: [g], scoreMode: s.scoreMode });
        else {
          if (!prev.grades.includes(g)) prev.grades.push(g);
          if (prev.fullScore !== s.fullScore) prev.fullScore = null;
        }
      }
    }
    return [...byCode.values()];
  }
  const g = normalizeGrade(scope) ?? resolveGrade(scope);
  return listSubjectsRaw({ grade: g })
    .filter((s) => s.isActive && scoreOnly(s))
    .map((s) => ({ code: s.code, name: s.name, fullScore: s.fullScore, grades: [s.grade], scoreMode: s.scoreMode }));
}

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
  const scope = q.grade == null
    ? resolveGrade(undefined)
    : (q.grade === 'comparable' || q.grade === 'all' ? q.grade : resolveGrade(q.grade));
  const single = normalizeGrade(scope);
  const exams = findExamsForStats({
    from: q.from, to: q.to, types: q.types,
    grade: single,          // 'comparable' / 'all' 时两学段都取
    includeDraft: false,
  });
  const idxByGrade = subjectIndexByGrade();
  const scores = loadScores(exams.map((e) => e.examId));

  // 可选科目池 + 每科在各学段的行（用于决定某次考试是否有该科）
  const rowsByCode = new Map();
  for (const s of listSubjectsRaw({})) {
    if (!rowsByCode.has(s.code)) rowsByCode.set(s.code, new Map());
    rowsByCode.get(s.code).set(s.grade, s);
  }

  const selected = q.subjectCodes?.length
    ? q.subjectCodes.map((c) => selectableSubjects(scope).find((s) => s.code === c)).filter(Boolean)
    : [];

  const points = exams.map((e) => {
    const sm = scores.get(e.examId) ?? new Map();
    const t = totalOfExam(sm, idxByGrade.get(e.grade) ?? new Map());
    const values = { total: t.entered > 0 ? t.total : null };
    for (const s of selected) {
      const row = rowsByCode.get(s.code)?.get(e.grade);
      if (!row) { values[s.code] = null; continue; }
      const r = sm.get(row.id);
      values[s.code] = !r || r.isAbsent || r.score == null ? null : r.score;
    }
    return {
      examId: e.examId, examDate: e.examDate, examName: e.name,
      grade: e.grade, gradeLabel: GRADE_LABEL[e.grade] ?? null,
      enteredFullScore: e.enteredFullScore ?? null,
      values,
    };
  });

  const series = [];
  if (single != null || scope === 'all') {
    // 参考线取「所展示考试实际卷面计入满分」的最大值：
    // 初三 10 月月考尚未考体育(100)/实验(30)，卷面满分 600 而非中考口径 730，
    // 若直接画 730 参考线会造成"缺 157 分"的误读，故按实际卷面满分为准。
    // 'all' 模式两学段满分口径不同，gradeFullScore 返回 null（无单一口径）。
    const entered = exams.map((e) => Number(e.enteredFullScore ?? 0)).filter((v) => v > 0);
    series.push({
      key: 'total',
      name: '总分',
      unit: 'score',
      fullScore: entered.length ? Math.max(...entered) : (single != null ? gradeFullScore(single) : 0),
      gradeFullScore: single != null ? gradeFullScore(single) : null,
    });
  }
  for (const s of selected) {
    series.push({ key: s.code, name: s.name, unit: 'score', fullScore: s.fullScore, grades: s.grades });
  }

  return {
    grade: scope,
    gradeLabel: scope === 'comparable' ? '跨学段可比' : scope === 'all' ? '全部' : (GRADE_LABEL[single] ?? null),
    points,
    series,
    subjects: selectableSubjects(scope),
    notes: scope === 'comparable'
      ? ['跨学段可比模式仅提供两学段满分相同的科目；总分口径不同，故不提供总分折线']
      : scope === 'all'
        ? [
          '全部学段模式把初二与初三的考试画在同一张图中；两学段计入总分满分不同（初二 570 / 初三 730），比较绝对分数时请注意口径',
          '总分折线参考线取各次考试已录入科目的卷面满分最大值',
        ]
        : [
          `总分折线参考线取本次已录入科目的卷面满分；${GRADE_LABEL[single] ?? ''}中考口径满分为 ${gradeFullScore(single)} 分（尚未开考的科目不计入卷面满分）`,
          'values 中某科为 null 表示该次考试未开课、缺考或未录入，前端须渲染为断点，不得按 0 处理',
        ],
  };
}

/* ------------------------------------------------------------------ */
/* 排名趋势（名次越小越好，Y 轴需反向渲染）                            */
/* ------------------------------------------------------------------ */

export function rankTrend(q = {}) {
  const scope = q.grade == null ? resolveGrade(undefined) : resolveGrade(q.grade);
  const single = normalizeGrade(scope);
  const exams = findExamsForStats({ from: q.from, to: q.to, types: q.types, grade: single, includeDraft: false });
  const points = exams.map((e) => ({
    examId: e.examId,
    examDate: e.examDate,
    examName: e.name,
    grade: e.grade,
    classRank: e.classRank ?? null,
    classSize: e.classSize ?? null,
    gradeRank: e.gradeRank ?? null,
    gradeSize: e.gradeSize ?? null,
  }));
  return {
    grade: scope,
    gradeLabel: scope === 'all' ? '全部' : (GRADE_LABEL[single] ?? null),
    points,
    series: [
      { key: 'classRank', name: '班级排名', reverseAxis: true, sizeKey: 'classSize' },
      { key: 'gradeRank', name: '年级排名', reverseAxis: true, sizeKey: 'gradeSize' },
    ],
    notes: ['reverseAxis=true 表示名次越小越好，前端必须将 Y 轴反向渲染', '班级/年级排名只在同一学段内可比，不跨学段混合'],
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

  // 与趋势一致的考试口径：同属一个学段、默认排除单项测试（sport/lab）
  let scope = findExamsForStats({ grade: exam.grade });
  let idx = scope.findIndex((e) => e.examId === examId);
  if (idx === -1) {
    scope = findExamsForStats({ grade: exam.grade, types: [exam.examType] });
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
      grade: exam.grade, gradeLabel: exam.gradeLabel,
      totalScore: exam.totalScore, totalFullScore: exam.totalFullScore,
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
  const grade = normalizeGrade(q.grade);
  const exams = findExamsForStats({ from: q.from, to: q.to, types: q.types, grade, includeDraft: false });
  const idxByGrade = subjectIndexByGrade();

  // 列：同一科目（code）只显示一列，初二/初三共用；单元格取各次考试自己学段的科目行
  const list = grade ? listSubjectsRaw({ grade }) : listSubjectsRaw({});
  const scores = loadScores(exams.map((e) => e.examId));
  const usedIds = new Set();
  for (const sm of scores.values()) for (const id of sm.keys()) usedIds.add(id);

  const colMap = new Map();
  for (const s of list) {
    if (!s.isActive && !usedIds.has(s.id)) continue;
    const prev = colMap.get(s.code);
    if (!prev) {
      colMap.set(s.code, {
        subjectId: s.id, code: s.code, name: s.name, scoreMode: s.scoreMode,
        grades: [s.grade], fullScore: s.fullScore, sortOrder: s.sortOrder,
      });
    } else {
      if (!prev.grades.includes(s.grade)) prev.grades.push(s.grade);
      // 两学段满分不同（如历史 70/50）时列级满分不可用，置 null（单元格仍带各自学段的满分）
      if (prev.fullScore !== s.fullScore) prev.fullScore = null;
    }
  }
  const columns = [...colMap.values()].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

  const ordered = [...exams].reverse();
  const page = Math.max(1, Number(q.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(q.pageSize) || 20));
  const slice = ordered.slice((page - 1) * pageSize, page * pageSize);

  const rows = slice.map((e) => {
    const sm = scores.get(e.examId) ?? new Map();
    const gradeMap = idxByGrade.get(e.grade) ?? new Map();
    // 该学段下科目 id -> 列下标（同一科目两学段 subjectId 相同，不会串列：
    // 每次考试只会有自己学段的科目成绩行）
    const colBySubjectId = new Map();
    columns.forEach((c, i) => { if (c.grades.includes(e.grade)) colBySubjectId.set(c.subjectId, i); });
    const cells = columns.map((c) => ({ subjectId: c.subjectId, score: null, gradeLevel: null, classRank: null, isAbsent: false, entered: false, fullScore: c.fullScore }));
    for (const [subjectId, r] of sm) {
      const i = colBySubjectId.get(subjectId);
      if (i == null) continue;
      cells[i] = {
        subjectId, score: r.score, gradeLevel: r.gradeLevel, classRank: r.classRank,
        isAbsent: r.isAbsent, entered: true, fullScore: gradeMap.get(subjectId)?.fullScore ?? columns[i].fullScore,
      };
    }
    return {
      examId: e.examId, examDate: e.examDate, name: e.name, examType: e.examType,
      grade: e.grade, gradeLabel: GRADE_LABEL[e.grade] ?? null,
      totalScore: e.totalScore, totalFullScore: e.totalFullScore, enteredFullScore: e.enteredFullScore,
      classRank: e.classRank, classSize: e.classSize,
      gradeRank: e.gradeRank, gradeSize: e.gradeSize,
      cells,
    };
  });

  return { grade, gradeLabel: GRADE_LABEL[grade] ?? null, columns, rows, total: ordered.length, page, pageSize };
}

/* ------------------------------------------------------------------ */
/* 首页仪表盘                                                         */
/* ------------------------------------------------------------------ */

export function overview(q = {}) {
  const db = getDb();
  const grade = normalizeGrade(q.grade);
  const where = ["status='confirmed'"];
  const params = [];
  if (grade) { where.push('grade = ?'); params.push(grade); }
  const latestRow = db
    .prepare(`SELECT id, grade FROM exam WHERE ${where.join(' AND ')} ORDER BY exam_date DESC, id DESC LIMIT 1`)
    .get(...params);

  if (!latestRow) {
    return {
      grade: grade ?? null, latestExam: null, subjectOverview: [],
      totalTrend: [], totalFullScore: grade ? gradeFullScore(grade) : null,
      rankTrend: [], targetGap: null, latestReport: null,
    };
  }

  const exam = getExam(latestRow.id);
  const cmp = compare(latestRow.id);
  const params2 = getStatParams();
  const g = exam.grade;

  const subjectOverview = exam.scores
    .filter((s) => s.scoreMode === 'score')
    .map((s) => {
      const prev = cmp.vsPrevious.subjects.find((x) => x.subjectId === s.subjectId);
      const avg = cmp.vsAverage.subjects.find((x) => x.subjectId === s.subjectId);
      return {
        subjectId: s.subjectId, subjectName: s.subjectName, fullScore: s.fullScore,
        countsToTotal: s.countsToTotal,
        latest: s.score, isAbsent: s.isAbsent,
        deltaVsPrev: prev?.scoreDelta ?? null,
        avgScore: avg?.avgScore ?? null,
        deltaVsAvg: avg?.scoreDelta ?? null,
        classRank: s.classRank ?? null,
      };
    });

  // 首页趋势跟随学段筛选：未选学段（全部）时两学段同图，与趋势页「全部」口径一致
  const trendData = trend({ grade: grade ?? 'all', subjectCodes: [] });

  let latestReport = null;
  const rep = db
    .prepare('SELECT id, created_at AS createdAt, model, is_fallback AS isFallback FROM analysis_report ORDER BY created_at DESC, id DESC LIMIT 1')
    .get();
  if (rep) latestReport = { reportId: rep.id, createdAt: rep.createdAt, model: rep.model, isFallback: asBool(rep.isFallback) };

  return {
    grade: g,
    gradeLabel: exam.gradeLabel,
    latestExam: {
      examId: exam.examId, name: exam.name, examDate: exam.examDate, examType: exam.examType,
      grade: g, gradeLabel: exam.gradeLabel,
      totalScore: exam.totalScore, totalFullScore: exam.totalFullScore,
      enteredFullScore: exam.enteredFullScore,
      deltaVsPrev: cmp.vsPrevious.totalDelta,
      classRank: exam.classRank, classSize: exam.classSize,
      gradeRank: exam.gradeRank, gradeSize: exam.gradeSize,
    },
    subjectOverview,
    totalTrend: trendData.points.slice(-8),
    // 学段（中考）口径满分：初二 570 / 初三 730
    totalFullScore: gradeFullScore(g),
    rankTrend: rankTrend({ grade: g }).points.slice(-8),
    // 目标院校为中考（初三 730）口径；初二阶段不提供对比，避免差距虚高
    targetGap: g === 9 ? safeCompareSchools() : null,
    targetAvailable: g === 9,
    declineThreshold: params2.declineThreshold,
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
  const { from, to, grade: rawGrade } = scope.scopeRef ?? {};
  const exams = findExamsForStats({ from, to, includeDraft: false });

  // 学段：优先取显式传入，否则取范围内最近一次考试的学段
  const grade = normalizeGrade(rawGrade)
    ?? (exams.length ? Number(exams[exams.length - 1].grade) : resolveGrade(undefined));

  const scoped = exams.filter((e) => Number(e.grade) === grade);
  const idxByGrade = subjectIndexByGrade();
  const scores = loadScores(scoped.map((e) => e.examId));
  const list = listSubjectsRaw({ grade });
  const scoreSubjects = list.filter((s) => s.countsToTotal && s.scoreMode === 'score');

  const subjects = scoreSubjects.map((s) => {
    const series = seriesOf(scoped, scores, s.id);
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

  const totalSeries = scoped.map((e) => {
    const t = totalOfExam(scores.get(e.examId) ?? new Map(), idxByGrade.get(e.grade) ?? new Map());
    return t.entered > 0 ? t.total : null;
  });

  const rankPairs = scoped
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
    grade,
    gradeLabel: GRADE_LABEL[grade] ?? null,
    fullScore: gradeFullScore(grade),
    examCount: scoped.length,
    declineThreshold: params.declineThreshold,
    exams: scoped.map((e) => ({
      examId: e.examId, name: e.name, examDate: e.examDate, examType: e.examType,
      grade: e.grade,
      total: e.totalScore, classRank: e.classRank, classSize: e.classSize,
      gradeRank: e.gradeRank, gradeSize: e.gradeSize,
    })),
    totalSeries,
    subjects,
    rankTrend: rankTrendObj,
    // 目标院校录取线为初三中考口径，仅学段为初三时才提供
    target: grade === 9 ? safeCompareSchools() : null,
  };
}

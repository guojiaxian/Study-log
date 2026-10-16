/**
 * 目标院校对比口径（对应开发手册 6.5）。
 * - 中考口径总分 = Σ 各计入总分科目"最近一次已录入得分"
 * - 录取线默认取近三年均值，可切换最近一年
 * - 跨口径（total_full_score ≠ 730）自动折算后再比较
 */
import { round2 } from './metrics.js';

export const BASE_FULL_SCORE = 730;

/** 保留一位小数（录取线与差距的展示精度，与产品文档示例一致） */
export const round1 = (n) => Math.round((Number(n) + Number.EPSILON) * 10) / 10;

/** 折算到 730 口径 */
export function toBase730(minScore, totalFullScore) {
  if (!totalFullScore || totalFullScore === BASE_FULL_SCORE) return round1(minScore);
  return round1((minScore / totalFullScore) * BASE_FULL_SCORE);
}

/**
 * 录取线取值
 * @param {Array<{year:number,minScore:number,totalFullScore:number}>} rows
 * @param {'avg3y'|'latest'} mode
 */
export function pickLineScore(rows, mode = 'avg3y') {
  if (!rows || !rows.length) return { score: null, years: [], mode };
  const normalized = rows.map((r) => ({
    year: r.year,
    score: toBase730(r.minScore, r.totalFullScore),
  }));
  const sorted = [...normalized].sort((a, b) => b.year - a.year);
  if (mode === 'latest') {
    return { score: sorted[0].score, years: [sorted[0].year], mode };
  }
  const top = sorted.slice(0, 3);
  return {
    score: round1(top.reduce((a, s) => a + s.score, 0) / top.length),
    years: top.map((s) => s.year).sort((a, b) => a - b),
    mode,
  };
}

/** 差距：录取线 − 我的总分（负=需提分，正=已超线） */
export function gapOf(lineScore, myTotal) {
  if (lineScore == null || myTotal == null) return null;
  return round1(lineScore - myTotal);
}

/**
 * 以"各计入总分科目最近一次得分"为基准构造中考口径总分。
 * @param {Array<{subjectId:number,score:number,examId:number,examDate:string,isAbsent:number,countsToTotal:number,scoreMode:string}>} scoreRows
 * @returns {{total:number, components:Array, missingSubjectIds:number[]}}
 */
export function latestPerSubjectTotal(scoreRows) {
  const latest = new Map(); // subjectId -> row
  for (const r of scoreRows) {
    if (r.countsToTotal !== 1) continue;
    if (r.scoreMode === 'grade') continue;
    if (r.isAbsent || r.score == null) continue;
    const prev = latest.get(r.subjectId);
    if (!prev || String(r.examDate) >= String(prev.examDate)) latest.set(r.subjectId, r);
  }
  const components = [...latest.values()].map((r) => ({
    subjectId: r.subjectId,
    subjectName: r.subjectName,
    score: round2(r.score),
    fromExamId: r.examId,
    fromExamDate: r.examDate,
  }));
  const total = round2(components.reduce((a, c) => a + c.score, 0));
  return { total, components };
}

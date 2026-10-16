/**
 * 派生指标口径的唯一实现（对应开发手册 8.4 口径纪律 #4）。
 * 前后端共享同一口径定义；任何图表与分析都不得自建另一套。
 */

/** 保留两位小数 */
export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/** 算术平均（忽略 null/NaN）；空数组返回 null */
export function mean(arr) {
  const xs = arr.filter((v) => v != null && !Number.isNaN(v));
  if (!xs.length) return null;
  return round2(xs.reduce((a, b) => a + b, 0) / xs.length);
}

/** 总体标准差 */
export function stddev(arr) {
  const xs = arr.filter((v) => v != null && !Number.isNaN(v));
  if (xs.length < 2) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return round2(Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length));
}

/**
 * 末尾连续严格递减的**下降次数**。
 * 例：[102,100,99,96] -> 3（即"连续 3 次下降"）。
 */
export function declineRun(values) {
  const xs = values.filter((v) => v != null && !Number.isNaN(v));
  let n = 0;
  for (let i = xs.length - 1; i > 0; i -= 1) {
    if (xs[i] < xs[i - 1]) n += 1;
    else break;
  }
  return n;
}

/** 某次考试的总分：计入总分且未缺考科目的得分之和 */
export function totalOfScores(scores, subjectById) {
  let total = 0;
  let entered = 0;
  for (const s of scores) {
    const sub = subjectById.get(s.subjectId);
    if (!sub || !sub.countsToTotal) continue;
    if (s.isAbsent) continue;
    if (s.score == null) continue;
    total += s.score;
    entered += 1;
  }
  return { total: round2(total), entered };
}

/** 名次进退：上次名次 − 本次名次（正=进步，负=退步） */
export function rankDelta(prevRank, currRank) {
  if (prevRank == null || currRank == null) return null;
  return prevRank - currRank;
}

/** 分组工具：按 key 聚合为 Map */
export function groupBy(rows, keyFn) {
  const m = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
}

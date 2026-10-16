/**
 * 规则兜底分析（对应开发手册 6.6）。
 * 未配置 AI 或调用失败时生成，输出结构与 AI 报告一致，is_fallback=1。
 */
import { round2 } from './metrics.js';

function fmt(n) { return n == null ? '—' : String(round2(n)); }
function sign(n) { return n > 0 ? `+${round2(n)}` : String(round2(n)); }

/**
 * @param {object} summary statsService.buildSummary() 的输出
 * @returns {{overall, strengths, weaknesses, trend, rankTrend, targetGap, suggestions, contentMd}}
 */
export function buildFallbackReport(summary) {
  const subjects = summary.subjects || [];
  const threshold = summary.declineThreshold ?? 3;

  const withAvg = subjects.filter((s) => s.avgScore != null && s.latest != null);
  const sortedByVsAvg = [...withAvg].sort((a, b) => (a.deltaVsAvg ?? 0) - (b.deltaVsAvg ?? 0));

  const weaknesses = sortedByVsAvg.filter((s) => (s.deltaVsAvg ?? 0) < 0).slice(0, 2);
  const strengths = sortedByVsAvg
    .filter((s) => (s.deltaVsAvg ?? 0) > 0)
    .slice(-2)
    .reverse();
  const declining = subjects.filter((s) => s.decline >= threshold && s.decline > 0);
  const volatile = [...subjects]
    .filter((s) => s.values.filter((v) => v != null).length >= 2)
    .sort((a, b) => (b.stddev ?? 0) - (a.stddev ?? 0))[0];

  const totalSeries = summary.totalSeries || [];
  const first = totalSeries.find((v) => v != null);
  const last = [...totalSeries].reverse().find((v) => v != null);
  const totalDelta = first != null && last != null ? round2(last - first) : null;

  const rank = summary.rankTrend || {};
  const rankDown = (rank.classDelta != null && rank.classDelta < 0) || (rank.gradeDelta != null && rank.gradeDelta < 0);

  // ---- 分区文本 ----
  const overallParts = [];
  if (summary.exams?.length) overallParts.push(`区间内共 ${summary.exams.length} 次考试`);
  if (totalDelta != null) {
    overallParts.push(
      `文化课总分从 ${fmt(first)} ${totalDelta >= 0 ? '提升' : '下降'}至 ${fmt(last)}（${sign(totalDelta)} 分）`,
    );
  }
  const overall = overallParts.length ? `${overallParts.join('，')}。` : '当前记录的数据不足以形成总体判断，请继续录入成绩。';

  const strengthLines = strengths.map((s) => `${s.name}：本次 ${fmt(s.latest)} 分，高于历史均值 ${sign(s.deltaVsAvg)} 分，表现稳定`);
  const weakLines = weaknesses.map((s) => {
    const extra = s.decline >= threshold ? `，且连续 ${s.decline} 次下降` : '';
    return `${s.name}：本次 ${fmt(s.latest)} 分，低于历史均值 ${fmt(Math.abs(s.deltaVsAvg ?? 0))} 分${extra}，建议优先干预`;
  });
  if (!weakLines.length && declining.length) {
    for (const s of declining) {
      weakLines.push(`${s.name}：连续 ${s.decline} 次下降（${s.values.filter((v) => v != null).join(' → ')}），需关注`);
    }
  }

  const trend = totalDelta == null
    ? '数据点不足，暂无法判断整体趋势。'
    : totalDelta > 0
      ? `总分整体呈上升趋势（${sign(totalDelta)} 分）。`
      : totalDelta < 0
        ? `总分整体呈下降趋势（${sign(totalDelta)} 分），需重点关注薄弱科目的失分结构。`
        : '总分整体持平。';

  let rankTrendText = '未录入排名信息，暂无法判断名次变化。';
  if (rank.classStart != null && rank.classEnd != null) {
    rankTrendText = `班级排名由第 ${rank.classStart} 名变为第 ${rank.classEnd} 名`;
    if (rank.gradeStart != null && rank.gradeEnd != null) {
      rankTrendText += `；年级排名由第 ${rank.gradeStart} 名变为第 ${rank.gradeEnd} 名`;
    }
    rankTrendText += rankDown ? '，整体名次有所退步。' : '，整体名次进步或持平。';
  }

  let targetGapText = '未配置目标院校数据。';
  if (summary.target?.schools?.length) {
    const myTotal = summary.target.basis?.myTotal ?? null;
    const targets = summary.target.schools
      .filter((s) => s.lineScore != null)
      .map((s) => `${s.name} 需提分 ${fmt(Math.abs(s.gap ?? 0))}`);
    targetGapText = `当前中考口径总分 ${fmt(myTotal, 0)} / 730；${targets.join('，')}。`;
  }

  const suggestions = [];
  if (weaknesses.length) {
    suggestions.push(`${weaknesses[0].name}：优先排查近期失分集中的题型，安排每周固定的专项训练并复盘错题`);
  }
  if (declining.length) {
    suggestions.push(`${declining[0].name}：连续下滑，建议按"先补基础—再练综合"的顺序安排 2–3 周专项提升`);
  }
  if (volatile && (volatile.stddev ?? 0) > 0) {
    suggestions.push(`${volatile.name}：分数波动最大（标准差 ${fmt(volatile.stddev)}），建议稳定答题节奏与时间分配`);
  }
  if (strengths.length) {
    suggestions.push(`${strengths.map((s) => s.name).join('、')}：维持当前训练节奏，避免为补薄弱科而削减投入`);
  }
  if (!suggestions.length) suggestions.push('继续按现有节奏录入成绩，积累 3 次以上考试后再查看专项建议。');

  const contentMd = [
    '## 总体判断',
    overall,
    '',
    '## 优势科目',
    strengthLines.length ? strengthLines.map((l) => `- ${l}`).join('\n') : '- 暂无明显优势科目',
    '',
    '## 薄弱科目',
    weakLines.length ? weakLines.map((l) => `- ${l}`).join('\n') : '- 暂无明显薄弱科目',
    '',
    '## 趋势判断',
    trend,
    '',
    '## 排名趋势',
    rankTrendText,
    '',
    '## 目标差距',
    targetGapText,
    '',
    '## 可执行建议',
    suggestions.map((s, i) => `${i + 1}. ${s}`).join('\n'),
  ].join('\n');

  return {
    overall,
    strengths: strengthLines,
    weaknesses: weakLines,
    trend,
    rankTrend: rankTrendText,
    targetGap: targetGapText,
    suggestions,
    contentMd,
    isFallback: true,
  };
}

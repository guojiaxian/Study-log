import { describe, it, expect } from 'vitest';
import { declineRun, mean, stddev, totalOfScores, rankDelta, round2 } from '../src/lib/metrics.js';
import { toBase730, pickLineScore, gapOf, latestPerSubjectTotal } from '../src/lib/schoolCompare.js';
import { matchSubject, normalizeName } from '../src/lib/subjectMatch.js';

const SUBJECTS = [
  { id: 1, code: 'chinese', name: '语文', fullScore: 120, countsToTotal: true, scoreMode: 'score' },
  { id: 2, code: 'math', name: '数学', fullScore: 120, countsToTotal: true, scoreMode: 'score' },
  { id: 6, code: 'politics', name: '道德与法治', fullScore: 70, countsToTotal: true, scoreMode: 'score' },
  { id: 10, code: 'biology', name: '生物', fullScore: 100, countsToTotal: false, scoreMode: 'grade' },
];
const ALIAS = { politics: ['道法', '政治'], english: ['英语', '外语'] };

describe('metrics 口径', () => {
  it('declineRun 统计末尾连续下降次数', () => {
    expect(declineRun([102, 100, 99, 96])).toBe(3);
    expect(declineRun([95, 100, 99])).toBe(1);
    expect(declineRun([100, 101, 102])).toBe(0);
  });

  it('mean / stddev', () => {
    expect(mean([101, 104, 102, 98])).toBe(101.25);
    expect(mean([])).toBe(null);
    expect(stddev([2, 2, 2])).toBe(0);
  });

  it('totalOfScores 只合计计入总分且未缺考的科目', () => {
    const byId = new Map(SUBJECTS.map((s) => [s.id, s]));
    const scores = [
      { subjectId: 1, score: 98, isAbsent: false },
      { subjectId: 2, score: 104, isAbsent: false },
      { subjectId: 6, score: 62, isAbsent: false },
      { subjectId: 10, score: null, isAbsent: false }, // 等级科目，不计
    ];
    expect(totalOfScores(scores, byId)).toEqual({ total: 264, entered: 3 });
  });

  it('rankDelta 正数表示名次进步', () => {
    expect(rankDelta(11, 8)).toBe(3);
    expect(rankDelta(8, 11)).toBe(-3);
    expect(rankDelta(null, 8)).toBe(null);
  });

  it('round2', () => {
    expect(round2(83.674)).toBe(83.67);
  });
});

describe('目标院校对比口径', () => {
  const rows = [
    { year: 2024, minScore: 707, totalFullScore: 730 },
    { year: 2025, minScore: 699, totalFullScore: 730 },
    { year: 2026, minScore: 699, totalFullScore: 730 },
  ];

  it('跨口径折算到 730', () => {
    expect(toBase730(670, 700)).toBe(698.7);
    expect(toBase730(707, 730)).toBe(707);
  });

  it('近三年均值 / 最近一年', () => {
    expect(pickLineScore(rows, 'avg3y').score).toBe(701.7);
    expect(pickLineScore(rows, 'latest').score).toBe(699);
  });

  it('差距：录取线 − 我的总分', () => {
    expect(gapOf(701.7, 618)).toBe(83.7);
    expect(gapOf(697.7, 700)).toBe(-2.3);
  });

  it('中考口径总分取各科目最近一次得分', () => {
    const base = SUBJECTS.map((s) => ({ ...s, countsToTotal: s.countsToTotal ? 1 : 0 }));
    const scoreRows = [
      { subjectId: 1, score: 90, isAbsent: 0, examId: 1, examDate: '2026-09-07', countsToTotal: 1, scoreMode: 'score', subjectName: '语文' },
      { subjectId: 1, score: 98, isAbsent: 0, examId: 4, examDate: '2026-10-12', countsToTotal: 1, scoreMode: 'score', subjectName: '语文' },
      { subjectId: 2, score: 104, isAbsent: 0, examId: 4, examDate: '2026-10-12', countsToTotal: 1, scoreMode: 'score', subjectName: '数学' },
      { subjectId: 10, score: null, isAbsent: 0, examId: 4, examDate: '2026-10-12', countsToTotal: 0, scoreMode: 'grade', subjectName: '生物' },
    ];
    const res = latestPerSubjectTotal(scoreRows);
    expect(res.total).toBe(202); // 98 + 104
    expect(res.components).toHaveLength(2);
    void base;
  });
});

describe('科目名匹配', () => {
  it('精确匹配 name 与 code', () => {
    expect(matchSubject('语文', SUBJECTS, ALIAS).matchType).toBe('exact');
    expect(matchSubject('math', SUBJECTS, ALIAS).subjectId).toBe(2);
  });

  it('别名匹配', () => {
    const r = matchSubject('道法', SUBJECTS, ALIAS);
    expect(r.matchType).toBe('alias');
    expect(r.subjectId).toBe(6);
  });

  it('归一化与包含匹配归为 fuzzy（不得自动入库）', () => {
    expect(matchSubject('语文科', SUBJECTS, ALIAS).matchType).toBe('fuzzy');
  });

  it('未命中为 unmatched', () => {
    expect(matchSubject('体育', SUBJECTS, ALIAS).matchType).toBe('unmatched');
  });

  it('normalizeName 去除空白与括号内容', () => {
    expect(normalizeName(' 数学（满分120） ')).toBe('数学');
  });
});

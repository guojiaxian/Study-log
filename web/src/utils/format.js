export const fmt = (n, d = 1) => {
  if (n == null || Number.isNaN(Number(n))) return '—';
  const v = Number(n);
  const s = v.toFixed(d);
  return d > 0 ? s.replace(/\.?0+$/, '') : s;
};

export const signed = (n, d = 1) => {
  if (n == null || Number.isNaN(Number(n))) return '—';
  const v = Number(n);
  return `${v > 0 ? '+' : ''}${fmt(v, d)}`;
};

export const trendArrow = (n) => (n == null ? '—' : n > 0 ? '▲' : n < 0 ? '▼' : '—');
export const trendClass = (n) => (n == null ? 'flat' : n > 0 ? 'up' : n < 0 ? 'down' : 'flat');

/** 名次进退：正=进步，负=退步 */
export const rankArrow = (delta) => (delta == null ? '—' : delta > 0 ? '▲' : delta < 0 ? '▼' : '—');
export const rankClass = (delta) => (delta == null ? 'flat' : delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat');
export const rankText = (delta) => (delta == null ? '—' : delta > 0 ? `进步 ${delta} 名` : delta < 0 ? `退步 ${-delta} 名` : '持平');

export const examTypeName = (code) =>
  ({
    unit: '单元测', week: '周测', month: '月考', midterm: '期中考试',
    final: '期末考试', mock: '模拟考', sport: '体育测试', lab: '实验操作测试', other: '其他',
  }[code] ?? code);

export const VERDICT = {
  above: { text: '高于均值', cls: 'up' },
  below: { text: '低于均值', cls: 'down' },
  flat: { text: '接近均值', cls: 'flat' },
};

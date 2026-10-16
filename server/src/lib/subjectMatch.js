/**
 * 科目名匹配（对应开发手册 6.4）。
 * 优先级：精确 → 别名 → 归一化/后缀 → 包含；fuzzy 与 unmatched 均不得自动入库。
 */

const SUFFIXES = ['成绩', '科目', '科'];

export function normalizeName(raw) {
  let s = String(raw ?? '').trim();
  s = s.replace(/\s+/g, '');
  s = s.replace(/[（(][^）)]*[)）]/g, '');
  s = s.replace(/[，,。.、;；:：]/g, '');
  return s;
}

function stripSuffix(s) {
  let r = s;
  for (const suf of SUFFIXES) {
    if (r.length > suf.length && r.endsWith(suf)) r = r.slice(0, -suf.length);
  }
  return r;
}

/**
 * @param {string} raw 识别到的原始科目名
 * @param {Array<{id:number,code:string,name:string}>} subjects
 * @param {Object<string,string[]>} aliasMap code -> 别名数组
 * @returns {{subjectId:number|null, subjectName:string|null, matchType:'exact'|'alias'|'fuzzy'|'unmatched'}}
 */
export function matchSubject(raw, subjects, aliasMap = {}) {
  const n = normalizeName(raw);
  if (!n) return { subjectId: null, subjectName: null, matchType: 'unmatched' };

  // 1. 精确：name 或 code
  for (const s of subjects) {
    if (normalizeName(s.name) === n || String(s.code).toLowerCase() === n.toLowerCase()) {
      return { subjectId: s.id, subjectName: s.name, matchType: 'exact' };
    }
  }

  // 2. 别名
  for (const [code, list] of Object.entries(aliasMap || {})) {
    if ((list || []).some((a) => normalizeName(a) === n)) {
      const s = subjects.find((x) => x.code === code);
      if (s) return { subjectId: s.id, subjectName: s.name, matchType: 'alias' };
    }
  }

  // 3. 归一化（去后缀后完全一致）
  const base = stripSuffix(n);
  for (const s of subjects) {
    const sn = normalizeName(s.name);
    const sb = stripSuffix(sn);
    if (sn === n || sb === base || sb === n || sn === base) {
      return { subjectId: s.id, subjectName: s.name, matchType: 'fuzzy' };
    }
  }

  // 4. 包含匹配（互为子串）
  for (const s of subjects) {
    const sn = normalizeName(s.name);
    if (sn.length >= 2 && (n.includes(sn) || sn.includes(n))) {
      return { subjectId: s.id, subjectName: s.name, matchType: 'fuzzy' };
    }
  }

  return { subjectId: null, subjectName: null, matchType: 'unmatched' };
}

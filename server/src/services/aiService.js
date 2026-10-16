import { getDb, audit } from '../db/index.js';
import { Err } from '../lib/errors.js';
import { listSubjectsRaw, subjectMap } from './subjectService.js';
import { subjectAliasMap } from './configService.js';
import { matchSubject } from '../lib/subjectMatch.js';
import { createExam } from './examService.js';

/** AI 配置仅来自环境变量（默认 DeepSeek），前端不提供配置入口 */
export function aiConfig() {
  return {
    provider: process.env.AI_PROVIDER || 'deepseek',
    baseUrl: (process.env.AI_BASE_URL || 'https://api.deepseek.com/v1').replace(/\/+$/, ''),
    apiKey: process.env.AI_API_KEY || '',
    model: process.env.AI_MODEL || 'deepseek-chat',
    timeoutMs: Number(process.env.AI_TIMEOUT_MS || 20000),
    // 解析/分析的最大输出 token。推理型模型（deepseek-flash）会先消耗大量
    // reasoning tokens（实测 1.3k–4k+），预算不足会导致 JSON 被截断，故须留足余量。
    parseMaxTokens: Number(process.env.AI_MAX_TOKENS_PARSE || 4000),
    analysisMaxTokens: Number(process.env.AI_MAX_TOKENS_ANALYSIS || 12000),
  };
}

export function status() {
  const c = aiConfig();
  return { configured: Boolean(c.apiKey), provider: c.provider, model: c.model };
}

function extractJson(text) {
  if (!text) return null;
  let s = String(text).trim();
  s = s.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = s.indexOf('{');
  if (start === -1) return null;
  const end = s.lastIndexOf('}');
  if (end > start) {
    try { return JSON.parse(s.slice(start, end + 1)); } catch { /* 继续尝试修复 */ }
  }
  return repairJson(s.slice(start));
}

/**
 * 尽力修复被截断的 JSON（推理模型在 token 预算不足时会截断输出）。
 * 做法：补全未闭合的字符串，并按栈闭合未结束的对象/数组。
 */
function repairJson(frag) {
  let inStr = false;
  let esc = false;
  const stack = [];
  let out = '';
  for (const ch of frag) {
    out += ch;
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if (ch === '}' || ch === ']') stack.pop();
  }
  if (inStr) out += '"';
  out = out.replace(/,\s*$/, '');
  out = out.replace(/,\s*"[^"]*"\s*:\s*$/, '');
  while (stack.length) out += stack.pop();
  try { return JSON.parse(out); } catch { return null; }
}

async function callChat(cfg, messages, { temperature = 0, maxTokens = 800 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    const resp = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.model,
        messages,
        temperature,
        max_tokens: maxTokens,
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      if (resp.status === 401 || resp.status === 403 || resp.status === 402) throw Err.aiQuota(`AI 鉴权或额度异常(${resp.status})`);
      throw Err.aiUnavailable(`AI 服务返回 ${resp.status}${body ? `: ${body.slice(0, 200)}` : ''}`);
    }
    const json = await resp.json();
    return {
      content: json?.choices?.[0]?.message?.content ?? '',
      finishReason: json?.choices?.[0]?.finish_reason ?? null,
      usage: json?.usage?.total_tokens ?? null,
      model: json?.model ?? cfg.model,
    };
  } catch (err) {
    if (err.name === 'AbortError') throw Err.aiUnavailable('AI 调用超时');
    if (err instanceof Error && err.code) throw err;
    throw Err.aiUnavailable(`AI 调用失败: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }
}

const PARSE_SYSTEM = `你是成绩单结构化助手。请从用户提供的文本中提取考试信息、各科成绩与名次。
硬性要求：
1. 只输出 JSON，不要任何解释文字。
2. 科目名保持原文（rawSubject），不要自行改写成标准名。
3. 分数必须是文本中出现的原始数字；不要推断、不要补全、不要计算满分。
4. 等级类成绩（如 A/B/C/D、优良中差）填入 gradeLevel。
5. 若文本中出现班级/年级排名与人数，填入 ranks；没有则为 null。
6. 无法确定的内容放入 warnings，不要猜测。
输出结构（JSON）：
{"exam":{"name":string|null,"examDate":"YYYY-MM-DD"|null,"examType":"unit|week|month|midterm|final|mock|sport|lab|other"|null},
 "items":[{"rawSubject":string,"score":number|null,"gradeLevel":"A|B|C|D"|null}],
 "ranks":{"classRank":number|null,"classSize":number|null,"gradeRank":number|null,"gradeSize":number|null},
 "warnings":[{"level":"warn|info","message":string}]}`;

export async function parseScore(payload = {}) {
  const cfg = aiConfig();
  if (!cfg.apiKey) throw Err.aiUnavailable('AI 未配置：请在服务端 .env 中设置 AI_API_KEY');
  const rawText = String(payload.rawText || '').trim();
  if (!rawText) throw Err.validation('rawText 为必填');
  if (rawText.length > 2000) throw Err.validation('rawText 长度超过 2000 字，请分批解析或改用手动录入');

  const startedAt = Date.now();
  // 注意：推理型模型（如 deepseek-flash）会先消耗 reasoning tokens，
  // max_tokens 需留足余量，否则 JSON 会被截断。
  const { content, usage, model, finishReason } = await callChat(cfg, [
    { role: 'system', content: PARSE_SYSTEM },
    { role: 'user', content: rawText },
  ], { temperature: 0, maxTokens: cfg.parseMaxTokens });

  if (!content) {
    throw Err.aiUnavailable(
      `AI 未返回有效内容（finish_reason=${finishReason}）。推理型模型可能耗尽了 token 预算，请调大 AI_MAX_TOKENS_PARSE 或更换模型`,
    );
  }
  const parsed = extractJson(content);
  if (!parsed) throw Err.aiParse('AI 返回内容无法解析为合法 JSON', { raw: content.slice(0, 500) });

  const subjects = listSubjectsRaw();
  const alias = subjectAliasMap();
  const items = (parsed.items || []).map((it) => {
    const m = matchSubject(it.rawSubject, subjects, alias);
    const sub = subjects.find((s) => s.id === m.subjectId);
    const fullScore = sub && sub.scoreMode === 'score' ? sub.fullScore : null;
    return {
      rawSubject: it.rawSubject ?? '',
      subjectId: m.subjectId,
      subjectName: m.subjectName,
      matchType: m.matchType,
      score: it.score ?? null,
      gradeLevel: it.gradeLevel ?? null,
      fullScore,
    };
  });

  const warnings = [...(parsed.warnings || [])];
  const unmatched = items.filter((i) => i.matchType === 'unmatched').length;
  if (unmatched) warnings.push({ level: 'warn', rawSubject: '-', message: `${unmatched} 项未匹配到科目，不会入库，请在校对时处理` });

  const durationMs = Date.now() - startedAt;
  const info = getDb().prepare(`INSERT INTO ai_parse_task (raw_text, parsed_json, status, model, duration_ms, token_usage)
    VALUES (?, ?, 'parsed', ?, ?, ?)`)
    .run(rawText, JSON.stringify({ items, ranks: parsed.ranks ?? null, warnings }), model, durationMs, usage);

  return {
    taskId: Number(info.lastInsertRowid),
    model,
    durationMs,
    exam: {
      name: parsed.exam?.name ?? payload.examName ?? null,
      examDate: parsed.exam?.examDate ?? payload.examDate ?? null,
      examType: parsed.exam?.examType ?? payload.examType ?? null,
    },
    items,
    ranks: parsed.ranks ?? null,
    warnings,
  };
}

export function getParseTask(id) {
  const row = getDb().prepare('SELECT * FROM ai_parse_task WHERE id = ?').get(id);
  if (!row) throw Err.notFound('解析任务不存在');
  return row;
}

/** 校对后的最终结果入库（服务端不信任模型原始输出） */
export function commitParse(payload = {}) {
  const { taskId, exam = {}, scores = [] } = payload;
  if (!scores.length) throw Err.validation('scores 不能为空');
  const result = createExam({
    name: exam.name,
    examType: exam.examType,
    examDate: exam.examDate,
    grade: exam.grade ?? 9,
    term: exam.term ?? null,
    status: exam.status ?? 'confirmed',
    remark: exam.remark ?? null,
    classRank: exam.classRank ?? null,
    classSize: exam.classSize ?? null,
    gradeRank: exam.gradeRank ?? null,
    gradeSize: exam.gradeSize ?? null,
    source: 'ai_import',
    scores,
  });
  if (taskId) {
    getDb().prepare(`UPDATE ai_parse_task SET status='confirmed' WHERE id=?`).run(taskId);
  }
  audit('ai.commit', `exam:${result.examId}`, `written=${result.written}`);
  return { examId: result.examId, written: result.written };
}

const ANALYSIS_SYSTEM = `你是初中学生学习顾问。基于给定的结构化成绩摘要输出学情分析。
硬性要求：
1. 所有数值必须直接引用摘要中的数字，禁止编造或推算新数字。
2. 只使用摘要中提供的信息（含排名趋势与目标院校差距），不得引入外部数据。
3. 结论需可执行：建议必须具体到"做什么、怎么做"，避免"多努力"这类空话。
4. 只输出 JSON：{"overall":"","strengths":[""],"weaknesses":[""],"trend":"","rankTrend":"","targetGap":"","suggestions":[""]}
5. 报告是给学生和家长阅读的中文报告，正文必须全部使用中文。严禁出现英文单词、英文字段名或英文缩写（例如 classDelta、status、gap、myTotal、below、above、null）。摘要中的键名已全部中文化，请如实引用中文键名对应的含义，不要出现任何英文字母。
6. 不得输出 HTML 标签或 Markdown 代码（例如 <div>、<th>、\`\`\`）。
7. 某项数据为"暂无数据"时，用中文说明缺少该项数据，不要照写 null。`;

/**
 * 把英文键的摘要结构转成中文键后再喂给模型。
 * 直接传英文字段名时，模型会在正文里回显 classDelta / status below 这类词语，
 * 中文键可以让报告正文自然保持全中文（配合 ANALYSIS_SYSTEM 的中文约束）。
 */
function toChineseSummary(summary = {}) {
  const s = summary;
  const rank = s.rankTrend ?? {};
  const target = s.target;
  const typeNames = new Map(
    getDb().prepare('SELECT code, name FROM exam_type_dict').all().map((r) => [r.code, r.name]),
  );

  return {
    分析范围: {
      类型: s.scopeType === 'exam' ? '单次考试' : '时间区间',
      起止: s.range?.from || s.range?.to ? `${s.range?.from ?? '不限'} 至 ${s.range?.to ?? '不限'}` : '全部已录入考试',
      考试次数: s.examCount ?? 0,
      连续下滑判定门槛: s.declineThreshold ?? null,
    },
    考试列表: (s.exams ?? []).map((e) => ({
      名称: e.name,
      日期: e.examDate,
      类型: typeNames.get(e.examType) ?? e.examType,
      文化课总分: e.total,
      班级排名: e.classRank,
      班级人数: e.classSize,
      年级排名: e.gradeRank,
      年级人数: e.gradeSize,
    })),
    文化课总分序列: s.totalSeries ?? [],
    计入总分科目: (s.subjects ?? []).map((x) => ({
      科目: x.name,
      满分: x.fullScore,
      各次得分: x.values,
      最近一次得分: x.latest,
      上一次得分: x.prevScore,
      较上一次的增减: x.deltaVsPrev,
      个人平均分: x.avgScore,
      高出或低于平均分的分数: x.deltaVsAvg,
      波动标准差: x.stddev,
      连续下降次数: x.decline,
    })),
    排名趋势: {
      班级排名起始: rank.classStart ?? null,
      班级排名最新: rank.classEnd ?? null,
      班级名次进步数: rank.classDelta ?? null,
      年级排名起始: rank.gradeStart ?? null,
      年级排名最新: rank.gradeEnd ?? null,
      年级名次进步数: rank.gradeDelta ?? null,
    },
    目标院校对比: target
      ? {
          我的中考口径总分: target.basis?.myTotal ?? null,
          总分满分: target.basis?.totalFullScore ?? null,
          录取线口径: target.lineMode === 'latest' ? '最近一年' : '近三年均值',
          从未录入的计入总分科目数: (target.basis?.missingSubjects ?? []).length,
          各校: (target.schools ?? []).map((x) => ({
            院校: x.name,
            采用的录取线: x.lineScore,
            录取线年份: x.lineYears ?? null,
            差距_录取线减我的总分_正数表示仍需提分: x.gap,
            与录取线对比: x.status === 'above' ? '我的总分已超线' : x.status === 'below' ? '我的总分低于录取线' : '录取线数据不足',
            逐年录取线: (x.yearly ?? []).map((y) => `${y.year} 年 ${y.minScore} 分`),
          })),
        }
      : null,
  };
}

/** 调用大模型做学情分析；未配置时抛 3001 */
export async function analyzeWithAi(summary) {
  const cfg = aiConfig();
  if (!cfg.apiKey) throw Err.aiUnavailable('AI 未配置：请在服务端 .env 中设置 AI_API_KEY');
  const { content, model, finishReason } = await callChat(cfg, [
    { role: 'system', content: ANALYSIS_SYSTEM },
    { role: 'user', content: JSON.stringify(toChineseSummary(summary)) },
  ], { temperature: 0.3, maxTokens: cfg.analysisMaxTokens });

  if (!content) {
    throw Err.aiUnavailable(
      `AI 未返回有效内容（finish_reason=${finishReason}）。推理型模型可能耗尽了 token 预算，请调大 AI_MAX_TOKENS_ANALYSIS 或更换模型`,
    );
  }
  const parsed = extractJson(content);
  if (!parsed) throw Err.aiParse('AI 返回内容无法解析为合法 JSON', { raw: content.slice(0, 500) });
  const arr = (v) => (Array.isArray(v) ? v : v ? [String(v)] : []);
  const contentMd = [
    '## 总体判断', parsed.overall ?? '', '',
    '## 优势科目', arr(parsed.strengths).map((s) => `- ${s}`).join('\n'), '',
    '## 薄弱科目', arr(parsed.weaknesses).map((s) => `- ${s}`).join('\n'), '',
    '## 趋势判断', parsed.trend ?? '', '',
    '## 排名趋势', parsed.rankTrend ?? '', '',
    '## 目标差距', parsed.targetGap ?? '', '',
    '## 可执行建议', arr(parsed.suggestions).map((s, i) => `${i + 1}. ${s}`).join('\n'),
  ].join('\n');
  return {
    model,
    parsed: {
      overall: parsed.overall ?? '',
      strengths: arr(parsed.strengths),
      weaknesses: arr(parsed.weaknesses),
      suggestions: arr(parsed.suggestions),
      contentMd,
    },
  };
}

/** 启动自检：不设置密钥时跳过 */
export async function selfCheck() {
  const cfg = aiConfig();
  if (!cfg.apiKey) return { configured: false, ok: null };
  try {
    const r = await callChat(cfg, [
      { role: 'system', content: '只输出 JSON：{"ok":true}' },
      { role: 'user', content: 'ping' },
    ], { temperature: 0, maxTokens: 512 });
    return { configured: true, ok: Boolean(extractJson(r.content)), model: cfg.model };
  } catch (err) {
    return { configured: true, ok: false, error: err.message };
  }
}

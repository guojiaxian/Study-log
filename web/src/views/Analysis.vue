<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '../api/index.js';
import { fmt } from '../utils/format.js';

const loading = ref(true);
const busy = ref(false);
const error = ref('');
const exams = ref([]);
const reports = ref([]);
const report = ref(null);

const form = reactive({
  scopeType: 'range',
  examId: null,
  from: new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10),
  to: new Date().toISOString().slice(0, 10),
});

async function loadHistory() {
  const res = await api.reports({ pageSize: 20 });
  reports.value = res.list;
}

async function open(id) {
  try { report.value = await api.report(id); } catch (e) { error.value = e.message; }
}

onMounted(async () => {
  try {
    const [list] = await Promise.all([api.exams({ pageSize: 50 }), loadHistory()]);
    exams.value = list.list;
    form.examId = exams.value[0]?.examId ?? null;
    if (reports.value.length) await open(reports.value[0].reportId);
  } catch (e) { error.value = e.message; } finally { loading.value = false; }
});

async function generate() {
  error.value = '';
  busy.value = true;
  try {
    const payload = form.scopeType === 'exam'
      ? { scopeType: 'exam', examId: form.examId }
      : { scopeType: 'range', scopeRef: { from: form.from, to: form.to } };
    const res = await api.createReport(payload);
    await loadHistory();
    await open(res.reportId);
  } catch (e) { error.value = e.message; } finally { busy.value = false; }
}

function copyReport() {
  if (!report.value) return;
  navigator.clipboard?.writeText(report.value.contentMd);
}

/** 轻量 Markdown 渲染（标题 / 列表 / 段落） */const blocks = computed(() => {
  const md = report.value?.contentMd ?? '';
  const out = [];
  for (const raw of md.split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    if (line.startsWith('## ')) out.push({ t: 'h', v: line.slice(3) });
    else if (/^[-*]\s+/.test(line)) out.push({ t: 'li', v: line.replace(/^[-*]\s+/, '') });
    else if (/^\d+\.\s+/.test(line)) out.push({ t: 'li', v: line });
    else out.push({ t: 'p', v: line });
  }
  return out;
});
</script>

<template>
  <div>
    <h1>智能学情分析</h1>

    <div class="card">
      <h2>分析范围</h2>
      <div class="row">
        <div class="field" style="flex: 0 0 auto">
          <label>类型</label>
          <select v-model="form.scopeType">
            <option value="range">时间区间</option>
            <option value="exam">单次考试</option>
          </select>
        </div>
        <template v-if="form.scopeType === 'range'">
          <div class="field"><label>起始</label><input v-model="form.from" type="date" /></div>
          <div class="field"><label>结束</label><input v-model="form.to" type="date" /></div>
        </template>
        <div v-else class="field" style="flex: 1 1 240px">
          <label>考试</label>
          <select v-model="form.examId">
            <option v-for="e in exams" :key="e.examId" :value="e.examId">{{ e.examDate }} {{ e.name }}</option>
          </select>
        </div>
        <button class="btn btn-primary" :disabled="busy" @click="generate">{{ busy ? '生成中…' : '生成分析' }}</button>
      </div>
    </div>

    <div v-if="error" class="notice">{{ error }}</div>
    <div v-if="loading" class="loading">加载中…</div>

    <template v-else>
      <div v-if="report" class="card">
        <div class="card-title">
          <h2>报告</h2>
          <span class="small muted">
            {{ report.createdAt }} 生成 · 模型 {{ report.model }}
            <span v-if="report.isFallback" class="tag tag-warn">基础分析（规则生成）</span>
          </span>
        </div>
        <div class="md">
          <template v-for="(b, i) in blocks" :key="i">
            <h2 v-if="b.t === 'h'">{{ b.v }}</h2>
            <p v-else-if="b.t === 'p'">{{ b.v }}</p>
            <li v-else style="list-style: none">{{ b.v }}</li>
          </template>
        </div>
        <div class="row" style="margin-top: 12px">
          <button class="btn btn-sm" @click="copyReport">复制</button>
          <RouterLink class="btn btn-sm" :to="`/targets`">查看目标院校差距</RouterLink>
        </div>
      </div>
      <div v-else class="card empty">还没有分析报告，点击「生成分析」创建。</div>

      <div class="card">
        <h2>历史报告（{{ reports.length }}）</h2>
        <div v-if="!reports.length" class="muted small">暂无</div>
        <div v-for="r in reports" :key="r.reportId" class="report-item">
          <div class="row" style="justify-content: space-between; align-items: center">
            <div>
              <div>
                #{{ r.reportId }} · {{ r.createdAt }} ·
                {{ r.scopeType === 'exam' ? '单次考试' : '时间区间' }} · {{ r.model }}
                <span v-if="r.isFallback" class="tag tag-warn small">规则</span>
              </div>
              <div class="small muted">{{ r.excerpt }}</div>
            </div>
            <div class="row" style="gap: 6px">
              <button class="btn btn-sm" @click="open(r.reportId)">查看</button>
              <button class="btn btn-sm btn-danger" @click="api.deleteReport(r.reportId).then(loadHistory)">删除</button>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

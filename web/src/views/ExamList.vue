<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '../api/index.js';
import { fmt, examTypeName } from '../utils/format.js';

const loading = ref(true);
const error = ref('');
const matrix = ref(null);
const examTypes = ref([]);
const filter = reactive({ type: '', from: '', to: '', page: 1, pageSize: 20 });

async function load() {
  loading.value = true;
  error.value = '';
  try {
    matrix.value = await api.matrix({
      types: filter.type || undefined,
      from: filter.from || undefined,
      to: filter.to || undefined,
      page: filter.page,
      pageSize: filter.pageSize,
    });
  } catch (e) { error.value = e.message; } finally { loading.value = false; }
}

onMounted(async () => {
  try { examTypes.value = (await api.examTypes()).list.filter((t) => !['sport', 'lab'].includes(t.code)); } catch { /* ignore */ }
  await load();
});

const totalPages = computed(() => Math.max(1, Math.ceil((matrix.value?.total ?? 0) / filter.pageSize)));

const cellText = (cell, col) => {
  if (!cell || !cell.entered) return '';
  if (cell.isAbsent) return '缺考';
  if (col.scoreMode === 'grade') return cell.gradeLevel ?? '';
  return fmt(cell.score);
};
</script>

<template>
  <div>
    <div class="card-title">
      <h1>历次考试总览</h1>
      <div class="row" style="gap: 8px">
        <RouterLink to="/entry/manual" class="btn btn-primary btn-sm">+ 新建考试</RouterLink>
        <a class="btn btn-sm" href="/api/v1/export?format=csv">导出 CSV</a>
        <a class="btn btn-sm" href="/api/v1/export?format=json">导出 JSON</a>
      </div>
    </div>

    <div class="card">
      <div class="filters">
        <div class="field">
          <label>类型</label>
          <select v-model="filter.type" @change="filter.page = 1; load()">
            <option value="">全部</option>
            <option v-for="t in examTypes" :key="t.code" :value="t.code">{{ t.name }}</option>
          </select>
        </div>
        <div class="field"><label>起始</label><input v-model="filter.from" type="date" @change="filter.page = 1; load()" /></div>
        <div class="field"><label>结束</label><input v-model="filter.to" type="date" @change="filter.page = 1; load()" /></div>
        <button class="btn btn-sm" @click="filter.type = ''; filter.from = ''; filter.to = ''; filter.page = 1; load()">重置</button>
      </div>

      <div v-if="loading" class="loading">加载中…</div>
      <div v-else-if="error" class="notice">{{ error }}</div>
      <div v-else-if="!matrix.rows.length" class="empty">
        还没有考试记录，<RouterLink to="/entry/manual">先录入第一次成绩 →</RouterLink>
      </div>
      <template v-else>
        <div class="table-wrap">
          <table class="tbl">
            <thead>
              <tr>
                <th class="l sticky-col">日期</th>
                <th class="l">考试名称</th>
                <th class="l">类型</th>
                <th>总分</th>
                <th>班级</th>
                <th>年级</th>
                <th v-for="c in matrix.columns" :key="c.subjectId">{{ c.name }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in matrix.rows" :key="r.examId" style="cursor: pointer" @click="$router.push(`/exams/${r.examId}`)">
                <td class="l sticky-col">{{ r.examDate }}</td>
                <td class="l">{{ r.name }}</td>
                <td class="l muted">{{ examTypeName(r.examType) }}</td>
                <td>{{ fmt(r.totalScore) }}</td>
                <td>{{ r.classRank ? `${r.classRank}/${r.classSize}` : '—' }}</td>
                <td>{{ r.gradeRank ? `${r.gradeRank}/${r.gradeSize}` : '—' }}</td>
                <td v-for="(c, i) in matrix.columns" :key="c.subjectId">{{ cellText(r.cells[i], c) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="pager">
          <span class="small muted">共 {{ matrix.total }} 条 · 第 {{ matrix.page }}/{{ totalPages }} 页</span>
          <button class="btn btn-sm" :disabled="filter.page <= 1" @click="filter.page--; load()">上一页</button>
          <button class="btn btn-sm" :disabled="filter.page >= totalPages" @click="filter.page++; load()">下一页</button>
        </div>
      </template>
    </div>
  </div>
</template>

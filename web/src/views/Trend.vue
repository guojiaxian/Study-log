<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '../api/index.js';
import LineChart from '../components/LineChart.vue';
import { fmt, signed } from '../utils/format.js';

const loading = ref(true);
const error = ref('');
const subjects = ref([]);
const examTypes = ref([]);
const trendData = ref(null);
const rankData = ref(null);
const declaring = ref([]);

const filter = reactive({ type: '', from: '', to: '', codes: [] });

async function load(opts = {}) {
  // silent：切换科目时静默刷新，不切换 loading 状态，
  // 否则内容区会被卸载重建，页面高度骤降导致浏览器自动回到顶部。
  if (!opts.silent) loading.value = true;
  error.value = '';
  try {
    const params = {
      types: filter.type || undefined,
      from: filter.from || undefined,
      to: filter.to || undefined,
      subjectCodes: filter.codes.length ? filter.codes.join(',') : undefined,
    };
    const [t, r] = await Promise.all([api.trend(params), api.rankTrend({ types: params.types, from: params.from, to: params.to })]);
    trendData.value = t;
    rankData.value = r;

    const last = t.points[t.points.length - 1];
    if (last) {
      try { declaring.value = (await api.compare(last.examId)).declining ?? []; } catch { declaring.value = []; }
    } else declaring.value = [];
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  try {
    const [subs, types] = await Promise.all([api.subjects(false), api.examTypes()]);
    subjects.value = subs.list.filter((s) => s.scoreMode === 'score');
    examTypes.value = types.list.filter((t) => !['sport', 'lab'].includes(t.code));
    const dft = ['chinese', 'math', 'english'].filter((c) => subjects.value.some((s) => s.code === c));
    filter.codes = dft.length ? dft : subjects.value.slice(0, 2).map((s) => s.code);
  } catch (e) { error.value = e.message; }
  await load();
});

function toggleCode(code) {
  const i = filter.codes.indexOf(code);
  if (i >= 0) filter.codes.splice(i, 1);
  else filter.codes.push(code);
  load({ silent: true });
}

const totalCats = computed(() => (trendData.value?.points ?? []).map((p) => p.examDate.slice(5)));
const totalSeries = computed(() => [{ name: '总分', data: (trendData.value?.points ?? []).map((p) => p.values.total) }]);
const totalFullScore = computed(() => trendData.value?.series?.[0]?.fullScore ?? 730);

const subjectSeries = computed(() =>
  (trendData.value?.series ?? [])
    .filter((s) => s.key !== 'total')
    .map((s) => ({
      name: s.name,
      data: (trendData.value.points ?? []).map((p) => p.values[s.key]),
      fullScore: s.fullScore,
    })),
);

const rankCats = computed(() => (rankData.value?.points ?? []).map((p) => p.examDate.slice(5)));
const rankSeries = computed(() => [
  { name: '班级排名', data: (rankData.value?.points ?? []).map((p) => p.classRank), axis: 0 },
  { name: '年级排名', data: (rankData.value?.points ?? []).map((p) => p.gradeRank), axis: 1 },
]);
const rankAxes = computed(() => [
  { name: '班级名次（越小越好）', inverse: true },
  { name: '年级名次（越小越好）', inverse: true },
]);
</script>

<template>
  <div>
    <h1>趋势分析</h1>

    <div class="card">
      <div class="filters">
        <div class="field">
          <label>考试类型</label>
          <select v-model="filter.type" @change="load()">
            <option value="">全部</option>
            <option v-for="t in examTypes" :key="t.code" :value="t.code">{{ t.name }}</option>
          </select>
        </div>
        <div class="field"><label>起始</label><input v-model="filter.from" type="date" @change="load()" /></div>
        <div class="field"><label>结束</label><input v-model="filter.to" type="date" @change="load()" /></div>
        <button class="btn btn-sm" @click="filter.from = ''; filter.to = ''; filter.type = ''; load()">重置</button>
      </div>
    </div>

    <div v-if="loading" class="loading">加载中…</div>
    <div v-else-if="error" class="notice">{{ error }}</div>

    <template v-else>
      <div class="card">
        <div class="card-title">
          <h2>总分趋势（原始分）</h2>
          <span class="small muted">满分 {{ fmt(totalFullScore, 0) }}（文化课口径）</span>
        </div>
        <LineChart :categories="totalCats" :series="totalSeries" :y-axes="[{ name: '' }]" empty-text="数据点不足，继续录入后可看到趋势" />
      </div>

      <div class="card">
        <div class="card-title">
          <h2>单科趋势</h2>
          <span class="small muted">缺考处为断点</span>
        </div>
        <div style="margin-bottom: 10px">
          <div class="small muted">选择科目（点击切换，用于单科折线对比）</div>
          <div class="chips" style="margin-top: 6px">
            <span
              v-for="s in subjects"
              :key="s.code"
              class="chip"
              :class="{ active: filter.codes.includes(s.code) }"
              @click="toggleCode(s.code)"
            >{{ s.name }}</span>
          </div>
        </div>
        <LineChart :categories="totalCats" :series="subjectSeries" :y-axes="[{ name: '原始分' }]" empty-text="请选择至少一个科目" />
      </div>

      <div class="card">
        <div class="card-title"><h2>排名趋势</h2><span class="small muted">名次越小越靠上（Y 轴已反向）</span></div>
        <LineChart :categories="rankCats" :series="rankSeries" :y-axes="rankAxes" />
      </div>

      <div class="card">
        <h2>连续下滑预警</h2>
        <div v-if="!declaring.length" class="muted small">未发现连续下滑科目</div>
        <ul v-else style="margin: 0; padding-left: 18px">
          <li v-for="d in declaring" :key="d.subjectId" class="down">
            {{ d.subjectName }}：连续 {{ d.consecutive }} 次下降（{{ d.values.join(' ← ') }}）
          </li>
        </ul>
      </div>
    </template>
  </div>
</template>

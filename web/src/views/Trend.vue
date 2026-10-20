<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '../api/index.js';
import LineChart from '../components/LineChart.vue';
import GradeChips from '../components/GradeChips.vue';
import { fmt } from '../utils/format.js';

const loading = ref(true);
const error = ref('');
const grades = ref([]);
const totalData = ref(null);      // 总分趋势 + 排名（按「总分学段」）
const subjectData = ref(null);    // 单科趋势（按「单科学段」，可为跨学段可比）
const rankData = ref(null);
const declaring = ref([]);

const filter = reactive({ codes: [] });
/** 总分口径与单科口径分开：总分满分两学段不同；单科满分相同的科目可跨学段混合比较。
 *  「全部」= 总分把两学段画进同一张图（参考线取卷面满分最大值）；单科 = 跨学段可比。 */
const gradeTotal = ref('all');
const gradeSubject = ref('');

const GRADE_TOTAL_OPTIONS = [
  { value: '8', label: '初二' },
  { value: '9', label: '初三' },
  { value: 'all', label: '全部' },
];
const GRADE_SUBJECT_OPTIONS = [
  { value: '8', label: '初二' },
  { value: '9', label: '初三' },
  { value: 'comparable', label: '全部' },
];

function gradeLabelOf(v) {
  if (v === 'comparable') return '跨学段可比';
  if (v === 'all') return '全部';
  return GRADE_TOTAL_OPTIONS.find((g) => g.value === String(v))?.label ?? String(v ?? '');
}

async function load(opts = {}) {
  // silent：切换科目/学段时静默刷新，不切换 loading 状态，
  // 否则内容区会被卸载重建，页面高度骤降导致浏览器自动回到顶部。
  if (!opts.silent) loading.value = true;
  error.value = '';
  try {
    const base = {};
    // ① 总分口径：初二 / 初三 / 全部（两学段同图）
    const t = await api.trend({ ...base, grade: gradeTotal.value || undefined });
    totalData.value = t;
    // 首次加载时把后端解析出的学段回填到选择器，避免显示空白
    if (!gradeTotal.value) gradeTotal.value = String(t.grade);

    // ② 单科口径：默认跟随总分学段（全部 → 跨学段可比），也可切换
    const subjectScope = gradeSubject.value || (t.grade === 'all' ? 'comparable' : String(t.grade));
    if (!gradeSubject.value) gradeSubject.value = subjectScope;
    const s = await api.trend({ ...base, grade: subjectScope, subjectCodes: filter.codes.length ? filter.codes.join(',') : undefined });
    subjectData.value = s;

    // ③ 排名趋势跟随总分学段
    rankData.value = await api.rankTrend({ ...base, grade: gradeTotal.value || undefined });

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

/** 切换学段后，把已选科目过滤为新学段内可用的科目，并保证至少选中一科 */
function reselectCodes() {
  const pool = availableSubjects.value.map((s) => s.code);
  filter.codes = filter.codes.filter((c) => pool.includes(c));
  if (!filter.codes.length) {
    const dft = ['chinese', 'math', 'english'].filter((c) => pool.includes(c));
    filter.codes = dft.length ? dft : pool.slice(0, 2);
  }
}

onMounted(async () => {
  try {
    const subs = await api.subjects(false);
    grades.value = subs.grades ?? [];
    const pool = subs.list.filter((s) => s.scoreMode === 'score').map((s) => s.code);
    const dft = ['chinese', 'math', 'english'].filter((c) => pool.includes(c));
    filter.codes = dft.length ? dft : pool.slice(0, 2);
  } catch (e) { error.value = e.message; }
  await load();
});

function toggleCode(code) {
  const i = filter.codes.indexOf(code);
  if (i >= 0) filter.codes.splice(i, 1);
  else filter.codes.push(code);
  load({ silent: true });
}

function onGradeTotalChange(v) { gradeTotal.value = v; reselectCodes(); load({ silent: true }); }
function onGradeSubjectChange(v) { gradeSubject.value = v; reselectCodes(); load({ silent: true }); }

/** 当前单科口径下可选科目（由后端按学段/跨学段可比计算） */
const availableSubjects = computed(() => subjectData.value?.subjects ?? []);

const subjectCats = computed(() => (subjectData.value?.points ?? []).map((p) => p.examDate.slice(5)));
const subjectSeries = computed(() =>
  (subjectData.value?.series ?? [])
    .filter((s) => s.key !== 'total')
    .map((s) => ({
      name: s.name,
      data: (subjectData.value.points ?? []).map((p) => p.values[s.key]),
      fullScore: s.fullScore,
    })),
);

const totalCats = computed(() => (totalData.value?.points ?? []).map((p) => p.examDate.slice(5)));
const totalSeries = computed(() => [{ name: '总分', data: (totalData.value?.points ?? []).map((p) => p.values.total) }]);
const totalFullScore = computed(() => totalData.value?.series?.[0]?.fullScore ?? 0);

const rankCats = computed(() => (rankData.value?.points ?? []).map((p) => p.examDate.slice(5)));
const rankSeries = computed(() => [
  { name: '班级排名', data: (rankData.value?.points ?? []).map((p) => p.classRank), axis: 0 },
  { name: '年级排名', data: (rankData.value?.points ?? []).map((p) => p.gradeRank), axis: 1 },
]);
const rankAxes = computed(() => [
  { name: '班级名次（越小越好）', inverse: true },
  { name: '年级名次（越小越好）', inverse: true },
]);
const hasRank = computed(() => (rankData.value?.points ?? []).some((p) => p.classRank != null || p.gradeRank != null));
</script>

<template>
  <div>
    <h1>趋势分析</h1>

    <div v-if="loading" class="loading">加载中…</div>
    <div v-else-if="error" class="notice">{{ error }}</div>

    <template v-else>
      <div class="card">
        <div class="card-title">
          <h2>总分趋势</h2>
          <div class="row" style="gap: 8px; align-items: center">
            <span class="small muted">满分 {{ fmt(totalFullScore, 0) }}</span>
            <GradeChips :model-value="gradeTotal" :options="GRADE_TOTAL_OPTIONS" @update:model-value="onGradeTotalChange" />
          </div>
        </div>
        <p class="small muted" style="margin-top: -4px">
          初二、初三的科目与满分不同（初二满分 570，初三满分 730）。
          选「全部」时将所有考试画在同一张图中。
        </p>
        <LineChart :categories="totalCats" :series="totalSeries" :y-axes="[{ name: '' }]" empty-text="数据点不足，继续录入后可看到趋势" />
      </div>

      <div class="card">
        <div class="card-title">
          <h2>单科趋势</h2>
          <div class="row" style="gap: 8px; align-items: center">
            <span class="small muted"></span>
            <GradeChips :model-value="gradeSubject" :options="GRADE_SUBJECT_OPTIONS" @update:model-value="onGradeSubjectChange" />
          </div>
        </div>
        <p class="small muted" style="margin-top: -4px">
          选「全部」可把初二和初三满分相同的科目（语数英、物理、道德与法治）一起比较。
        </p>
        <div style="margin-bottom: 10px">
          <div class="small muted">选择科目（点击切换）</div>
          <div class="chips" style="margin-top: 6px">
            <span
              v-for="s in availableSubjects"
              :key="s.code"
              class="chip"
              :class="{ active: filter.codes.includes(s.code) }"
              @click="toggleCode(s.code)"
            >{{ s.name }}<span v-if="gradeSubject === 'comparable'" class="small muted"> · {{ s.fullScore }}</span></span>
          </div>
        </div>
        <LineChart :categories="subjectCats" :series="subjectSeries" :y-axes="[{ name: '原始分' }]" empty-text="请选择至少一个科目" />
      </div>

      <div class="card">
        <div class="card-title">
          <h2>排名趋势（{{ gradeLabelOf(gradeTotal) }}）</h2>
          <span class="small muted">名次越小越靠上（Y 轴已反向）</span>
        </div>
        <LineChart
          v-if="hasRank"
          :categories="rankCats"
          :series="rankSeries"
          :y-axes="rankAxes"
        />
        <div v-else class="notice notice-info small">
          尚未录入班级/年级排名。学校成绩通知里若未提供名次，可在「管理 → 手动录入」中补填，之后这里会显示排名折线。
        </div>
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

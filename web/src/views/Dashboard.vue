<script setup>
import { computed, onMounted, ref } from 'vue';
import { api } from '../api/index.js';
import LineChart from '../components/LineChart.vue';
import GradeChips from '../components/GradeChips.vue';
import { fmt, signed, trendArrow, trendClass, VERDICT } from '../utils/format.js';

const loading = ref(true);
const data = ref(null);
const error = ref('');
/** 学段：8 初二 / 9 初三；空串（全部）= 跟随最近一次考试 */
const grade = ref('');

const GRADE_OPTIONS = [
  { value: '8', label: '初二' },
  { value: '9', label: '初三' },
  { value: '', label: '全部' },
];

const load = async (opts = {}) => {
  if (!opts.silent) loading.value = true;
  error.value = '';
  try {
    data.value = await api.overview({ grade: grade.value || undefined });
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
};
onMounted(load);

function onGradeChange(v) { grade.value = v; load({ silent: true }); }

const latest = computed(() => data.value?.latestExam ?? null);

const trendCategories = computed(() => (data.value?.totalTrend ?? []).map((p) => p.examDate.slice(5)));
const trendSeries = computed(() => [
  { name: '总分', data: (data.value?.totalTrend ?? []).map((p) => p.values.total) },
]);

const targets = computed(() => data.value?.targetGap?.schools ?? []);

const subjectRows = computed(() =>
  (data.value?.subjectOverview ?? []).map((s) => ({
    ...s,
    verdict: s.deltaVsAvg == null ? 'flat' : s.deltaVsAvg > 0.5 ? 'above' : s.deltaVsAvg < -0.5 ? 'below' : 'flat',
  })),
);
</script>

<template>
  <div>
    <div class="card-title">
      <h1>首页<span v-if="data?.gradeLabel" class="small muted" style="font-weight: normal"> · {{ data.gradeLabel }}</span></h1>
      <div class="row" style="gap: 8px; align-items: center">
        <GradeChips :model-value="grade" :options="GRADE_OPTIONS" @update:model-value="onGradeChange" />
        <div class="row desktop-only" style="gap: 8px">
          <RouterLink to="/manage" class="btn btn-primary btn-sm">录入成绩</RouterLink>
        </div>
      </div>
    </div>

    <div v-if="loading" class="loading">加载中…</div>
    <div v-else-if="error" class="notice">{{ error }}</div>

    <template v-else-if="!latest">
      <div class="card empty">
        <p>还没有考试记录，先录入第一次成绩 →</p>
        <RouterLink to="/manage" class="btn btn-primary">开始录入</RouterLink>
      </div>
    </template>

    <template v-else>
      <!-- 桌面端：左 1/3 放两张信息卡，右 2/3 放总分趋势；移动端上下堆叠 -->
      <div class="hero">
        <div class="hero-left">
          <div class="card">
            <div class="stat">
              <span class="label">最近一次考试</span>
              <span class="value" style="font-size: 16px">{{ latest.name }}</span>
              <span class="small muted">{{ latest.examDate }} · {{ latest.gradeLabel }}</span>
            </div>
            <div style="margin-top: 12px" class="stat">
              <span class="label">总分（满分 {{ fmt(latest.enteredFullScore, 0) }}）</span>
              <span class="value">
                {{ fmt(latest.totalScore) }}<small> / {{ fmt(latest.enteredFullScore, 0) }}</small>
              </span>
            </div>
            <div class="small" :class="trendClass(latest.deltaVsPrev)">
              较上次 {{ trendArrow(latest.deltaVsPrev) }} {{ signed(latest.deltaVsPrev) }} 分
            </div>
          </div>

          <div class="card">
            <div class="stat">
              <span class="label">排名</span>
              <span class="value" style="font-size: 18px">
                班级 {{ latest.classRank ?? '—' }}<small>/{{ latest.classSize ?? '—' }}</small>
              </span>
              <span class="value" style="font-size: 18px">
                年级 {{ latest.gradeRank ?? '—' }}<small>/{{ latest.gradeSize ?? '—' }}</small>
              </span>
            </div>
            <RouterLink to="/trend" class="small" style="color: var(--primary)">查看排名趋势 →</RouterLink>
          </div>
        </div>

        <div class="card">
          <div class="stat">
            <span class="label">总分趋势（近 {{ (data?.totalTrend ?? []).length }} 次）</span>
          </div>
          <LineChart
            :categories="trendCategories"
            :series="trendSeries"
            :y-axes="[{ name: '' }]"
            height="220px"
            empty-text="数据点不足"
          />
          <RouterLink to="/trend" class="small" style="color: var(--primary)">查看完整趋势 →</RouterLink>
        </div>
      </div>

      <div class="card">
        <div class="card-title">
          <h2>目标院校差距</h2>
          <RouterLink v-if="data.targetAvailable" to="/targets" class="btn btn-sm">查看详情</RouterLink>
        </div>
        <template v-if="!data.targetAvailable">
          <div class="notice notice-info small">
            当前为<strong>初二</strong>学段，目标院校录取线是中考（初三 730）口径，初二尚未开设化学、也未考体育与实验操作，
            直接对比会让差距虚高，因此切到初三后再查看对比结果。
          </div>
        </template>
        <template v-else>
          <div class="small muted" style="margin-bottom: 8px">
            中考口径总分 {{ fmt(data.targetGap?.basis?.myTotal) }} / {{ fmt(data.targetGap?.basis?.totalFullScore, 0) }}
          </div>
          <div v-if="!targets.length" class="muted small">未配置目标院校</div>
          <div v-else class="grid grid-3">
            <div v-for="t in targets" :key="t.schoolId" class="stat">
              <span class="label">{{ t.name }}</span>
              <span class="value" style="font-size: 18px">{{ fmt(t.lineScore) }}</span>
              <span class="small" :class="t.gap > 0 ? 'down' : 'up'">
                {{ t.gap > 0 ? `需提分 ${fmt(t.gap)} 分` : `已超线 ${fmt(-t.gap)} 分` }}
              </span>
            </div>
          </div>
          <div v-if="data.targetGap?.basis?.missingSubjects?.length" class="notice small" style="margin-top: 10px">
            还有 {{ data.targetGap.basis.missingSubjects.length }} 个计入总分科目（体育、理化生实验操作）尚未录入成绩，
            对比结果偏低；这些科目考完后补录，差距会自动缩小。
          </div>
        </template>
      </div>

      <div class="card">
        <h2>各科概况（本次 vs 上次 vs 均值）</h2>
        <p class="scroll-hint">← 可左右滑动查看全部列 →</p>
        <div class="table-wrap">
          <table class="tbl">
            <thead>
              <tr>
                <th class="l">科目</th><th class="hide-sm">满分</th><th>本次</th><th>较上次</th><th class="hide-sm">历史均值</th><th>vs 均值</th><th>判定</th><th>单科排名</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="s in subjectRows" :key="s.subjectId">
                <td class="l">{{ s.subjectName }}</td>
                <td class="muted hide-sm">{{ fmt(s.fullScore, 0) }}</td>
                <td>{{ s.isAbsent ? '缺考' : fmt(s.latest) }}</td>
                <td :class="trendClass(s.deltaVsPrev)">{{ trendArrow(s.deltaVsPrev) }} {{ signed(s.deltaVsPrev) }}</td>
                <td class="muted hide-sm">{{ fmt(s.avgScore) }}</td>
                <td :class="trendClass(s.deltaVsAvg)">{{ signed(s.deltaVsAvg) }}</td>
                <td :class="VERDICT[s.verdict].cls">{{ VERDICT[s.verdict].text }}</td>
                <td class="muted">{{ s.classRank ?? '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
/* 桌面端：左 1/3 信息卡，右 2/3 趋势图 */
.hero {
  display: grid;
  grid-template-columns: 1fr 2fr;
  gap: 12px;
  align-items: stretch;
}
.hero-left {
  display: grid;
  gap: 12px;
  align-content: start;
}
@media (max-width: 780px) {
  .hero {
    grid-template-columns: 1fr;
  }
}
</style>

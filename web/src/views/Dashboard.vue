<script setup>
import { computed, onMounted, ref } from 'vue';
import { api } from '../api/index.js';
import LineChart from '../components/LineChart.vue';
import { fmt, signed, trendArrow, trendClass, VERDICT } from '../utils/format.js';

const loading = ref(true);
const data = ref(null);
const error = ref('');

const load = async () => {
  loading.value = true;
  error.value = '';
  try {
    data.value = await api.overview();
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
};
onMounted(load);

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
      <h1>首页</h1>
      <div class="row desktop-only" style="gap: 8px">
        <RouterLink to="/manage" class="btn btn-primary btn-sm">录入成绩</RouterLink>
        <RouterLink to="/settings" class="btn btn-sm">设置</RouterLink>
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
      <div class="grid grid-3">
        <div class="card">
          <div class="stat">
            <span class="label">最近一次考试</span>
            <span class="value" style="font-size: 16px">{{ latest.name }}</span>
            <span class="small muted">{{ latest.examDate }}</span>
          </div>
          <div style="margin-top: 12px" class="stat">
            <span class="label">总分（本次口径满分 {{ fmt(latest.enteredFullScore, 0) }}）</span>
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

        <div class="card">
          <div class="stat">
            <span class="label">总分趋势（近 8 次）</span>
          </div>
          <LineChart
            :categories="trendCategories"
            :series="trendSeries"
            :y-axes="[{ name: '' }]"
            height="120px"
            empty-text="数据点不足"
          />
          <RouterLink to="/trend" class="small" style="color: var(--primary)">查看完整趋势 →</RouterLink>
        </div>
      </div>

      <div class="card">
        <div class="card-title">
          <h2>目标院校差距（中考口径总分 {{ fmt(data.targetGap?.basis?.myTotal) }} / 730）</h2>
          <RouterLink to="/targets" class="btn btn-sm">查看详情</RouterLink>
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
          存在未录入的计入总分科目，对比结果偏低
        </div>
      </div>

      <div class="card">
        <h2>各科概况（本次 vs 上次 vs 均值）</h2>
        <div class="table-wrap">
          <table class="tbl">
            <thead>
              <tr>
                <th class="l">科目</th><th>满分</th><th>本次</th><th>较上次</th><th>历史均值</th><th>vs 均值</th><th>判定</th><th>单科排名</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="s in subjectRows" :key="s.subjectId">
                <td class="l">{{ s.subjectName }}</td>
                <td class="muted">{{ fmt(s.fullScore, 0) }}</td>
                <td>{{ s.isAbsent ? '缺考' : fmt(s.latest) }}</td>
                <td :class="trendClass(s.deltaVsPrev)">{{ trendArrow(s.deltaVsPrev) }} {{ signed(s.deltaVsPrev) }}</td>
                <td class="muted">{{ fmt(s.avgScore) }}</td>
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

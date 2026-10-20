<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api/index.js';
import { fmt, signed, trendArrow, trendClass, rankArrow, rankClass, rankText, examTypeName, VERDICT } from '../utils/format.js';

const route = useRoute();
const router = useRouter();
const id = Number(route.params.id);

const loading = ref(true);
const error = ref('');
const exam = ref(null);
const cmp = ref(null);
const busy = ref(false);

async function load() {
  loading.value = true;
  try {
    const [e, c] = await Promise.all([api.exam(id), api.compare(id)]);
    exam.value = e;
    cmp.value = c;
  } catch (e2) { error.value = e2.message; } finally { loading.value = false; }
}
onMounted(load);

const scoreRows = computed(() =>
  (exam.value?.scores ?? []).map((s) => ({
    ...s,
    prev: cmp.value?.vsPrevious?.subjects?.find((x) => x.subjectId === s.subjectId) ?? null,
    avg: cmp.value?.vsAverage?.subjects?.find((x) => x.subjectId === s.subjectId) ?? null,
  })),
);

async function generate() {
  busy.value = true;
  try {
    await api.createReport({ scopeType: 'exam', examId: id });
    router.push('/analysis');
  } catch (e) { error.value = e.message; } finally { busy.value = false; }
}

async function remove() {
  if (!window.confirm('删除本次考试及其全部成绩？此操作不可撤销。')) return;
  busy.value = true;
  try { await api.deleteExam(id); router.push('/exams'); } catch (e) { error.value = e.message; busy.value = false; }
}

/** 返回上一页；无历史（直接打开/刷新）时退回考试总览 */
function goBack() {
  if (window.history.length > 1) router.back();
  else router.push('/exams');
}
</script>

<template>
  <div>
    <div class="card-title">
      <h1>考试详情</h1>
      <div class="row" style="gap: 8px">
        <RouterLink :to="`/entry/manual?examId=${id}`" class="btn btn-primary btn-sm">编辑</RouterLink>
        <button class="btn btn-sm" :disabled="busy" @click="generate">生成学情分析</button>
        <button class="btn btn-sm btn-danger" :disabled="busy" @click="remove">删除</button>
        <a href="javascript:void(0)" class="btn btn-sm" @click="goBack">← 返回</a>
      </div>
    </div>

    <div v-if="loading" class="loading">加载中…</div>
    <div v-else-if="error" class="notice">{{ error }}</div>

    <template v-else-if="exam">
      <div class="card">
        <h2>{{ exam.name }} <span class="tag">{{ exam.gradeLabel }}</span> <span class="tag">{{ examTypeName(exam.examType) }}</span></h2>
        <div class="row" style="gap: 24px">
          <div class="stat">
            <span class="label">总分</span>
            <span class="value">{{ fmt(exam.totalScore) }}<small> / {{ fmt(exam.enteredFullScore, 0) }}</small></span>
            <span class="small" :class="trendClass(cmp?.vsPrevious?.totalDelta)">
              较上次 {{ trendArrow(cmp?.vsPrevious?.totalDelta) }} {{ signed(cmp?.vsPrevious?.totalDelta) }} 分
            </span>
            
          </div>
          <div class="stat">
            <span class="label">班级排名</span>
            <span class="value" style="font-size: 18px">{{ exam.classRank ?? '—' }}<small>/{{ exam.classSize ?? '—' }}</small></span>
            <span class="small" :class="rankClass(cmp?.vsPrevious?.rankDelta?.classRankDelta)">
              {{ rankArrow(cmp?.vsPrevious?.rankDelta?.classRankDelta) }} {{ rankText(cmp?.vsPrevious?.rankDelta?.classRankDelta) }}
            </span>
          </div>
          <div class="stat">
            <span class="label">年级排名</span>
            <span class="value" style="font-size: 18px">{{ exam.gradeRank ?? '—' }}<small>/{{ exam.gradeSize ?? '—' }}</small></span>
            <span class="small" :class="rankClass(cmp?.vsPrevious?.rankDelta?.gradeRankDelta)">
              {{ rankArrow(cmp?.vsPrevious?.rankDelta?.gradeRankDelta) }} {{ rankText(cmp?.vsPrevious?.rankDelta?.gradeRankDelta) }}
            </span>
          </div>
        </div>
      </div>

      <div class="card">
        <h2>与上次对比<span class="small muted" v-if="cmp?.vsPrevious?.previousExamDate">（{{ cmp.vsPrevious.previousExamDate }}）</span></h2>
        <div v-if="!cmp?.vsPrevious?.previousExamDate" class="muted small">这是第一次记录，暂无可对比数据</div>
        <div v-else class="table-wrap">
          <table class="tbl">
            <thead><tr><th class="l">科目</th><th>本次</th><th>上次</th><th>Δ 得分</th><th>趋势</th></tr></thead>
            <tbody>
              <tr v-for="r in cmp.vsPrevious.subjects" :key="r.subjectId">
                <td class="l">{{ r.subjectName }}</td>
                <td>{{ fmt(r.score) }}</td>
                <td class="muted">{{ fmt(r.prevScore) }}</td>
                <td :class="trendClass(r.scoreDelta)">{{ trendArrow(r.scoreDelta) }} {{ signed(r.scoreDelta) }}</td>
                <td :class="trendClass(r.scoreDelta)">{{ r.trend === 'up' ? '进步' : r.trend === 'down' ? '退步' : '持平' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <h2>与历史均值对比<span class="small muted">（窗口：近 {{ cmp?.vsAverage?.window }} 次，实际样本 {{ cmp?.vsAverage?.sampleCount }}）</span></h2>
        <div class="table-wrap">
          <table class="tbl">
            <thead><tr><th class="l">科目</th><th>本次</th><th>历史均值</th><th>差值</th><th>判定</th></tr></thead>
            <tbody>
              <tr v-for="r in cmp.vsAverage.subjects" :key="r.subjectId">
                <td class="l">{{ r.subjectName }}</td>
                <td>{{ fmt(r.score) }}</td>
                <td class="muted">{{ fmt(r.avgScore) }}</td>
                <td :class="trendClass(r.scoreDelta)">{{ signed(r.scoreDelta) }}</td>
                <td :class="VERDICT[r.verdict].cls">{{ VERDICT[r.verdict].text }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <h2>各科明细</h2>
        <p class="scroll-hint">← 可左右滑动查看全部列 →</p>
        <div class="table-wrap">
          <table class="tbl">
            <thead><tr><th class="l">科目</th><th>得分</th><th class="hide-sm">满分</th><th>单科班级排名</th><th>等级</th><th class="hide-sm">缺考</th></tr></thead>
            <tbody>
              <tr v-for="s in scoreRows" :key="s.subjectId">
                <td class="l">{{ s.subjectName }}</td>
                <td>{{ s.isAbsent ? '—' : fmt(s.score) }}</td>
                <td class="muted hide-sm">{{ s.scoreMode === 'grade' ? '等级制' : fmt(s.fullScore, 0) }}</td>
                <td class="muted">{{ s.classRank ?? '—' }}</td>
                <td>{{ s.gradeLevel ?? '—' }}</td>
                <td class="hide-sm">{{ s.isAbsent ? '是' : '' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

    </template>
  </div>
</template>

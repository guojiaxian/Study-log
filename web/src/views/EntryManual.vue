<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api/index.js';
import GradeChips from '../components/GradeChips.vue';
import { fmt } from '../utils/format.js';

const route = useRoute();
const router = useRouter();

const loading = ref(true);
const saving = ref(false);
const error = ref('');
const subjects = ref([]);
const examTypes = ref([]);
const showGrade = ref(false);

const editId = computed(() => (route.query.examId ? Number(route.query.examId) : null));

const meta = reactive({
  name: '',
  examDate: new Date().toISOString().slice(0, 10),
  examType: 'month',
  grade: 9,
  term: '2026-2027-1',
  status: 'confirmed',
  remark: '',
  classRank: null,
  gradeRank: null,
});

const rows = reactive({}); // subjectId -> { score, absent, level, classRank, gradeRank }

function initRows(list, existing = []) {
  for (const s of list) {
    const e = existing.find((x) => x.subjectId === s.id);
    rows[s.id] = {
      score: e && !e.isAbsent ? e.score : null,
      absent: e ? !!e.isAbsent : false,
      level: e?.gradeLevel ?? null,
      classRank: e?.classRank ?? null,
      gradeRank: e?.gradeRank ?? null,
    };
  }
}

const scoreSubjects = computed(() => subjects.value.filter((s) => s.scoreMode === 'score'));
const gradeSubjects = computed(() => subjects.value.filter((s) => s.scoreMode === 'grade'));
const gradeLabel = computed(() => (Number(meta.grade) === 8 ? '初二' : '初三'));
const GRADE_OPTIONS = [
  { value: 8, label: '初二' },
  { value: 9, label: '初三' },
];

const enteredCount = computed(
  () => scoreSubjects.value.filter((s) => rows[s.id]?.absent || rows[s.id]?.score != null).length,
);

const totalPreview = computed(() =>
  scoreSubjects.value.reduce((a, s) => {
    const r = rows[s.id];
    if (!r || r.absent || r.score == null || !s.countsToTotal) return a;
    return a + Number(r.score || 0);
  }, 0),
);

const cultureFull = computed(() =>
  scoreSubjects.value.filter((s) => s.countsToTotal).reduce((a, s) => a + s.fullScore, 0),
);

function rowInvalid(s) {
  const r = rows[s.id];
  if (!r || r.absent || r.score == null || r.score === '') return false;
  const v = Number(r.score);
  return Number.isNaN(v) || v < 0 || v > s.fullScore;
}

let existingScores = [];

/** 按学段拉取科目字典：初二与初三的科目集合、科目满分不同 */
async function loadSubjects(grade) {
  const subs = await api.subjects(false, grade);
  subjects.value = subs.list;
  meta.grade = Number(grade);
  // 丢掉上一学段独有的科目行（如初三的化学），避免跨学段残留
  const keep = new Set(subs.list.map((s) => s.id));
  for (const k of Object.keys(rows)) if (!keep.has(Number(k))) delete rows[k];
  initRows(subs.list, existingScores);
}

/** 切换学段：换成本学段的科目字典并清空已录值（两学段是各自独立的考试口径） */
function onGradePick(v) {
  if (Number(v) === Number(meta.grade)) return;
  onGradeChange(Number(v));
}

async function onGradeChange(grade) {
  error.value = '';
  try {
    existingScores = [];
    showGrade.value = false;
    await loadSubjects(grade);
  } catch (e) {
    error.value = e.message;
  }
}

onMounted(async () => {
  try {
    const types = await api.examTypes();
    examTypes.value = types.list;

    if (editId.value) {
      const ex = await api.exam(editId.value);
      Object.assign(meta, {
        name: ex.name, examDate: ex.examDate, examType: ex.examType, grade: ex.grade,
        term: ex.term ?? '', status: ex.status, remark: ex.remark ?? '',
        classRank: ex.classRank, gradeRank: ex.gradeRank,
      });
      existingScores = ex.scores;
      if (existingScores.some((s) => s.scoreMode === 'grade')) showGrade.value = true;
    }
    await loadSubjects(meta.grade);
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
});

/** 返回上一页；无历史（直接打开/刷新）时退回管理页 */
function goBack() {
  if (window.history.length > 1) router.back();
  else router.push('/manage');
}

async function submit() {
  error.value = '';
  if (!meta.name.trim()) { error.value = '请填写考试名称'; return; }
  if (!meta.examDate) { error.value = '请选择考试日期'; return; }

  const scores = [];
  for (const s of subjects.value) {
    const r = rows[s.id];
    if (!r) continue;
    if (s.scoreMode === 'grade') {
      if (r.level) scores.push({ subjectId: s.id, gradeLevel: r.level, isAbsent: false });
      continue;
    }
    if (r.absent) { scores.push({ subjectId: s.id, isAbsent: true }); continue; }
    if (r.score == null || r.score === '') continue;
    if (rowInvalid(s)) { error.value = `${s.name} 得分必须在 0 ~ ${s.fullScore} 之间`; return; }
    scores.push({ subjectId: s.id, score: Number(r.score), isAbsent: false, classRank: r.classRank || null });
  }
  if (!scores.length) { error.value = '至少录入一科成绩'; return; }

  const payload = {
    name: meta.name.trim(), examType: meta.examType, examDate: meta.examDate,
    grade: Number(meta.grade), term: meta.term || null, status: meta.status, remark: meta.remark || null,
    classRank: meta.classRank || null, gradeRank: meta.gradeRank || null,
  };

  saving.value = true;
  try {
    if (editId.value) {
      await api.updateExam(editId.value, { ...payload, scores });
      router.push(`/exams/${editId.value}`);
    } else {
      const res = await api.createExam({ ...payload, scores });
      router.push(`/exams/${res.examId}`);
    }
  } catch (e) {
    error.value = e.message;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div>
    <div class="card-title">
      <h1>{{ editId ? '编辑成绩' : '手动录入' }}</h1>
      <div class="row" style="gap: 8px">
        <button class="btn btn-primary btn-sm" :disabled="saving" @click="submit">
          {{ saving ? '保存中…' : '保存' }}
        </button>
        <a href="javascript:void(0)" class="btn btn-sm" @click="goBack">← 返回</a>
      </div>
    </div>

    <div v-if="loading" class="loading">加载中…</div>
    <template v-else>
      <div v-if="error" class="notice">{{ error }}</div>

      <div class="card">
        <h2>考试信息</h2>
        <div class="row">
          <div class="field" style="flex: 2 1 220px">
            <label>考试名称</label>
            <input v-model="meta.name" placeholder="如：初三上第一次月考" />
          </div>
          <div class="field"><label>考试日期</label><input v-model="meta.examDate" type="date" /></div>
          <div class="field">
            <label>类型</label>
            <select v-model="meta.examType">
              <option v-for="t in examTypes" :key="t.code" :value="t.code">{{ t.name }}</option>
            </select>
          </div>
          <div class="field">
            <label>学段</label>
            <GradeChips :model-value="meta.grade" :options="GRADE_OPTIONS" @update:model-value="onGradePick" />
          </div>
          <div class="field"><label>学期</label><input v-model="meta.term" placeholder="2026-2027-1" /></div>
          <div class="field">
            <label>状态</label>
            <select v-model="meta.status"><option value="confirmed">直接确认</option><option value="draft">草稿</option></select>
          </div>
        </div>
        <div class="field"><label>备注</label><input v-model="meta.remark" placeholder="可选" /></div>
      </div>

      <div class="card">
        <div class="card-title">
          <h2>排名信息（成绩单上的排名，可留空）</h2>
          <span class="small muted">班级/年级人数在「管理 → 排名人数设置」中统一维护</span>
        </div>
        <div class="row">
          <div class="field"><label>班级排名</label><input v-model.number="meta.classRank" type="text" inputmode="numeric" autocomplete="off" /></div>
          <div class="field"><label>年级排名</label><input v-model.number="meta.gradeRank" type="text" inputmode="numeric" autocomplete="off" /></div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">
          <h2>成绩明细</h2>
          <span class="small muted">已录 {{ enteredCount }}/{{ scoreSubjects.length }} 科</span>
        </div>
        <div class="table-wrap">
          <table class="tbl">
            <thead>
              <tr><th class="l">科目</th><th>{{ gradeLabel }}满分</th><th>得分</th><th>单科班级排名</th><th>缺考</th></tr>
            </thead>
            <tbody>
              <tr v-for="s in scoreSubjects" :key="s.id">
                <td class="l">
                  {{ s.name }}
                  <span v-if="!s.countsToTotal" class="tag small">不计入总分</span>
                </td>
                <td class="muted">{{ s.fullScore }}</td>
                <td>
                  <input
                    v-model.number="rows[s.id].score"
                    type="text" inputmode="decimal" autocomplete="off"
                    :class="{ invalid: rowInvalid(s) }"
                    :disabled="rows[s.id].absent"
                    style="width: 96px"
                  />
                </td>
                <td><input v-model.number="rows[s.id].classRank" type="text" inputmode="numeric" autocomplete="off" style="width: 80px" placeholder="—" /></td>
                <td style="text-align: center"><input v-model="rows[s.id].absent" type="checkbox" style="width: auto" /></td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="row" style="margin-top: 12px; align-items: center">
          <strong>计入总分科目合计：{{ fmt(totalPreview) }} / {{ cultureFull }}</strong>
          <span class="small muted">（本次已录科目合计；{{ gradeLabel }}计入总分满分 {{ cultureFull }}）</span>
        </div>

        <div v-if="gradeSubjects.length" style="margin-top: 10px">
          <button class="btn btn-sm" @click="showGrade = !showGrade">
            {{ showGrade ? '▾' : '▸' }} 不参与总分科目（{{ gradeSubjects.length }}）{{ gradeSubjects.map((s) => s.name).join('、') }}
          </button>
          <div v-if="showGrade" class="table-wrap" style="margin-top: 10px">
            <table class="tbl">
              <thead><tr><th class="l">科目</th><th>等级</th></tr></thead>
              <tbody>
                <tr v-for="s in gradeSubjects" :key="s.id">
                  <td class="l">{{ s.name }}</td>
                  <td>
                    <select v-model="rows[s.id].level" style="width: 90px">
                      <option :value="null">—</option>
                      <option>A</option><option>B</option><option>C</option><option>D</option>
                    </select>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

    </template>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api/index.js';
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
  classSize: null,
  gradeRank: null,
  gradeSize: null,
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

onMounted(async () => {
  try {
    const [subs, types] = await Promise.all([api.subjects(false), api.examTypes()]);
    subjects.value = subs.list;
    examTypes.value = types.list;

    let existing = [];
    if (editId.value) {
      const ex = await api.exam(editId.value);
      Object.assign(meta, {
        name: ex.name, examDate: ex.examDate, examType: ex.examType, grade: ex.grade,
        term: ex.term ?? '', status: ex.status, remark: ex.remark ?? '',
        classRank: ex.classRank, classSize: ex.classSize, gradeRank: ex.gradeRank, gradeSize: ex.gradeSize,
      });
      existing = ex.scores;
      if (existing.some((s) => s.scoreMode === 'grade')) showGrade.value = true;
    }
    initRows(subjects.value, existing);
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
});

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
    classRank: meta.classRank || null, classSize: meta.classSize || null,
    gradeRank: meta.gradeRank || null, gradeSize: meta.gradeSize || null,
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
      <RouterLink to="/manage" class="btn btn-sm">← 返回</RouterLink>
    </div>

    <div v-if="loading" class="loading">加载中…</div>
    <template v-else>
      <div v-if="error" class="notice">{{ error }}</div>

      <div class="notice notice-info small">
        满分固定为中考口径（各科满分见下表，总分满分 730）。若校内按 100 分卷出题，请先按中考口径折算后再录入。
      </div>

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
            <label>年级</label>
            <select v-model="meta.grade"><option :value="9">初三</option><option :value="8">初二</option><option :value="7">初一</option></select>
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
        <h2>排名信息（成绩单上的排名，可留空）</h2>
        <div class="row">
          <div class="field"><label>班级人数</label><input v-model.number="meta.classSize" type="text" inputmode="numeric" autocomplete="off" /></div>
          <div class="field"><label>班级排名</label><input v-model.number="meta.classRank" type="text" inputmode="numeric" autocomplete="off" /></div>
          <div class="field"><label>年级人数</label><input v-model.number="meta.gradeSize" type="text" inputmode="numeric" autocomplete="off" /></div>
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
              <tr><th class="l">科目</th><th>中考满分</th><th>得分</th><th>单科班级排名</th><th>缺考</th></tr>
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
          <span class="small muted">（本次已录文化课口径；全科中考口径满分 730）</span>
        </div>

        <div style="margin-top: 10px">
          <button class="btn btn-sm" @click="showGrade = !showGrade">
            {{ showGrade ? '▾' : '▸' }} 不参与总分科目（{{ gradeSubjects.length }}）生物、地理
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

      <div class="row" style="justify-content: flex-end">
        <RouterLink to="/manage" class="btn">取消</RouterLink>
        <button class="btn btn-primary" :disabled="saving" @click="submit">
          {{ saving ? '保存中…' : '保存' }}
        </button>
      </div>
    </template>
  </div>
</template>

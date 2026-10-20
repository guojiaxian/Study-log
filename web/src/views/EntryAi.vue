<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api/index.js';
import GradeChips from '../components/GradeChips.vue';
import { fmt } from '../utils/format.js';

const router = useRouter();

const step = ref(1);
const loading = ref(false);
const error = ref('');
const subjects = ref([]);
const examTypes = ref([]);
/** 学段决定科目集合与各科满分（初二/初三不同），解析与入库都要用它 */
const grade = ref(9);
const GRADE_OPTIONS = [
  { value: 8, label: '初二' },
  { value: 9, label: '初三' },
];
const gradeLabel = computed(() => (Number(grade.value) === 8 ? '初二' : '初三'));
const taskId = ref(null);
const model = ref('');
const durationMs = ref(0);
const warnings = ref([]);
const items = ref([]);
const subjectsById = computed(() => new Map(subjects.value.map((s) => [s.id, s])));

const form = reactive({
  rawText: '',
  examName: '',
  examDate: new Date().toISOString().slice(0, 10),
  examType: 'month',
  classRank: null, gradeRank: null,
});

/** 点击学段 chips：与下拉 change 等价，重新按学段拉科目 */
function onGradePick(v) {
  if (Number(v) === Number(grade.value)) return;
  grade.value = Number(v);
  onGradeChange();
}

/** 按学段拉取科目字典，保证下拉选项与满分口径一致 */
async function loadSubjects() {
  const subs = await api.subjects(false, grade.value);
  subjects.value = subs.list;
}

async function onGradeChange() {
  error.value = '';
  try { await loadSubjects(); } catch (e) { error.value = e.message; }
}

onMounted(async () => {
  try {
    const types = await api.examTypes();
    examTypes.value = types.list;
    await loadSubjects();
  } catch (e) { error.value = e.message; }
});

const needConfirm = computed(() => items.value.filter((i) => i.matchType !== 'exact').length);

async function parse() {
  error.value = '';
  if (!form.rawText.trim()) { error.value = '请先粘贴成绩单文本'; return; }
  loading.value = true;
  try {
    const res = await api.parseScore({
      rawText: form.rawText.trim(),
      examName: form.examName || undefined,
      examDate: form.examDate,
      examType: form.examType,
      grade: Number(grade.value),
    });
    taskId.value = res.taskId;
    model.value = res.model;
    durationMs.value = res.durationMs;
    warnings.value = res.warnings ?? [];
    items.value = (res.items ?? []).map((i) => ({ ...i, include: i.matchType !== 'unmatched' }));
    if (res.exam?.name) form.examName = res.exam.name;
    if (res.exam?.examDate) form.examDate = res.exam.examDate;
    if (res.exam?.examType) form.examType = res.exam.examType;
    if ([8, 9].includes(Number(res.exam?.grade)) && Number(res.exam.grade) !== Number(grade.value)) {
      grade.value = Number(res.exam.grade);
      await loadSubjects();
    }
    if (res.ranks) {
      form.classRank = res.ranks.classRank;
      form.gradeRank = res.ranks.gradeRank;
    }
    step.value = 2;
  } catch (e) {
    error.value = `${e.message}（可改为手动录入）`;
  } finally {
    loading.value = false;
  }
}

function addRow() {
  items.value.push({ rawSubject: '', subjectId: null, subjectName: '', matchType: 'unmatched', score: null, gradeLevel: null, fullScore: null, include: true });
}

function onSubjectChange(row) {
  const s = subjectsById.value.get(row.subjectId);
  row.subjectName = s?.name ?? '';
  row.fullScore = s && s.scoreMode === 'score' ? s.fullScore : null;
  if (s && s.scoreMode === 'grade') { row.score = null; row.matchType = 'exact'; }
}

const payloadScores = computed(() =>
  items.value
    .filter((r) => r.include && r.subjectId)
    .map((r) => {
      const s = subjectsById.value.get(r.subjectId);
      if (s?.scoreMode === 'grade') return { subjectId: r.subjectId, gradeLevel: r.gradeLevel, isAbsent: false };
      return { subjectId: r.subjectId, score: r.score == null ? null : Number(r.score), isAbsent: false };
    })
    .filter((r) => r.gradeLevel || r.score != null),
);

async function commit() {
  error.value = '';
  if (!form.examName.trim()) { error.value = '请填写考试名称'; return; }
  if (!payloadScores.value.length) { error.value = '没有可入库的成绩行'; return; }
  loading.value = true;
  try {
    const res = await api.commitParse({
      taskId: taskId.value,
      exam: {
        name: form.examName.trim(), examDate: form.examDate, examType: form.examType, grade: Number(grade.value), status: 'confirmed',
        classRank: form.classRank || null,
        gradeRank: form.gradeRank || null,
      },
      scores: payloadScores.value,
    });
    router.push(`/exams/${res.examId}`);
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}
/** 返回上一页；无历史（直接打开/刷新）时退回管理页 */
function goBack() {
  if (window.history.length > 1) router.back();
  else router.push('/manage');
}
</script>

<template>
  <div>
    <div class="card-title">
      <h1>智能批量录入</h1>
      <a href="javascript:void(0)" class="btn btn-sm" @click="goBack">← 返回</a>
    </div>

    <div class="steps">
      <div class="step" :class="{ active: step === 1 }">① 粘贴文本</div>
      <div class="step" :class="{ active: step === 2 }">② 校对结果</div>
      <div class="step" :class="{ active: step === 3 }">③ 确认入库</div>
    </div>

    <div v-if="error" class="notice">{{ error }}</div>

    <div v-if="step === 1" class="card">
      <h2>粘贴成绩单文本</h2>
      <textarea
        v-model="form.rawText"
        placeholder="粘贴老师发的成绩单文本，例如：&#10;初三(3)班第一次月考成绩&#10;语文 98  数学 104  英语 96  物理 58  化学 38&#10;道法 62  历史 43  生物 A  地理 B&#10;班级排名 8/50  年级排名 63/800"
      />
      <div class="row" style="margin-top: 10px">
        <div class="field"><label>考试名称</label><input v-model="form.examName" placeholder="可留空，由 AI 推断" /></div>
        <div class="field"><label>考试日期</label><input v-model="form.examDate" type="date" /></div>
        <div class="field">
          <label>类型</label>
          <select v-model="form.examType">
            <option v-for="t in examTypes" :key="t.code" :value="t.code">{{ t.name }}</option>
          </select>
        </div>
        <div class="field">
          <label>学段</label>
          <GradeChips :model-value="grade" :options="GRADE_OPTIONS" @update:model-value="onGradePick" />
        </div>
      </div>
      <div class="row" style="justify-content: flex-end">
        <button class="btn btn-primary" :disabled="loading" @click="parse">{{ loading ? '解析中…' : '开始解析' }}</button>
      </div>
    </div>

    <div v-else class="card">
      <div class="card-title">
        <h2>校对结果</h2>
        <span class="small muted">模型 {{ model }} · 耗时 {{ fmt(durationMs / 1000) }}s · 识别 {{ items.length }} 项</span>
      </div>
      <div v-if="needConfirm" class="notice">⚠ {{ needConfirm }} 项需要确认，请核对后入库</div>

      <div class="table-wrap">
        <table class="tbl">
          <thead>
            <tr><th class="l">原始科目</th><th class="l">系统科目</th><th>得分 / 等级</th><th>{{ gradeLabel }}满分</th><th>入库</th><th></th></tr>
          </thead>
          <tbody>
            <tr v-for="(r, i) in items" :key="i">
              <td class="l">{{ r.rawSubject || '—' }}</td>
              <td class="l">
                <select v-model="r.subjectId" style="width: 130px" @change="onSubjectChange(r)">
                  <option :value="null">未匹配</option>
                  <option v-for="s in subjects" :key="s.id" :value="s.id">{{ s.name }}</option>
                </select>
                <span v-if="r.matchType === 'alias'" class="tag tag-warn small">别名匹配</span>
                <span v-else-if="r.matchType === 'fuzzy'" class="tag tag-warn small">模糊匹配</span>
                <span v-else-if="r.matchType === 'unmatched'" class="tag tag-down small">未匹配</span>
              </td>
              <td>
                <select v-if="subjectsById.get(r.subjectId)?.scoreMode === 'grade'" v-model="r.gradeLevel" style="width: 80px">
                  <option :value="null">—</option><option>A</option><option>B</option><option>C</option><option>D</option>
                </select>
                <input v-else v-model.number="r.score" type="text" inputmode="decimal" autocomplete="off" style="width: 92px" />
              </td>
              <td class="muted">{{ r.fullScore ?? '—' }}</td>
              <td style="text-align: center"><input v-model="r.include" type="checkbox" style="width: auto" /></td>
              <td><button class="btn btn-sm btn-danger" @click="items.splice(i, 1)">删除</button></td>
            </tr>
          </tbody>
        </table>
      </div>

      <button class="btn btn-sm" style="margin-top: 8px" @click="addRow">+ 手动添加一行</button>

      <div class="row" style="margin-top: 12px">
        <div class="field"><label>考试名称</label><input v-model="form.examName" /></div>
        <div class="field"><label>考试日期</label><input v-model="form.examDate" type="date" /></div>
        <div class="field"><label>班级排名</label><input v-model.number="form.classRank" type="number" /></div>
        <div class="field"><label>年级排名</label><input v-model.number="form.gradeRank" type="number" /></div>
      </div>
      <p class="small muted">班级/年级人数在「管理 → 排名人数设置」中统一维护，录入时自动带入。</p>

      <div v-if="warnings.length" class="notice small">
        <div v-for="(w, i) in warnings" :key="i">· {{ w.message }}</div>
      </div>

      <p class="small muted">提示：未匹配到的科目不会被写入，请核对后再确认。（共 {{ payloadScores.length }} 行可入库）</p>

      <div class="row" style="justify-content: flex-end">
        <button class="btn" @click="step = 1">上一步</button>
        <button class="btn btn-primary" :disabled="loading" @click="commit">{{ loading ? '入库中…' : '确认并入库' }}</button>
      </div>
    </div>
  </div>
</template>

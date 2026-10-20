<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '../api/index.js';
import GradeChips from '../components/GradeChips.vue';
import { fmt } from '../utils/format.js';

const loading = ref(true);
const error = ref('');
const okMsg = ref('');
const saving = ref(false);
const subjects = ref([]);
const examTypes = ref([]);
const schools = ref([]);
/** 排名人数：全局统一维护，录入成绩时自动带入；允许为空 */
const rankSizes = reactive({ classSize: null, gradeSize: null });
/** 科目字典按学段维护：初二与初三的科目集合、科目满分都不同 */
const subjectGrade = ref('9');
const GRADE_OPTIONS = [
  { value: '8', label: '初二', fullScore: 570 },
  { value: '9', label: '初三', fullScore: 730 },
];

/** 载入时的基准快照：保存按钮通过「当前值 vs 快照」判断有哪些修改 */
const base = reactive({ rank: null, subjects: {}, types: {}, lines: {}, adm: {} });

function snapshotRank() { base.rank = JSON.stringify([rankSizes.classSize, rankSizes.gradeSize]); }
function snapshotAll() {
  snapshotRank();
  base.subjects = {};
  for (const s of subjects.value) base.subjects[`${s.grade}:${s.id}`] = JSON.stringify(subjectPatch(s));
  base.types = {};
  for (const t of examTypes.value) base.types[t.id] = t.name;
  base.lines = {};
  base.adm = {};
  for (const sch of schools.value) {
    base.lines[sch.schoolId] = JSON.stringify([sch.lineMode, sch.customLine]);
    for (const a of sch.admissionScores) base.adm[a.id] = JSON.stringify([a.year, a.minScore]);
  }
}

function flash(msg) { okMsg.value = msg; setTimeout(() => { okMsg.value = ''; }, 2500); }

async function load(opts = {}) {
  loading.value = true;
  try {
    const [subs, types, sch, cfg] = await Promise.all([
      api.subjects(true, subjectGrade.value), api.examTypes(true), api.schools(), api.config(),
    ]);
    subjects.value = subs.list;
    examTypes.value = types.list;
    schools.value = sch.list;
    rankSizes.classSize = cfg.rank?.classSize ?? null;
    rankSizes.gradeSize = cfg.rank?.gradeSize ?? null;
    snapshotAll();
  } catch (e) { error.value = e.message; } finally { loading.value = false; }
}
onMounted(load);

/** 切换学段：重新拉该学段的科目，避免复用上一学段的行 */
async function onSubjectGradeChange() {
  try {
    const subs = await api.subjects(true, subjectGrade.value);
    subjects.value = subs.list;
    snapshotAll();
  } catch (e) { error.value = e.message; }
}

function subjectPatch(s) {
  return [s.name, Number(s.fullScore), s.scoreMode, s.countsToTotal ? 1 : 0, s.isActive ? 1 : 0];
}
function rankDirty() {
  return base.rank != null && JSON.stringify([rankSizes.classSize, rankSizes.gradeSize]) !== base.rank;
}
const dirtyItems = computed(() => {
  const list = [];
  if (rankDirty()) list.push({ kind: 'rank' });
  for (const s of subjects.value) {
    const snap = base.subjects[`${s.grade}:${s.id}`];
    if (snap != null && JSON.stringify(subjectPatch(s)) !== snap) list.push({ kind: 'subject', item: s });
  }
  for (const t of examTypes.value) {
    if (base.types[t.id] != null && t.name !== base.types[t.id]) list.push({ kind: 'type', item: t });
  }
  for (const sch of schools.value) {
    const ls = base.lines[sch.schoolId];
    if (ls != null && JSON.stringify([sch.lineMode, sch.customLine]) !== ls) list.push({ kind: 'line', item: sch });
    for (const a of sch.admissionScores) {
      const as = base.adm[a.id];
      if (as != null && JSON.stringify([a.year, a.minScore]) !== as) list.push({ kind: 'adm', item: a });
    }
  }
  return list;
});

/** 页面唯一保存入口：把所有修改一次性提交 */
async function saveAll() {
  const items = dirtyItems.value;
  if (!items.length) return;
  saving.value = true;
  let ok = 0;
  try {
    for (const { kind, item } of items) {
      if (kind === 'rank') {
        const toNum = (v) => (v == null || v === '' ? null : Number(v));
        await api.patchConfig({ rank: { classSize: toNum(rankSizes.classSize), gradeSize: toNum(rankSizes.gradeSize) } });
      } else if (kind === 'subject') {
        await api.updateSubject(item.id, {
          grade: Number(item.grade), name: item.name, fullScore: item.fullScore, scoreMode: item.scoreMode,
          countsToTotal: item.countsToTotal, sortOrder: item.sortOrder, isActive: item.isActive,
        });
      } else if (kind === 'type') {
        await api.updateExamType(item.id, { name: item.name, sortOrder: item.sortOrder, isActive: item.isActive });
      } else if (kind === 'line') {
        await api.updateSchool(item.schoolId, { lineMode: item.lineMode, customLine: item.customLine });
      } else if (kind === 'adm') {
        await api.updateAdmission(item.schoolId, item.id, {
          year: item.year, minScore: item.minScore, totalFullScore: item.totalFullScore, admissionType: item.admissionType,
        });
      }
      ok += 1;
    }
    snapshotAll();
    flash(`已保存 ${ok} 项修改`);
  } catch (e) {
    error.value = `${e.message}（已保存前 ${ok} 项，请修正后重试）`;
  } finally { saving.value = false; }
}

/** 新增科目：code 自动生成 customN（中文名称无法作为标识） */
async function addSubject() {
  const grade = Number(subjectGrade.value);
  const name = window.prompt(`新增${grade === 8 ? '初二' : '初三'}科目的名称（如 生物）`);
  if (!name) return;
  const fullScore = Number(window.prompt('该科目满分（数字，如 100）', '100'));
  if (!fullScore) return;
  const countsToTotal = window.confirm('该科目是否计入总分？\n确定 = 计入总分，取消 = 不计入总分');
  try {
    const used = new Set(subjects.value.map((s) => s.code));
    let n = 1;
    while (used.has(`custom${n}`)) n += 1;
    await api.createSubject({
      code: `custom${n}`, name, grade, fullScore, countsToTotal: countsToTotal ? 1 : 0,
      sortOrder: (subjects.value.length + 1) * 10,
    });
    await onSubjectGradeChange();
    flash(`已新增科目「${name}」`);
  } catch (e) { error.value = e.message; }
}

async function delSubject(s) {
  if (!window.confirm(`删除${s.gradeLabel}科目「${s.name}」？若该学段已有成绩引用，将转为停用而非删除。`)) return;
  try {
    const r = await api.deleteSubject(s.id, s.grade);
    await onSubjectGradeChange();
    flash(r.disabled ? `该科目已被 ${r.referenced} 条成绩引用，已转为停用` : '已删除科目');
  } catch (e) { error.value = e.message; }
}

async function delExamType(t) {
  if (!window.confirm(`删除类型「${t.name}」？若已被考试使用则无法删除。`)) return;
  try {
    await api.deleteExamType(t.id);
    examTypes.value = examTypes.value.filter((x) => x.id !== t.id);
    flash('已删除类型');
  } catch (e) { error.value = e.message; }
}

async function addExamType() {
  const name = window.prompt('考试类型名称（如 联考、摸底考）');
  if (!name) return;
  try {
    // 标识（code）用于成绩关联，此处自动生成 customN，避免中文名称无法作为标识
    const used = new Set(examTypes.value.map((t) => t.code));
    let n = 1;
    while (used.has(`custom${n}`)) n += 1;
    const maxOrder = examTypes.value.reduce((m, t) => Math.max(m, Number(t.sortOrder) || 0), 0);
    await api.createExamType({ code: `custom${n}`, name, sortOrder: maxOrder + 10 });
    await load();
    flash(`已新增类型「${name}」`);
  } catch (e) { error.value = e.message; }
}

async function addAdmission(school) {
  const year = Number(window.prompt('年份（如 2027）'));
  if (!year) return;
  const minScore = Number(window.prompt('录取分数线（730 口径）'));
  if (!minScore) return;
  try {
    await api.addAdmission(school.schoolId, { year, minScore, totalFullScore: 730 });
    await load();
    flash('已新增录取线');
  } catch (e) { error.value = e.message; }
}

async function delAdmission(school, adm) {
  if (!window.confirm('删除该年度录取线？')) return;
  try { await api.deleteAdmission(school.schoolId, adm.id); await load(); flash('已删除'); } catch (e) { error.value = e.message; }
}

async function addSchool() {
  const name = window.prompt('院校名称（如 郑州市第四中学）');
  if (!name) return;
  try { await api.createSchool({ name }); await load(); flash('已新增院校'); } catch (e) { error.value = e.message; }
}

async function delSchool(school) {
  if (!window.confirm(`删除院校「${school.name}」及其全部录取线？`)) return;
  try { await api.deleteSchool(school.schoolId); await load(); flash('已删除'); } catch (e) { error.value = e.message; }
}
</script>

<template>
  <div>
    <div v-if="error" class="notice toast toast-top">{{ error }}</div>
    <div v-if="okMsg" class="notice notice-info toast">{{ okMsg }}</div>
    <div v-if="loading" class="loading">加载中…</div>

    <template v-else>
      <!-- 页面唯一保存按钮：汇总本页全部修改 -->
      <div style="position: sticky; top: 0; z-index: 20; display: flex; justify-content: flex-end; padding: 8px 0; background: var(--bg, #f6f7fb)">
        <button class="btn btn-primary" :disabled="!dirtyItems.length || saving" @click="saveAll">
          {{ saving ? '保存中…' : dirtyItems.length ? `保存修改（${dirtyItems.length}）` : '全部已保存' }}
        </button>
      </div>

      <div class="card">
        <div class="card-title">
          <h2>排名人数设置</h2>
        </div>
        <p class="small muted" style="margin-top: -4px">
          班级人数、年级人数在此统一填写，录入成绩时自动带入，无需每次填写；两项都可以留空。
          若填写了排名但此处对应人数为空，保存成绩时会提示先来本页补填。
        </p>
        <div class="row" style="margin-top: 8px">
          <div class="field"><label>班级人数</label>
            <input v-model="rankSizes.classSize" type="text" inputmode="numeric" autocomplete="off" placeholder="留空表示不填" style="width: 120px" /></div>
          <div class="field"><label>年级人数</label>
            <input v-model="rankSizes.gradeSize" type="text" inputmode="numeric" autocomplete="off" placeholder="留空表示不填" style="width: 120px" /></div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">
          <h2>科目配置</h2>
          <div class="row" style="gap: 8px; align-items: center">
            <GradeChips :model-value="subjectGrade" :options="GRADE_OPTIONS" @update:model-value="(v) => { subjectGrade = v; onSubjectGradeChange(); }" />
            <button class="btn btn-sm" @click="addSubject">+ 新增科目</button>
          </div>
        </div>
        <p class="small muted" style="margin-top: -4px">
          初二与初三的科目集合、科目满分不同（初二总分满分 570，初三中考口径 730），
          因此科目按学段分别维护：同一科目在初二、初三可以有不同的满分与计分设置。
          当前为 <strong>{{ GRADE_OPTIONS.find((g) => g.value === subjectGrade)?.label }}</strong>，
          合计满分 {{ GRADE_OPTIONS.find((g) => g.value === subjectGrade)?.fullScore }}。
        </p>
        <p class="scroll-hint">← 可左右滑动查看全部列 →</p>
        <div class="table-wrap">
          <table class="tbl">
            <thead><tr><th class="l">科目</th><th>满分</th><th class="l">计分</th><th>计入总分</th><th>启用</th><th></th></tr></thead>
            <tbody>
              <tr v-for="s in subjects" :key="`${s.grade}-${s.id}`">
                <td class="l">{{ s.name }}</td>
                <td><input v-model.number="s.fullScore" type="number" min="0" style="width: 80px" :disabled="s.scoreMode === 'grade'" /></td>
                <td class="l">
                  <select v-model="s.scoreMode" style="width: 92px" @change="s.fullScore = s.scoreMode === 'grade' ? 100 : s.fullScore">
                    <option value="score">分数</option><option value="grade">等级</option>
                  </select>
                </td>
                <td style="text-align: center"><input v-model="s.countsToTotal" type="checkbox" style="width: auto" /></td>
                <td style="text-align: center"><input v-model="s.isActive" type="checkbox" style="width: auto" /></td>
                <td><button class="btn btn-sm btn-danger" @click="delSubject(s)">删除</button></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <div class="card-title">
          <h2>考试类型</h2>
          <button class="btn btn-sm" @click="addExamType">+ 新增类型</button>
        </div>
        <p class="small muted" style="margin-top: -4px">改名后点上方「保存修改」统一保存；已被考试使用的类型不能删除。</p>
        <div class="chips" style="gap: 6px; flex-wrap: wrap">
          <span v-for="t in examTypes" :key="t.id" class="chip" style="gap: 6px">
            <input v-model="t.name" style="width: 90px; border: none; background: transparent; padding: 0" />
            <a href="javascript:void(0)" class="muted" style="text-decoration: none" @click="delExamType(t)">×</a>
          </span>
        </div>
      </div>

      <div class="card">
        <div class="card-title">
          <h2>目标院校</h2>
          <button class="btn btn-sm" @click="addSchool">+ 新增院校</button>
        </div>
        <div v-for="sch in schools" :key="sch.schoolId" style="margin-bottom: 14px">
          <div class="row" style="justify-content: space-between; align-items: center">
            <strong>{{ sch.name }} <span class="small muted">三年均值 {{ fmt(sch.avgScore3y) }}</span></strong>
            <div class="row" style="gap: 6px">
              <button class="btn btn-sm" @click="addAdmission(sch)">+ 录取线</button>
              <button class="btn btn-sm btn-danger" @click="delSchool(sch)">删除院校</button>
            </div>
          </div>
          <div class="row" style="align-items: flex-end; margin-top: 6px; gap: 8px">
            <div class="field" style="margin: 0">
              <label>采用线方式</label>
              <select v-model="sch.lineMode" style="width: 130px">
                <option value="avg3y">近三年均值</option>
                <option value="latest">最近一年</option>
                <option value="custom">自定义</option>
              </select>
            </div>
            <div v-if="sch.lineMode === 'custom'" class="field" style="margin: 0">
              <label>自定义采用线（730 口径）</label>
              <input v-model="sch.customLine" type="text" inputmode="decimal" style="width: 100px" placeholder="如 705" />
            </div>
          </div>
          <div class="table-wrap" style="margin-top: 6px">
            <table class="tbl">
              <thead><tr><th>年份</th><th>录取线</th><th></th></tr></thead>
              <tbody>
                <tr v-for="a in sch.admissionScores" :key="a.id">
                  <td><input v-model.number="a.year" type="number" style="width: 80px" /></td>
                  <td><input v-model.number="a.minScore" type="number" style="width: 80px" /></td>
                  <td style="text-align: center">
                    <button class="btn btn-sm btn-danger" @click="delAdmission(sch, a)">删除</button>
                  </td>
                </tr>
                <tr v-if="!sch.admissionScores.length"><td colspan="3" class="muted">暂无录取线数据</td></tr>
              </tbody>
            </table>
          </div>
        </div>
        <p class="small muted">跨年口径不一致（如 2023 年总分 700）时，系统会按"录取线 ÷ 当年满分 × 730"折算后再比较。</p>
      </div>
    </template>
  </div>
</template>

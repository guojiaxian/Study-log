<script setup>
import { onMounted, ref } from 'vue';
import { api } from '../api/index.js';
import { fmt } from '../utils/format.js';

const loading = ref(true);
const error = ref('');
const okMsg = ref('');
const subjects = ref([]);
const examTypes = ref([]);
const schools = ref([]);

function flash(msg) { okMsg.value = msg; setTimeout(() => { okMsg.value = ''; }, 2500); }

async function load() {
  loading.value = true;
  try {
    const [subs, types, sch] = await Promise.all([
      api.subjects(true), api.examTypes(), api.schools(),
    ]);
    subjects.value = subs.list;
    examTypes.value = types.list;
    schools.value = sch.list;
  } catch (e) { error.value = e.message; } finally { loading.value = false; }
}
onMounted(load);

async function saveSubject(s) {
  try {
    await api.updateSubject(s.id, {
      name: s.name, fullScore: s.fullScore, scoreMode: s.scoreMode,
      countsToTotal: s.countsToTotal, startGrade: s.startGrade, sortOrder: s.sortOrder, isActive: s.isActive,
    });
    flash(`已保存科目「${s.name}」`);
  } catch (e) { error.value = e.message; }
}

async function saveAdmission(school, adm) {
  try {
    await api.updateAdmission(school.schoolId, adm.id, {
      year: adm.year, minScore: adm.minScore, totalFullScore: adm.totalFullScore, admissionType: adm.admissionType,
    });
    flash('已保存录取线');
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
    <div v-if="error" class="notice">{{ error }}</div>
    <div v-if="okMsg" class="notice notice-info">{{ okMsg }}</div>
    <div v-if="loading" class="loading">加载中…</div>

    <template v-else>
      <div class="card">
        <h2>科目配置</h2>
        <div class="table-wrap">
          <table class="tbl">
            <thead><tr><th class="l">科目</th><th>满分</th><th class="l">计分</th><th>计入总分</th><th>启用</th><th></th></tr></thead>
            <tbody>
              <tr v-for="s in subjects" :key="s.id">
                <td class="l">{{ s.name }}</td>
                <td><input v-model.number="s.fullScore" type="number" min="0" style="width: 80px" :disabled="s.scoreMode === 'grade'" /></td>
                <td class="l">
                  <select v-model="s.scoreMode" style="width: 92px" @change="s.fullScore = s.scoreMode === 'grade' ? 100 : s.fullScore">
                    <option value="score">分数</option><option value="grade">等级</option>
                  </select>
                </td>
                <td style="text-align: center"><input v-model="s.countsToTotal" type="checkbox" style="width: auto" /></td>
                <td style="text-align: center"><input v-model="s.isActive" type="checkbox" style="width: auto" /></td>
                <td><button class="btn btn-sm" @click="saveSubject(s)">保存</button></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <h2>考试类型</h2>
        <div class="chips">
          <span v-for="t in examTypes" :key="t.code" class="tag" :class="{ 'tag-primary': t.isActive }">{{ t.name }}</span>
        </div>
      </div>

      <div class="card">
        <div class="card-title">
          <h2>目标院校</h2>
          <button class="btn btn-sm" @click="addSchool">+ 新增院校</button>
        </div>
        <div v-for="sch in schools" :key="sch.schoolId" style="margin-bottom: 14px">
          <div class="row" style="justify-content: space-between; align-items: center">
            <strong>{{ sch.name }} <span class="small muted">均值 {{ fmt(sch.avgScore3y) }}</span></strong>
            <div class="row" style="gap: 6px">
              <button class="btn btn-sm" @click="addAdmission(sch)">+ 录取线</button>
              <button class="btn btn-sm btn-danger" @click="delSchool(sch)">删除院校</button>
            </div>
          </div>
          <div class="table-wrap" style="margin-top: 6px">
            <table class="tbl">
              <thead><tr><th>年份</th><th>录取线</th><th></th></tr></thead>
              <tbody>
                <tr v-for="a in sch.admissionScores" :key="a.id">
                  <td><input v-model.number="a.year" type="number" style="width: 80px" /></td>
                  <td><input v-model.number="a.minScore" type="number" style="width: 80px" /></td>
                  <td>
                    <div class="row" style="gap: 6px; justify-content: flex-end">
                      <button class="btn btn-sm" @click="saveAdmission(sch, a)">保存</button>
                      <button class="btn btn-sm btn-danger" @click="delAdmission(sch, a)">删除</button>
                    </div>
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

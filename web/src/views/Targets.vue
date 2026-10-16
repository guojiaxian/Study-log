<script setup>
import { computed, onMounted, ref } from 'vue';
import { api } from '../api/index.js';
import { fmt, signed } from '../utils/format.js';

const loading = ref(true);
const error = ref('');
const data = ref(null);
const lineMode = ref('avg3y');

async function load() {
  loading.value = true;
  error.value = '';
  try {
    data.value = await api.schoolsCompare({ lineMode: lineMode.value });
  } catch (e) { error.value = e.message; } finally { loading.value = false; }
}
onMounted(load);

const basis = computed(() => data.value?.basis ?? null);
const schools = computed(() => data.value?.schools ?? []);

const maxAbsGap = computed(() => Math.max(1, ...schools.value.map((s) => Math.abs(s.gap ?? 0))));

function barWidth(gap) {
  if (gap == null) return '0%';
  return `${Math.min(100, (Math.abs(gap) / maxAbsGap.value) * 100)}%`;
}
</script>

<template>
  <div>
    <div class="card-title">
      <h1>目标院校对比</h1>
      <div class="field" style="margin: 0">
        <label>录取线口径</label>
        <select v-model="lineMode" @change="load">
          <option value="avg3y">近三年均值</option>
          <option value="latest">最近一年</option>
        </select>
      </div>
    </div>

    <div v-if="loading" class="loading">加载中…</div>
    <div v-else-if="error" class="notice">{{ error }}</div>

    <template v-else>
      <div class="card">
        <h2>我的中考口径总分（各计入总分科目最近一次得分之和）</h2>
        <div class="stat">
          <span class="value">{{ fmt(basis.myTotal) }}<small> / {{ basis.totalFullScore }}</small></span>
        </div>
        <div class="small muted" style="margin-top: 6px">
          <span v-for="c in basis.components" :key="c.subjectId" style="margin-right: 10px">
            {{ c.subjectName }}{{ fmt(c.score) }}
          </span>
          <span v-if="!basis.components.length">暂无已录入成绩</span>
        </div>
        <div v-if="basis.missingSubjects?.length" class="notice small" style="margin-top: 10px">
          有 {{ basis.missingSubjects.length }} 个计入总分科目从未录入，对比结果偏低
        </div>
      </div>

      <div class="card">
        <div class="card-title">
          <h2>与目标院校录取线的差距</h2>
          <span class="small muted">{{ lineMode === 'avg3y' ? '近三年均值' : '最近一年' }}</span>
        </div>
        <div class="table-wrap">
          <table class="tbl">
            <thead><tr><th class="l">学校</th><th>近三年录取线</th><th>采用线</th><th>差距</th><th class="l" style="width: 180px">提分空间</th></tr></thead>
            <tbody>
              <tr v-for="s in schools" :key="s.schoolId">
                <td class="l">{{ s.name }}</td>
                <td class="muted">
                  <span v-for="y in s.yearly" :key="y.year" style="margin-right: 6px">{{ y.year }}:{{ y.minScore }}</span>
                </td>
                <td>{{ fmt(s.lineScore) }}</td>
                <td :class="s.gap > 0 ? 'down' : 'up'">{{ signed(s.gap) }}</td>
                <td class="l">
                  <div style="background: #eef1f6; border-radius: 999px; height: 8px; overflow: hidden">
                    <div
                      :style="{ width: barWidth(s.gap), height: '100%', background: s.gap > 0 ? 'var(--down)' : 'var(--up)' }"
                    />
                  </div>
                  <span class="small" :class="s.gap > 0 ? 'down' : 'up'">
                    {{ s.gap > 0 ? `还需提分 ${fmt(s.gap)} 分` : `已超线 ${fmt(-s.gap)} 分` }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="small muted">负值/红色 = 距录取线还需提分；正值/绿色 = 已超线。</p>
      </div>

      <div class="card">
        <h2>提分建议</h2>
        <ul style="margin: 0; padding-left: 18px">
          <li v-for="s in schools.filter((x) => x.gap > 0)" :key="s.schoolId">
            距 {{ s.name }} 还需 {{ fmt(s.gap) }} 分，建议结合「智能分析」中的薄弱科目优先补齐。
          </li>
        </ul>
        <p v-if="!schools.some((x) => x.gap > 0)" class="muted small">当前总分已超过所有目标院校录取线。</p>
      </div>
    </template>
  </div>
</template>

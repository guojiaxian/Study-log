<script setup>
import { onMounted, ref } from 'vue';
import { api } from '../api/index.js';
import Settings from './Settings.vue';

const ai = ref({ configured: false, provider: '', model: '' });
onMounted(async () => {
  try { ai.value = await api.aiStatus(); } catch { /* ignore */ }
});
</script>

<template>
  <div>
    <h1>管理</h1>

    <!-- 分区一：成绩录入 -->
    <div class="card">
      <div class="card-title"><h2>成绩录入</h2></div>
      <div class="grid grid-2">
        <RouterLink to="/entry/manual" class="card" style="display: block; box-shadow: none">
          <h3>[手动录入]</h3>
          <p class="muted" style="margin: 4px 0">新建考试并逐科填写成绩与排名</p>
          <p class="small muted">适合：周测、单元测等科目少的考试</p>
        </RouterLink>
        <RouterLink to="/entry/ai" class="card" style="display: block; box-shadow: none">
          <h3>[智能批量录入]</h3>
          <p class="muted" style="margin: 4px 0">粘贴成绩单文本，AI 自动拆分各科</p>
          <p class="small muted">适合：月考、期中期末等长成绩单</p>
          <div v-if="!ai.configured" class="tag tag-warn">AI 未配置，暂不可用</div>
        </RouterLink>
      </div>
      <div v-if="!ai.configured" class="notice small" style="margin: 0">
        AI 未配置：智能批量录入不可用（供应商与密钥在服务端 <code>.env</code> 中维护，默认 DeepSeek）。可先使用手动录入。
      </div>
    </div>

    <!-- 分区二：设置 -->
    <Settings />
  </div>
</template>

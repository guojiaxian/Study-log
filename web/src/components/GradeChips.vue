<script setup>
/**
 * 学段选择 chips（替代 select 下拉）：
 * options 形如 [{ value, label }]；value 统一用字符串比较，数字/字符串均可。
 */
defineProps({
  modelValue: { type: [String, Number], default: '' },
  options: { type: Array, required: true },
});
const emit = defineEmits(['update:modelValue']);

function pick(v, current) {
  if (String(v) === String(current)) return; // 重复点击同一项不触发
  emit('update:modelValue', v);
}
</script>

<template>
  <span class="chips" style="display: inline-flex; vertical-align: middle">
    <span
      v-for="o in options"
      :key="String(o.value)"
      class="chip"
      :class="{ active: String(o.value) === String(modelValue) }"
      @click="pick(o.value, modelValue)"
    >{{ o.label }}</span>
  </span>
</template>

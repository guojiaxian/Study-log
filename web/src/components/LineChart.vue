<script setup>
import { onBeforeUnmount, onMounted, ref, watch, nextTick } from 'vue';
import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, LegendComponent, DataZoomComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([LineChart, GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, CanvasRenderer]);

const props = defineProps({
  categories: { type: Array, default: () => [] },
  // [{ name, data: (number|null)[], axis?: 0|1 }]
  series: { type: Array, default: () => [] },
  // [{ name?, inverse?: boolean, min?, max? }]
  yAxes: { type: Array, default: () => [{ name: '' }] },
  height: { type: String, default: '300px' },
  emptyText: { type: String, default: '暂无数据' },
});

const el = ref(null);
let chart = null;

function buildOption() {
  const axes = props.yAxes?.length ? props.yAxes : [{ name: '' }];
  return {
    tooltip: { trigger: 'axis', confine: true },
    legend: { top: 0, type: 'scroll', itemWidth: 14, itemHeight: 8 },
    grid: { left: 4, right: 12, bottom: 4, top: 34, containLabel: true },
    xAxis: {
      type: 'category',
      data: props.categories,
      boundaryGap: false,
      axisLabel: { hideOverlap: true, fontSize: 11 },
      axisTick: { show: false },
    },
    yAxis: axes.map((a, i) => ({
      type: 'value',
      name: a.name || '',
      inverse: !!a.inverse,
      scale: true,
      min: a.min ?? undefined,
      max: a.max ?? undefined,
      nameTextStyle: { fontSize: 11 },
      axisLabel: { fontSize: 11 },
      splitLine: i === 0 ? { lineStyle: { color: '#eef1f6' } } : { show: false },
    })),
    dataZoom: props.categories.length > 12 ? [{ type: 'inside' }] : undefined,
    series: props.series.map((s) => ({
      name: s.name,
      type: 'line',
      data: s.data,
      yAxisIndex: s.axis ?? 0,
      connectNulls: false,
      smooth: true,
      symbol: 'circle',
      symbolSize: 6,
      lineStyle: { width: 2 },
      emphasis: { focus: 'series' },
    })),
  };
}

function render() {
  if (!el.value) return;
  if (!chart) chart = echarts.init(el.value);
  if (!props.series.length || !props.categories.length) {
    chart.clear();
    return;
  }
  chart.setOption(buildOption(), true);
}

const resize = () => chart && chart.resize();

onMounted(async () => {
  await nextTick();
  render();
  window.addEventListener('resize', resize);
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', resize);
  if (chart) { chart.dispose(); chart = null; }
});

watch(() => [props.categories, props.series, props.yAxes], () => render(), { deep: true });
</script>

<template>
  <div class="chart-wrap" :style="{ height }">
    <div v-show="series.length && categories.length" ref="el" style="width: 100%; height: 100%" />
    <div v-if="!series.length || !categories.length" class="empty" style="padding: 30px 0">{{ emptyText }}</div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import * as echarts from 'echarts'
import type { Sample } from '../api'

const props = defineProps<{ title: string; unit: string; samples: Sample[] }>()

const el = ref<HTMLDivElement>()
let chart: echarts.ECharts | null = null

function resize() {
  chart?.resize()
}

function render() {
  if (!chart) return
  const data = props.samples.map((s) => [new Date(s.ts).getTime(), s.value] as [number, number])
  chart.setOption({
    title: { text: props.title, left: 'center', textStyle: { fontSize: 14 } },
    tooltip: { trigger: 'axis' },
    grid: { left: 55, right: 20, top: 40, bottom: 30 },
    xAxis: { type: 'time' },
    yAxis: { type: 'value', name: props.unit },
    series: [{ type: 'line', showSymbol: false, smooth: true, data }],
  })
}

onMounted(() => {
  chart = echarts.init(el.value!)
  render()
  window.addEventListener('resize', resize)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', resize)
  chart?.dispose()
})

watch(() => props.samples, render, { deep: true })
</script>

<template>
  <div ref="el" class="chart"></div>
</template>

<style scoped>
.chart {
  width: 100%;
  height: 280px;
  background: var(--card, transparent);
}
</style>

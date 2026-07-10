<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import * as echarts from 'echarts'
import type { Sample } from '../api'

const props = defineProps<{ title: string; unit: string; samples: Sample[]; color?: string }>()

const el = ref<HTMLDivElement>()
let chart: echarts.ECharts | null = null

function resize() {
  chart?.resize()
}

function render() {
  if (!chart) return
  const accent = props.color ?? '#38bdf8'
  const data = props.samples.map((s) => [new Date(s.ts).getTime(), s.value] as [number, number])
  chart.setOption({
    title: {
      text: props.title,
      left: 14,
      top: 10,
      textStyle: { fontSize: 13, fontWeight: 600, color: '#9aa8bd' },
    },
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(15, 20, 30, 0.92)',
      borderColor: 'rgba(255,255,255,0.12)',
      borderWidth: 1,
      textStyle: { color: '#e8eef8', fontSize: 12 },
      axisPointer: { lineStyle: { color: 'rgba(255,255,255,0.25)' } },
    },
    grid: { left: 48, right: 20, top: 46, bottom: 28 },
    xAxis: {
      type: 'time',
      axisLine: { lineStyle: { color: 'rgba(255,255,255,0.12)' } },
      axisLabel: { color: '#5f6c80', fontSize: 11 },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value',
      name: props.unit,
      nameTextStyle: { color: '#5f6c80', fontSize: 11 },
      axisLabel: { color: '#5f6c80', fontSize: 11 },
      axisLine: { show: false },
      splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } },
    },
    series: [
      {
        type: 'line',
        showSymbol: false,
        smooth: true,
        data,
        lineStyle: { width: 2, color: accent },
        itemStyle: { color: accent },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: accent + '55' },
            { offset: 1, color: accent + '00' },
          ]),
        },
      },
    ],
  })
}

onMounted(() => {
  chart = echarts.init(el.value!, undefined, { renderer: 'canvas' })
  render()
  window.addEventListener('resize', resize)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', resize)
  chart?.dispose()
})

watch(() => props.samples, render, { deep: true })
watch(() => props.color, render)
</script>

<template>
  <div ref="el" class="chart"></div>
</template>

<style scoped>
.chart {
  width: 100%;
  height: 280px;
}
</style>

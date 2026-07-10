<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import * as echarts from 'echarts'
import type { Sample } from '../api'
import { type Seg, boolSegments, toPoints, uptimeSegments } from '../lib/timeline'

const props = defineProps<{ title: string; unit: string; samples: Sample[]; color?: string; kind?: string }>()

const el = ref<HTMLDivElement>()
let chart: echarts.ECharts | null = null

// Status/heartbeat series are step-shaped, not trends: a smooth line lies about
// them (interpolating a 1→0 interface flap into a diagonal, or drawing the
// uptime counter as a sawtooth). Render those as a state timeline instead so a
// glance answers "when did it fail / when was it enabled vs disabled". The
// segment math lives in ../lib/timeline so the summary stats stay consistent.
const STATE_ON = '#34d399' // 正常 / 在线 / 启用
const STATE_OFF = '#f87171' // 故障 / 中断 / 禁用
const MARK = '#fbbf24'

const mode = computed<'line' | 'state' | 'uptime'>(() => {
  if (props.kind === 'agent.uptime_s') return 'uptime'
  if (props.unit === 'bool') return 'state'
  return 'line'
})

const baseTitle = () => ({
  text: props.title,
  left: 14,
  top: 10,
  textStyle: { fontSize: 13, fontWeight: 600, color: '#9aa8bd' },
})

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleString('zh-CN', { hour12: false })
}
function fmtDur(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 90) return `${s} 秒`
  const m = Math.round(s / 60)
  if (m < 90) return `${m} 分钟`
  const h = s / 3600
  if (h < 48) return `${h.toFixed(1)} 小时`
  return `${(h / 24).toFixed(1)} 天`
}

function renderLine() {
  if (!chart) return
  const accent = props.color ?? '#38bdf8'
  const data = props.samples.map((s) => [new Date(s.ts).getTime(), s.value] as [number, number])
  chart.setOption(
    {
      title: baseTitle(),
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
    },
    true,
  )
}

function renderTimeline(segs: Seg[], onLabel: string, offLabel: string, restarts: number[] = []) {
  if (!chart) return
  chart.setOption(
    {
      title: baseTitle(),
      tooltip: {
        trigger: 'item',
        backgroundColor: 'rgba(15, 20, 30, 0.92)',
        borderColor: 'rgba(255,255,255,0.12)',
        borderWidth: 1,
        textStyle: { color: '#e8eef8', fontSize: 12 },
        formatter: (p: { value: [number, number, number] }) => {
          const [start, end, ok] = p.value
          const label = ok ? onLabel : offLabel
          const dot = ok ? STATE_ON : STATE_OFF
          return (
            `<span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${dot};margin-right:6px"></span>` +
            `<b>${label}</b><br/>${fmtTime(start)} → ${fmtTime(end)}<br/><span style="color:#9aa8bd">持续 ${fmtDur(end - start)}</span>`
          )
        },
      },
      grid: { left: 16, right: 20, top: 46, bottom: 28 },
      xAxis: {
        type: 'time',
        axisLine: { lineStyle: { color: 'rgba(255,255,255,0.12)' } },
        axisLabel: { color: '#5f6c80', fontSize: 11 },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'category',
        data: ['status'],
        show: false,
        boundaryGap: true,
      },
      series: [
        {
          type: 'custom',
          encode: { x: [0, 1], y: -1 },
          data: segs.map((s) => [s.start, s.end, s.ok ? 1 : 0]),
          renderItem: (
            _params: unknown,
            api: {
              value: (i: number) => number
              coord: (p: [number, number]) => [number, number]
              size: (p: [number, number]) => [number, number]
            },
          ) => {
            const start = api.coord([api.value(0), 0])
            const end = api.coord([api.value(1), 0])
            const bandH = api.size([0, 1])[1] * 0.5
            const w = Math.max(end[0] - start[0], 1)
            return {
              type: 'rect',
              shape: { x: start[0], y: start[1] - bandH / 2, width: w, height: bandH, r: 2 },
              style: { fill: api.value(2) ? STATE_ON : STATE_OFF },
            }
          },
          markLine: restarts.length
            ? {
                symbol: 'none',
                silent: false,
                lineStyle: { color: MARK, type: 'dashed', width: 1 },
                label: {
                  formatter: '重启',
                  color: MARK,
                  fontSize: 10,
                  position: 'insideEndTop',
                },
                data: restarts.map((t) => ({ xAxis: t })),
              }
            : undefined,
        },
      ],
    },
    true,
  )
}

function render() {
  if (!chart) return
  if (mode.value === 'state') {
    renderTimeline(boolSegments(toPoints(props.samples), Date.now()), '正常 / 启用', '中断 / 禁用')
  } else if (mode.value === 'uptime') {
    const { segs, restarts } = uptimeSegments(toPoints(props.samples), Date.now())
    renderTimeline(segs, '在线', '离线 / 故障', restarts)
  } else {
    renderLine()
  }
}

function resize() {
  chart?.resize()
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
watch([() => props.color, () => props.kind], render)
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

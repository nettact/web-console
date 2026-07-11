<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import * as echarts from 'echarts'
import { useI18n } from 'vue-i18n'
import type { Sample } from '../api'
import { toDateLocale } from '../i18n'
import { type Seg, boolSegments, toPoints, uptimeSegments } from '../lib/timeline'

const { t, locale } = useI18n()

// A metric to plot. One monitoring target may carry several (e.g. ICMP RTT +
// loss), which are overlaid on shared time with per-unit Y axes.
interface ChartMetric {
  key: string
  label: string
  kind: string
  unit: string
  color: string
  samples: Sample[]
}

// Legacy single-series props (Dashboard) are still accepted; History passes the
// richer `metrics` array. Both normalize to `metrics` below.
const props = defineProps<{
  title: string
  unit?: string
  samples?: Sample[]
  color?: string
  kind?: string
  metrics?: ChartMetric[]
}>()

const el = ref<HTMLDivElement>()
let chart: echarts.ECharts | null = null

const STATE_ON = '#34d399' // 正常 / 在线 / 启用
const STATE_OFF = '#f87171' // 故障 / 中断 / 禁用
const MARK = '#fbbf24'

const UNIT_LABEL: Record<string, string> = { ms: 'ms', pct: '%', count: '' }
const unitName = (u: string) => {
  if (u === 'code') return t('chart.unitCode')
  if (u === 'bool') return t('chart.unitBool')
  if (u === 's') return t('chart.unitSec')
  return UNIT_LABEL[u] ?? u
}

const metrics = computed<ChartMetric[]>(() => {
  if (props.metrics && props.metrics.length) return props.metrics
  return [
    {
      key: 'm',
      label: props.title,
      kind: props.kind ?? '',
      unit: props.unit ?? '',
      color: props.color ?? '#38bdf8',
      samples: props.samples ?? [],
    },
  ]
})

const baseTitle = () => ({
  text: props.title,
  left: 14,
  top: 10,
  textStyle: { fontSize: 13, fontWeight: 600, color: '#9aa8bd' },
})

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleString(toDateLocale(locale.value), { hour12: false })
}
function fmtDur(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 90) return t('common.durSeconds', { n: s })
  const m = Math.round(s / 60)
  if (m < 90) return t('common.durMinutes', { n: m })
  const h = s / 3600
  if (h < 48) return t('common.durHours', { n: h.toFixed(1) })
  return t('common.durDays', { n: (h / 24).toFixed(1) })
}

// Trend metrics: one smooth line each, grouped onto up to two Y axes by unit.
// Boolean metrics that get mixed in render as a 0/1 step line on their own axis.
function renderLines(ms: ChartMetric[]) {
  if (!chart) return
  const multi = ms.length > 1
  const units: string[] = []
  for (const m of ms) if (!units.includes(m.unit || '')) units.push(m.unit || '')
  const axisUnits = (units.length ? units : ['']).slice(0, 2)

  const yAxis = axisUnits.map((u, i) => ({
    type: 'value' as const,
    name: unitName(u),
    position: i === 0 ? ('left' as const) : ('right' as const),
    // Unit label runs vertically along the middle of the axis (not parked in the
    // top corner) so it never collides with the title or the legend — the cause
    // of the RTT/丢包率/ms and DNS 解析时延/ms overlaps.
    nameLocation: 'middle' as const,
    nameGap: 40,
    nameRotate: 90,
    nameTextStyle: { color: '#5f6c80', fontSize: 11 },
    axisLabel: {
      color: '#5f6c80',
      fontSize: 11,
      ...(u === 'bool' ? { formatter: (v: number) => (v >= 0.5 ? t('chart.normal') : t('chart.interrupted')) } : {}),
    },
    axisLine: { show: false },
    splitLine: i === 0 ? { lineStyle: { color: 'rgba(255,255,255,0.06)' } } : { show: false },
    ...(u === 'bool' ? { min: 0, max: 1, interval: 1 } : {}),
  }))

  const series = ms.map((m) => {
    const isBool = m.unit === 'bool'
    const ai = Math.max(0, axisUnits.indexOf(m.unit || ''))
    return {
      name: m.label,
      type: 'line' as const,
      showSymbol: false,
      smooth: !isBool,
      step: isBool ? ('end' as const) : (false as const),
      yAxisIndex: ai,
      data: m.samples.map((s) => [new Date(s.ts).getTime(), s.value] as [number, number]),
      lineStyle: { width: 2, color: m.color },
      itemStyle: { color: m.color },
      // Fill only when a single line owns the chart; overlaid areas muddy each other.
      areaStyle: multi
        ? undefined
        : {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: m.color + '55' },
              { offset: 1, color: m.color + '00' },
            ]),
          },
    }
  })

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
      // Only the title (left) and legend (right) share the top row now; axis unit
      // names live on the sides, so a small top margin is enough.
      legend: multi
        ? { top: 8, right: 12, textStyle: { color: '#9aa8bd', fontSize: 11 }, itemWidth: 14, itemHeight: 8 }
        : undefined,
      grid: { left: 58, right: axisUnits.length > 1 ? 58 : 22, top: multi ? 44 : 40, bottom: 28 },
      xAxis: {
        type: 'time',
        axisLine: { lineStyle: { color: 'rgba(255,255,255,0.12)' } },
        axisLabel: { color: '#5f6c80', fontSize: 11 },
        splitLine: { show: false },
      },
      yAxis,
      series,
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
            `<b>${label}</b><br/>${fmtTime(start)} → ${fmtTime(end)}<br/><span style="color:#9aa8bd">${t('chart.duration', { dur: fmtDur(end - start) })}</span>`
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
      yAxis: { type: 'category', data: ['status'], show: false, boundaryGap: true },
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
                label: { formatter: t('chart.restart'), color: MARK, fontSize: 10, position: 'insideEndTop' },
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
  const ms = metrics.value
  // A lone status/heartbeat metric keeps its dedicated state timeline; anything
  // else (including several trend metrics) is overlaid as lines.
  if (ms.length === 1) {
    const m = ms[0]
    if (m.unit === 'bool') {
      renderTimeline(boolSegments(toPoints(m.samples), Date.now()), t('chart.normalEnabled'), t('chart.interruptedDisabled'))
      return
    }
    if (m.kind === 'agent.uptime_s') {
      const { segs, restarts } = uptimeSegments(toPoints(m.samples), Date.now())
      renderTimeline(segs, t('chart.online'), t('chart.offlineFault'), restarts)
      return
    }
  }
  renderLines(ms)
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

// `locale` is included so axis labels, legends and tooltips re-render on language switch.
watch(() => [props.metrics, props.samples, props.color, props.kind, props.unit, locale.value], render, { deep: true })
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

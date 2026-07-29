<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import * as echarts from 'echarts'
import { useI18n } from 'vue-i18n'
import type { Sample } from '../api'
import { toDateLocale } from '../i18n'
import { theme } from '../theme'
import { type Seg, boolSegments, toPoints, uptimeSegments } from '../lib/timeline'
import { fmtByUnit, isByteUnit } from '../lib/format'
import { lineDataWithGaps } from '../lib/chartSeries'

const { t, locale } = useI18n()

// ECharts renders to canvas and can't read CSS custom properties, so the chart
// chrome (axes, grid, tooltip) carries its own per-theme palette. Brand/state
// hues (lines, timeline fills) are identical in both themes.
const chartTheme = computed(() =>
  theme.value === 'light'
    ? {
        title: '#4a5768',
        label: '#78859a',
        split: 'rgba(15, 23, 42, 0.08)',
        axisLine: 'rgba(15, 23, 42, 0.18)',
        tooltipBg: 'rgba(255, 255, 255, 0.97)',
        tooltipBorder: 'rgba(15, 23, 42, 0.12)',
        tooltipText: '#10192a',
        pointer: 'rgba(15, 23, 42, 0.25)',
      }
    : {
        title: '#9aa8bd',
        label: '#5f6c80',
        split: 'rgba(255, 255, 255, 0.06)',
        axisLine: 'rgba(255, 255, 255, 0.12)',
        tooltipBg: 'rgba(15, 20, 30, 0.92)',
        tooltipBorder: 'rgba(255, 255, 255, 0.12)',
        tooltipText: '#e8eef8',
        pointer: 'rgba(255, 255, 255, 0.25)',
      },
)

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

const props = defineProps<{
  title: string
  metrics: ChartMetric[]
}>()

const el = ref<HTMLDivElement>()
let chart: echarts.ECharts | null = null
let resizeObserver: ResizeObserver | null = null

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

const baseTitle = () => ({
  text: props.title,
  left: 14,
  top: 10,
  textStyle: { fontSize: 13, fontWeight: 600, color: chartTheme.value.title },
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
// 's'-unit series (uptime) carry a value in seconds; humanize it for axes/tooltips.
const isDurUnit = (u: string) => u === 's'
const fmtDurSec = (sec: number) => fmtDur(sec * 1000)

// Trend metrics: one smooth line each, grouped onto up to two Y axes by unit.
// Boolean metrics that get mixed in render as a 0/1 step line on their own axis.
function renderLines(ms: ChartMetric[]) {
  if (!chart) return
  const ct = chartTheme.value
  const multi = ms.length > 1
  const units: string[] = []
  for (const m of ms) if (!units.includes(m.unit || '')) units.push(m.unit || '')
  const axisUnits = (units.length ? units : ['']).slice(0, 2)

  const yAxis = axisUnits.map((u, i) => ({
    type: 'value' as const,
    // Capacity (bytes / bps) and duration ('s') axes carry their scaled suffix
    // (MB/GB, 小时/天) on each tick label, so the axis name would be redundant.
    name: isByteUnit(u) || isDurUnit(u) ? '' : unitName(u),
    position: i === 0 ? ('left' as const) : ('right' as const),
    // Unit label runs vertically along the middle of the axis (not parked in the
    // top corner) so it never collides with the title or the legend — the cause
    // of the RTT/丢包率/ms and DNS 解析时延/ms overlaps.
    nameLocation: 'middle' as const,
    nameGap: 40,
    nameRotate: 90,
    nameTextStyle: { color: ct.label, fontSize: 11 },
    axisLabel: {
      color: ct.label,
      fontSize: 11,
      ...(u === 'bool'
        ? { formatter: (v: number) => (v >= 0.5 ? t('chart.normal') : t('chart.interrupted')) }
        : isByteUnit(u)
          ? { formatter: (v: number) => fmtByUnit(u, v) }
          : isDurUnit(u)
            ? { formatter: (v: number) => fmtDurSec(v) }
            : {}),
    },
    axisLine: { show: false },
    splitLine: i === 0 ? { lineStyle: { color: ct.split } } : { show: false },
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
      data: lineDataWithGaps(m.samples),
      connectNulls: false,
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

  // Only override the tooltip when a series needs scaled formatting (capacity or
  // duration); other charts keep ECharts' default axis tooltip untouched.
  const unitByName = new Map(ms.map((m) => [m.label, m.unit]))
  const hasScaled = ms.some((m) => isByteUnit(m.unit) || isDurUnit(m.unit))
  const scaledTooltip = (params: { axisValue: number; seriesName: string; marker: string; value: [number, number] }[]) => {
    const rows = params
      .map((p) => {
        const u = unitByName.get(p.seriesName) ?? ''
        const raw = p.value[1]
        const disp = isByteUnit(u)
          ? fmtByUnit(u, raw)
          : isDurUnit(u)
            ? fmtDurSec(raw)
            : `${Number.isInteger(raw) ? raw : raw.toFixed(1)}${u ? ' ' + unitName(u) : ''}`
        return `${p.marker}${p.seriesName}<span style="float:right;margin-left:20px;font-weight:600">${disp}</span>`
      })
      .join('<br/>')
    return `${fmtTime(params[0].axisValue)}<br/>${rows}`
  }

  // A single legend row overflows once there are many series (per-core CPU),
  // so past PER_ROW entries we split into centered rows of PER_ROW stacked
  // below the title (core 0–7 on row 1, 8–15 on row 2, …) and grow the top
  // margin to fit them. Few-series charts keep the compact top-right legend.
  const PER_ROW = 8
  const legendStyle = { textStyle: { color: ct.title, fontSize: 11 }, itemWidth: 14, itemHeight: 8 }
  let legend: echarts.LegendComponentOption | echarts.LegendComponentOption[] | undefined
  let gridTop = multi ? 44 : 40
  if (multi && ms.length > PER_ROW) {
    const rows: string[][] = []
    for (let i = 0; i < ms.length; i += PER_ROW) rows.push(ms.slice(i, i + PER_ROW).map((m) => m.label))
    legend = rows.map((data, i) => ({ ...legendStyle, data, top: 30 + i * 20, left: 'center', itemGap: 12 }))
    gridTop = 30 + rows.length * 20 + 8
  } else if (multi) {
    legend = { ...legendStyle, top: 8, right: 12 }
  }

  chart.setOption(
    {
      title: baseTitle(),
      tooltip: {
        trigger: 'axis',
        backgroundColor: ct.tooltipBg,
        borderColor: ct.tooltipBorder,
        borderWidth: 1,
        textStyle: { color: ct.tooltipText, fontSize: 12 },
        axisPointer: { lineStyle: { color: ct.pointer } },
        ...(hasScaled ? { formatter: scaledTooltip as never } : {}),
      },
      // Title sits top-left; the legend is top-right for a few series, or wraps
      // into centered rows below the title when there are many (see above).
      legend,
      grid: { left: 58, right: axisUnits.length > 1 ? 72 : 22, top: gridTop, bottom: 30 },
      xAxis: {
        type: 'time',
        axisLine: { lineStyle: { color: ct.axisLine } },
        axisLabel: { color: ct.label, fontSize: 11 },
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
  const ct = chartTheme.value
  chart.setOption(
    {
      title: baseTitle(),
      tooltip: {
        trigger: 'item',
        backgroundColor: ct.tooltipBg,
        borderColor: ct.tooltipBorder,
        borderWidth: 1,
        textStyle: { color: ct.tooltipText, fontSize: 12 },
        formatter: (p: { value: [number, number, number] }) => {
          const [start, end, ok] = p.value
          const label = ok ? onLabel : offLabel
          const dot = ok ? STATE_ON : STATE_OFF
          return (
            `<span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${dot};margin-right:6px"></span>` +
            `<b>${label}</b><br/>${fmtTime(start)} → ${fmtTime(end)}<br/><span style="color:${ct.label}">${t('chart.duration', { dur: fmtDur(end - start) })}</span>`
          )
        },
      },
      grid: { left: 16, right: 20, top: 46, bottom: 28 },
      xAxis: {
        type: 'time',
        axisLine: { lineStyle: { color: ct.axisLine } },
        axisLabel: { color: ct.label, fontSize: 11 },
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
  const ms = props.metrics
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
  // Dashboard panels can change width without a window resize (for example when
  // the host-status panel appears after the initial data request). Observe the
  // actual chart container so ECharts never keeps its old full-width canvas and
  // gets clipped by the new grid column.
  resizeObserver = new ResizeObserver(() => chart?.resize())
  resizeObserver.observe(el.value!)
  window.addEventListener('resize', resize)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', resize)
  resizeObserver?.disconnect()
  resizeObserver = null
  chart?.dispose()
})

// `locale` re-renders axis labels/legends/tooltips on language switch; `theme`
// re-renders the chart chrome palette on light/dark switch.
watch(
  () => [props.metrics, locale.value, theme.value],
  render,
  { deep: true },
)
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

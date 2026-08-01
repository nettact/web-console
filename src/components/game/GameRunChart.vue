<script setup lang="ts">
// Per-second line chart for one game run.
//
// It exists alongside MetricChart rather than reusing it because a MetricChart
// series is a list of Samples, whose value is a plain number. A second in which
// the source could not observe a count has no number, and the only honest way to
// draw it is a break in the line — so this component's data points carry null and
// connectNulls stays off. Feeding those seconds to MetricChart would mean either
// dropping them (joining the line straight across an unmeasured stretch) or
// substituting 0 (a stall that never happened).
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as echarts from 'echarts'
import { useI18n } from 'vue-i18n'
import { toDateLocale } from '../../i18n'
import { theme } from '../../theme'
import { escapeHtml } from '../../lib/escapeHtml'
import { chartColor, oklchToRgb } from '../../lib/chartColor'
import type { GameChartSeries, GamePoint } from '../../lib/gameRun'

const props = defineProps<{
  title: string
  // Axis suffix shown on tick labels and in the tooltip (e.g. 'FPS', 'ms').
  unit: string
  series: GameChartSeries[]
}>()

const { t, locale } = useI18n()

const el = ref<HTMLDivElement>()
let chart: echarts.ECharts | null = null
let resizeObserver: ResizeObserver | null = null

// ECharts renders to canvas, so the design tokens have to be resolved to concrete
// colors before they reach axes, grids and tooltips.
const chartTheme = computed(() => {
  const isLight = theme.value === 'light'
  return {
    title: chartColor('--color-chart-title', isLight ? '#39475a' : '#c5cfdd'),
    label: chartColor('--color-chart-label', isLight ? '#4a5768' : '#b7c3d4'),
    split: chartColor('--color-chart-grid', isLight ? 'rgba(15, 23, 42, 0.14)' : 'rgba(255, 255, 255, 0.16)'),
    axisLine: chartColor('--color-chart-axis', isLight ? 'rgba(15, 23, 42, 0.22)' : 'rgba(255, 255, 255, 0.24)'),
    tooltipBg: isLight ? 'rgba(255, 255, 255, 0.97)' : 'rgba(15, 20, 30, 0.92)',
    tooltipText: isLight ? '#10192a' : '#e8eef8',
  }
})

const fmtTime = (ms: number) => new Date(ms).toLocaleString(toDateLocale(locale.value), { hour12: false })
const fmtValue = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1))

// A tooltip row for a second with no measurement says so, because an omitted row
// reads as "nothing happened" rather than "nothing was observed".
function tooltip(params: { axisValue: number; seriesName: string; marker: string; value: GamePoint }[]): string {
  const rows = params
    .map((p) => {
      const raw = p.value[1]
      const disp = raw === null ? t('gameRuns.chartNoValue') : `${fmtValue(raw)} ${props.unit}`
      return `${p.marker}${escapeHtml(p.seriesName)}<span style="float:right;margin-left:20px;font-weight:600">${disp}</span>`
    })
    .join('<br/>')
  return `${fmtTime(params[0].axisValue)}<br/>${rows}`
}

function render() {
  if (!chart) return
  const ct = chartTheme.value
  const multi = props.series.length > 1
  chart.setOption(
    {
      title: {
        text: props.title,
        left: 14,
        top: 10,
        textStyle: { fontSize: 13, fontWeight: 600, color: ct.title },
      },
      tooltip: {
        trigger: 'axis',
        backgroundColor: ct.tooltipBg,
        borderColor: ct.axisLine,
        borderWidth: 1,
        textStyle: { color: ct.tooltipText, fontSize: 12 },
        axisPointer: { lineStyle: { color: ct.axisLine } },
        formatter: tooltip as never,
      },
      legend: multi ? { textStyle: { color: ct.title, fontSize: 11 }, itemWidth: 14, itemHeight: 8, top: 8, right: 12 } : undefined,
      grid: { left: 58, right: 22, top: multi ? 44 : 40, bottom: 30 },
      xAxis: {
        type: 'time',
        axisLine: { lineStyle: { color: ct.axisLine } },
        axisLabel: { color: ct.label, fontSize: 11 },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        name: props.unit,
        nameLocation: 'middle',
        nameGap: 40,
        nameRotate: 90,
        nameTextStyle: { color: ct.label, fontSize: 11 },
        axisLabel: { color: ct.label, fontSize: 11 },
        axisLine: { show: false },
        splitLine: { lineStyle: { color: ct.split } },
      },
      series: props.series.map((s) => {
        const color = oklchToRgb(s.color) ?? s.color
        return {
          name: s.label,
          type: 'line' as const,
          showSymbol: false,
          // Frame data is one point per second and genuinely spiky; smoothing it
          // would round off the stutters the chart exists to show.
          smooth: false,
          data: s.data,
          connectNulls: false,
          lineStyle: { width: 1.6, color },
          itemStyle: { color },
          areaStyle: multi
            ? undefined
            : {
                color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                  { offset: 0, color: echarts.color.modifyAlpha(color, 0.33) ?? color },
                  { offset: 1, color: echarts.color.modifyAlpha(color, 0) ?? 'transparent' },
                ]),
              },
        }
      }),
    },
    true,
  )
}

function resize() {
  chart?.resize()
}

onMounted(() => {
  chart = echarts.init(el.value!, undefined, { renderer: 'canvas' })
  render()
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

watch(() => [props.series, props.title, props.unit, locale.value, theme.value], render, { deep: true })
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

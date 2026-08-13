<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import * as echarts from 'echarts'
import { useI18n } from 'vue-i18n'
import type { Sample } from '../api'
import { toDateLocale } from '../i18n'
import { theme } from '../theme'
import { type Seg, boolSegments, timelineSlices, toPoints, uptimeSegments, visibleTimelineBounds } from '../lib/timeline'
import { fmtByUnit, isByteUnit } from '../lib/format'
import { escapeHtml } from '../lib/escapeHtml'
import { lineDataWithGaps } from '../lib/chartSeries'
import { chartColor, oklchToRgb } from '../lib/chartColor'
import { bandAt, mergeBands, type BandKind, type ChartBand } from '../lib/chartBands'
import type { BaselineSpan } from '../lib/baselineBand'
import { pixelAtTime, useChartSelection, type TimeSelection } from '../composables/useChartSelection'
import { ALIGNED_GRID_LEFT, ALIGNED_GRID_RIGHT } from '../lib/chartGrid'
import { chartCoverage, resolveChartWindow, type ChartWindow } from '../lib/chartWindow'

const { t, locale } = useI18n()

// ECharts renders to canvas, so resolve the chart chrome tokens to concrete
// colors before passing them to axes, grids and tooltips. Series and state
// colors are resolved from the active design tokens by their callers.
const chartTheme = computed(() => {
  const isLight = theme.value === 'light'
  const title = chartColor('--color-chart-title', isLight ? '#39475a' : '#c5cfdd')
  const label = chartColor('--color-chart-label', isLight ? '#4a5768' : '#b7c3d4')
  const grid = chartColor('--color-chart-grid', isLight ? 'rgba(15, 23, 42, 0.14)' : 'rgba(255, 255, 255, 0.16)')
  const axis = chartColor('--color-chart-axis', isLight ? 'rgba(15, 23, 42, 0.22)' : 'rgba(255, 255, 255, 0.24)')

  return {
    title,
    label,
    split: grid,
    axisLine: axis,
    tooltipBg: isLight ? 'rgba(255, 255, 255, 0.97)' : 'rgba(15, 20, 30, 0.92)',
    tooltipBorder: axis,
    tooltipText: isLight ? '#10192a' : '#e8eef8',
    pointer: axis,
  }
})

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
  rangeSec?: number
  // A shared, immutable display window. History workspaces pass the same value
  // to every chart so sparse series keep their real position in the selected
  // range instead of each ECharts instance auto-fitting its own samples.
  timeWindow?: ChartWindow
  loading?: boolean
  // Pin the time axis to an explicit window (epoch ms). Without it ECharts fits
  // the axis to the data, which is right for a "last N hours" chart but wrong
  // when this chart has to line up tick-for-tick with another one beside it —
  // the game run's network timeline reads against the frame charts above it, and
  // two axes fitted to their own data would put the same moment in two places.
  // Pinning also switches the grid to the shared aligned geometry, because equal
  // axis bounds inside unequal plot rectangles still misplace the same instant.
  xMin?: number
  xMax?: number
  // Spans to shade behind the lines. The game run's network timeline carries the
  // stretches the game presented nothing in, so a blank here reads the same way
  // as the blank on the frame charts above — "the game was minimised", not "the
  // network data is missing".
  bands?: ChartBand[]
  // ALERT-003: what this metric NORMALLY sits between, shaded behind the lines.
  // One rectangle per time-of-day span, because the baseline is learned per
  // daypart — a household's 21:00 is not its 04:00, and a single flat band across
  // the window would be an average of two different normals that describes
  // neither. Empty/absent while the target is still learning.
  baselineSpans?: BaselineSpan[]
  // Whether a drag on this chart selects a time span.
  //
  // Off by default, and explicitly rather than by inferring it from the model
  // binding: defineModel hands back a writable local ref whether or not a parent
  // bound one, so an inferred version would make every dashboard and history
  // chart in the app draggable — each growing a highlight that nothing explains
  // and no panel reports. The game run page is the only place that owns a
  // selection, so it is the only place that asks for one.
  selectable?: boolean
}>()

const displayWindow = computed(() => resolveChartWindow(props.timeWindow, props.xMin, props.xMax))
const aligned = computed(() => displayWindow.value !== null)
const coverage = computed(() => {
  const timeWindow = displayWindow.value
  return timeWindow ? chartCoverage(props.metrics.map((metric) => metric.samples), timeWindow) : null
})

function visibleSampleCount(metric: ChartMetric): number {
  const timeWindow = displayWindow.value
  return metric.samples.filter((sample) => {
    const time = new Date(sample.ts).getTime()
    if (!Number.isFinite(time) || !Number.isFinite(sample.value)) return false
    return !timeWindow || (time >= timeWindow.startMs && time <= timeWindow.endMs)
  }).length
}

const hasSamples = computed(() => props.metrics.some((metric) => visibleSampleCount(metric) > 0))

// How strongly each kind is shaded, and in what. Kept in step with
// GameRunChart's table on purpose: the same stretch shaded two different colours
// on two charts a reader is comparing is worse than not shading it at all.
const BAND_ALPHA: Record<BandKind, number> = {
  stutter: 0.16,
  gapBackground: 0.1,
  gapNoFrames: 0.12,
  gapUnknown: 0.1,
}

function bandFill(kind: BandKind): string {
  const isLight = theme.value === 'light'
  const base =
    kind === 'stutter'
      ? chartColor('--color-warning', isLight ? '#b45309' : '#fbbf24')
      : kind === 'gapNoFrames'
        ? chartColor('--color-info', isLight ? '#0369a1' : '#38bdf8')
        : chartColor('--color-chart-label', isLight ? '#4a5768' : '#b7c3d4')
  return echarts.color.modifyAlpha(base, BAND_ALPHA[kind]) ?? base
}

// One markArea's worth of items, each carrying its own colour — see
// lib/chartBands for why the kinds share one and never merge into each other.
function markAreaData() {
  return mergeBands(props.bands ?? []).flatMap(({ kind, spans }) =>
    spans.map(([from, to]) => [{ xAxis: from, itemStyle: { color: bandFill(kind) } }, { xAxis: to }]),
  )
}

// The baseline corridor, as 2D markArea rectangles bounded on both axes. It rides
// in the SAME markArea as the time-span bands above because ECharts allows one
// per series — mixing 1D (x-only) and 2D items in one data array is supported, and
// is why this does not need a decoy series to hang off.
//
// The rectangles are bound to the first y axis, which on a latency chart is the
// only one; a chart mixing units would need the caller to say which axis the
// corridor belongs to, and no such chart asks for one today.
function baselineAreaData() {
  const spans = props.baselineSpans ?? []
  if (!spans.length) return []
  const isLight = theme.value === 'light'
  const base = chartColor('--color-chart-label', isLight ? '#4a5768' : '#b7c3d4')
  const fill = echarts.color.modifyAlpha(base, isLight ? 0.1 : 0.14) ?? base
  return spans.map((s) => [
    { xAxis: s.from, yAxis: s.lo, itemStyle: { color: fill } },
    { xAxis: s.to, yAxis: s.hi },
  ])
}

// A single-series fill is useful for tracing a noisy signal, but it should
// remain subordinate to the line and the grid. Fade it quickly instead of
// painting the whole plot in a flat block; the slightly stronger dark-theme
// values compensate for the lower perceived contrast on the glass surface.
function trendAreaFill(color: string) {
  const isLight = theme.value === 'light'
  const alpha = isLight
    ? { edge: 0.16, near: 0.055, tail: 0.012 }
    : { edge: 0.20, near: 0.075, tail: 0.018 }

  return new echarts.graphic.LinearGradient(0, 0, 0, 1, [
    { offset: 0, color: echarts.color.modifyAlpha(color, alpha.edge) ?? color },
    { offset: 0.34, color: echarts.color.modifyAlpha(color, alpha.near) ?? color },
    { offset: 0.7, color: echarts.color.modifyAlpha(color, alpha.tail) ?? color },
    { offset: 1, color: echarts.color.modifyAlpha(color, 0) ?? 'transparent' },
  ])
}

const el = ref<HTMLDivElement>()
let chart: echarts.ECharts | null = null
let resizeObserver: ResizeObserver | null = null
let compactChart = false

const chartHeight = computed(() => {
  const timelineRows = props.metrics.every((metric) => metric.unit === 'bool')
    ? props.metrics.length
    : props.metrics.length === 1 && props.metrics[0].kind === 'agent.uptime_s'
      ? 1
      : 0
  return timelineRows ? `${Math.max(190, 126 + timelineRows * 32)}px` : undefined
})

const stateColors = computed(() => ({
  on: chartColor('--color-success', '#34d399'),
  off: chartColor('--color-danger', '#f87171'),
  offStroke: chartColor('--color-danger-text', theme.value === 'light' ? '#991b1b' : '#fecaca'),
  mark: chartColor('--color-warning', '#fbbf24'),
  markText: chartColor('--color-warning-text', '#8a4b00'),
}))

const COMPACT_LINE_GRID_LEFT = 44
const COMPACT_LINE_GRID_RIGHT = 12
const TIMELINE_LABEL_WIDTH = 88
const TIMELINE_LABEL_GAP = 12
const COMPACT_TIMELINE_GRID_LEFT = TIMELINE_LABEL_WIDTH + TIMELINE_LABEL_GAP

const UNIT_LABEL: Record<string, string> = { ms: 'ms', pct: '%', count: '', c: '°C' }
const unitName = (u: string) => {
  if (u === 'code') return t('chart.unitCode')
  if (u === 'bool') return t('chart.unitBool')
  if (u === 's') return t('chart.unitSec')
  return UNIT_LABEL[u] ?? u
}

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

const windowLabel = computed(() => {
  const timeWindow = displayWindow.value
  return timeWindow ? `${fmtTime(timeWindow.startMs)} – ${fmtTime(timeWindow.endMs)}` : ''
})

const coverageLabel = computed(() => {
  const value = coverage.value
  if (!value || value.pointCount === 0) return t('chart.coverageNone')
  if (value.pointCount === 1) {
    return t('chart.coverageSingle', { time: fmtTime(value.firstObservedMs!) })
  }
  return t('chart.coverageSpan', {
    duration: fmtDur(value.spanMs),
    n: value.pointCount.toLocaleString(toDateLocale(locale.value)),
  })
})

const coverageStyle = computed(() => {
  const value = coverage.value
  if (!value || value.pointCount === 0) return undefined
  return {
    left: `${value.startRatio * 100}%`,
    width: value.pointCount === 1 ? '2px' : `${Math.max(value.spanRatio * 100, 0.35)}%`,
  }
})

const chartAriaLabel = computed(() => {
  const parts = [props.title]
  if (windowLabel.value) parts.push(windowLabel.value, coverageLabel.value)
  return parts.join('. ')
})

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

  const areas = [...baselineAreaData(), ...markAreaData()]
  const series = ms.map((m, i) => {
    const isBool = m.unit === 'bool'
    const ai = Math.max(0, axisUnits.indexOf(m.unit || ''))
    const visiblePoints = visibleSampleCount(m)
    const rawColor = oklchToRgb(m.color) ?? m.color
    // The base series palette is tuned for the dark workbench. Preserve its
    // hues but lower HSL lightness on the pale canvas so yellow/cyan/green lines
    // remain legible instead of washing into the surface.
    const color = theme.value === 'light'
      ? (echarts.color.modifyHSL(rawColor, undefined, undefined, 0.32) ?? rawColor)
      : rawColor
    return {
      name: m.label,
      type: 'line' as const,
      showSymbol: visiblePoints === 1,
      symbolSize: visiblePoints === 1 ? 8 : 5,
      // The bands belong to the chart rather than to a line, but ECharts hangs
      // markArea off a series — so the first one carries them all, silent, which
      // keeps them out of the axis tooltip's hit testing.
      ...(i === 0 && areas.length ? { markArea: { silent: true, data: areas } } : {}),
      smooth: !isBool,
      step: isBool ? ('end' as const) : (false as const),
      yAxisIndex: ai,
      data: lineDataWithGaps(m.samples),
      connectNulls: false,
      lineStyle: { width: 2, color, type: (['solid', 'dashed', 'dotted'] as const)[i % 3] },
      itemStyle: { color },
      // Fill only when a single line owns the chart; overlaid areas muddy each other.
      areaStyle: multi
        ? undefined
        : {
            color: trendAreaFill(color),
          },
    }
  })

  // Only override the tooltip when there is something ECharts' default would not
  // say: a series needing scaled formatting (capacity or duration), or a shaded
  // band that has to explain itself. Every other chart keeps the default.
  //
  // The band case is why this is not only about formatting. A band is drawn on
  // these charts as well as on the frame charts — that is the point of it, since
  // a stretch where nobody was playing looks identical on every one of them —
  // and a reader hovering here got values with no hint that the seconds under
  // them were an alt-tab. The colour alone does not say; it is explained once
  // above the charts, which is a long way from the pointer.
  const unitByName = new Map(ms.map((m) => [m.label, m.unit]))
  const hasScaled = ms.some((m) => isByteUnit(m.unit) || isDurUnit(m.unit))
  const hasBands = !!props.bands?.length
  const axisTooltip = (params: { axisValue: number; seriesName: string; marker: string; value: [number, number | null] }[]) => {
    const rows = params
      .filter((p) => typeof p.value?.[1] === 'number' && Number.isFinite(p.value[1]))
      .map((p) => {
        const u = unitByName.get(p.seriesName) ?? ''
        const raw = p.value[1] as number
        const disp =
          u === 'bool'
            ? // As the axis labels read it, not as the number it is stored as: a
              // tooltip saying "1" beside an axis saying 正常 is two answers.
              raw >= 0.5
              ? t('chart.normal')
              : t('chart.interrupted')
            : isByteUnit(u)
              ? fmtByUnit(u, raw)
              : isDurUnit(u)
                ? fmtDurSec(raw)
                : `${Number.isInteger(raw) ? raw : raw.toFixed(1)}${u ? ' ' + unitName(u) : ''}`
        return `${p.marker}${escapeHtml(p.seriesName)}<span style="float:right;margin-left:20px;font-weight:600">${disp}</span>`
      })
      .join('<br/>')
    const axisValue = params.find((p) => Number.isFinite(p.axisValue))?.axisValue
    if (axisValue === undefined) return rows || t('chart.noData')
    // From the UNMERGED list, so a band drawn as one stretch still explains each
    // of the seconds inside it in its own terms.
    const hit = bandAt(props.bands, axisValue)
    const note = hit?.text ? `<br/><span style="opacity:0.85">${escapeHtml(hit.text)}</span>` : ''
    return `${fmtTime(axisValue)}<br/>${rows || t('chart.noData')}${note}`
  }

  // A scroll legend stays within the actual chart container. This matters in
  // the Agent workspace where an otherwise desktop viewport can leave only a
  // narrow detail column, and per-core CPU can carry many series.
  let legend: echarts.LegendComponentOption | undefined
  let gridTop = multi ? 32 : 12
  if (multi) {
    legend = {
      type: 'scroll',
      top: 0,
      left: 8,
      right: 8,
      itemGap: 12,
      itemWidth: 14,
      itemHeight: 8,
      pageButtonItemGap: 6,
      pageIconColor: ct.title,
      pageIconInactiveColor: ct.axisLine,
      pageTextStyle: { color: ct.label, fontSize: 10 },
      textStyle: { color: ct.title, fontSize: 11 },
    }
  }

  const timeWindow = displayWindow.value

  chart.setOption(
    {
      tooltip: {
        trigger: 'axis',
        confine: true,
        backgroundColor: ct.tooltipBg,
        borderColor: ct.tooltipBorder,
        borderWidth: 1,
        textStyle: { color: ct.tooltipText, fontSize: 12 },
        axisPointer: { lineStyle: { color: ct.pointer } },
        ...(hasScaled || hasBands ? { formatter: axisTooltip as never } : {}),
      },
      // The compact scroll legend stays inside the current chart width.
      legend,
      grid: {
        left: compactChart ? COMPACT_LINE_GRID_LEFT : aligned.value ? ALIGNED_GRID_LEFT : 58,
        // A second axis still owns the right edge in a narrow container. Giving
        // that space back to the plot clips its tick labels and makes the two
        // scales indistinguishable precisely where the chart is hardest to read.
        right: axisUnits.length > 1
          ? ALIGNED_GRID_RIGHT
          : compactChart
            ? COMPACT_LINE_GRID_RIGHT
            : aligned.value
              ? ALIGNED_GRID_RIGHT
              : 22,
        top: gridTop,
        bottom: 30,
      },
      xAxis: {
        type: 'time',
        ...(timeWindow ? { min: timeWindow.startMs, max: timeWindow.endMs } : {}),
        axisLine: { lineStyle: { color: ct.axisLine } },
        axisLabel: { color: ct.label, fontSize: 11, hideOverlap: true },
        splitLine: { show: false },
      },
      yAxis,
      series,
      // Keep ECharts' screen-reader description without its automatic decal
      // texture. Series are already distinguished by line style, and the
      // generated triangles obscure single-series area charts.
      aria: { enabled: true, decal: { show: false } },
    },
    true,
  )
}

interface TimelineRow {
  label: string
  segs: Seg[]
}

function timelineBounds(ms: ChartMetric[], now: number): [number, number] {
  const timeWindow = displayWindow.value
  if (timeWindow) return [timeWindow.startMs, timeWindow.endMs]
  const requestedStart = props.rangeSec ? now - props.rangeSec * 1000 : now - 3600_000
  const sampleTimes = ms.flatMap((metric) => metric.samples.map((sample) => new Date(sample.ts).getTime()))
  return visibleTimelineBounds(sampleTimes, requestedStart, now)
}

function renderTimeline(
  rows: TimelineRow[],
  onLabel: string,
  offLabel: string,
  rangeStart: number,
  rangeEnd: number,
  restarts: number[] = [],
) {
  if (!chart) return
  const ct = chartTheme.value
  const state = stateColors.value
  const cells = rows.flatMap((row, rowIndex) =>
    timelineSlices(row.segs, rangeStart, rangeEnd).map((slice) => [
      slice.start,
      slice.end,
      slice.ok ? 1 : 0,
      rowIndex,
      slice.sourceStart,
      slice.sourceEnd,
    ]),
  )
  chart.setOption(
    {
      tooltip: {
        trigger: 'item',
        confine: true,
        backgroundColor: ct.tooltipBg,
        borderColor: ct.tooltipBorder,
        borderWidth: 1,
        textStyle: { color: ct.tooltipText, fontSize: 12 },
        formatter: (p: { value: [number, number, number, number, number, number] }) => {
          const [start, end, ok, rowIndex, sourceStart, sourceEnd] = p.value
          const label = ok ? onLabel : offLabel
          const dot = ok ? state.on : state.off
          const row = rows[rowIndex]
          const issueRange = ok
            ? ''
            : `<br/><span style="color:${ct.label}">${t('chart.issueRange')}</span><br/>${fmtTime(sourceStart)} → ${fmtTime(sourceEnd)}` +
              `<br/><span style="color:${ct.label}">${t('chart.duration', { dur: fmtDur(sourceEnd - sourceStart) })}</span>`
          return (
            `<span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${dot};margin-right:6px"></span>` +
            `<b>${label}</b>${rows.length > 1 ? `<span style="color:${ct.label};margin-left:8px">${escapeHtml(row.label)}</span>` : ''}` +
            `<br/><span style="color:${ct.label}">${t('chart.sliceRange')}</span><br/>${fmtTime(start)} → ${fmtTime(end)}` +
            issueRange
          )
        },
      },
      grid: { left: compactChart ? COMPACT_TIMELINE_GRID_LEFT : 112, right: compactChart ? 10 : 20, top: 12, bottom: 30 },
      xAxis: {
        type: 'time',
        min: rangeStart,
        max: rangeEnd,
        axisLine: { lineStyle: { color: ct.axisLine } },
        axisLabel: { color: ct.label, fontSize: 11, hideOverlap: true },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'category',
        data: rows.map((row) => row.label),
        boundaryGap: true,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: ct.label, fontSize: 11, width: TIMELINE_LABEL_WIDTH, overflow: 'truncate' },
      },
      series: [
        {
          type: 'custom',
          encode: { x: [0, 1], y: 3 },
          data: cells,
          renderItem: (
            _params: unknown,
            api: {
              value: (i: number) => number
              coord: (p: [number, number]) => [number, number]
              size: (p: [number, number]) => [number, number]
            },
          ) => {
            const rowIndex = api.value(3)
            const ok = api.value(2) === 1
            const start = api.coord([api.value(0), rowIndex])
            const end = api.coord([api.value(1), rowIndex])
            const bandH = Math.min(api.size([0, 1])[1] * 0.48, 18)
            const rawW = Math.max(end[0] - start[0], 1)
            const gap = rawW > 3 ? Math.min(1.6, rawW * 0.25) : 0.35
            const w = Math.max(rawW - gap, 0.8)
            return {
              type: 'rect',
              shape: { x: start[0] + gap / 2, y: start[1] - bandH / 2, width: w, height: bandH, r: 2 },
              // Interrupted cells carry a dashed outline as well as a colour.
              // This keeps the state legible for colour-vision deficiencies
              // without enabling ECharts' triangle decals over the whole plot.
              style: ok
                ? { fill: state.on }
                : { fill: state.off, stroke: state.offStroke, lineWidth: 1, lineDash: [3, 2] },
            }
          },
          markLine: restarts.length
            ? {
                symbol: 'none',
                silent: false,
                lineStyle: { color: state.mark, type: 'dashed', width: 1 },
                label: { formatter: t('chart.restart'), color: state.markText, fontSize: 10, position: 'insideEndTop' },
                data: restarts.map((t) => ({ xAxis: t })),
              }
            : undefined,
          // The timeline shades the same stretches the line charts do. Without
          // it a reader comparing a blank in the frame chart against this one
          // would find the explanation on one and not the other.
          ...(markAreaData().length ? { markArea: { silent: true, data: markAreaData() } } : {}),
        },
      ],
      aria: { enabled: true, decal: { show: false } },
    },
    true,
  )
}

function render() {
  if (!chart) return
  const ms = props.metrics
  const now = displayWindow.value?.endMs ?? Date.now()
  // Boolean metrics share one segmented time axis, with one row per Agent. This
  // keeps exact state transitions inspectable even in an across-Agent view.
  if (ms.length && ms.every((m) => m.unit === 'bool')) {
    const [rangeStart, rangeEnd] = timelineBounds(ms, now)
    renderTimeline(
      ms.map((m) => ({ label: m.label, segs: boolSegments(toPoints(m.samples), now) })),
      t('chart.normalEnabled'),
      t('chart.interruptedDisabled'),
      rangeStart,
      rangeEnd,
    )
    return
  }
  // A lone uptime counter keeps its dedicated online/offline timeline.
  if (ms.length === 1) {
    const m = ms[0]
    if (m.kind === 'agent.uptime_s') {
      const { segs, restarts } = uptimeSegments(toPoints(m.samples), now)
      const [rangeStart, rangeEnd] = timelineBounds(ms, now)
      renderTimeline([{ label: m.label, segs }], t('chart.online'), t('chart.offlineFault'), rangeStart, rangeEnd, restarts)
      return
    }
  }
  renderLines(ms)
}

function resize() {
  const nextCompact = (el.value?.clientWidth ?? 999) < 480
  if (nextCompact !== compactChart) {
    compactChart = nextCompact
    render()
  }
  chart?.resize()
  placeOverlay()
}

// ---- the shared time selection ----
//
// The same span the game charts above are highlighting, drawn here too, so a
// reader dragging across a frame-rate dip sees the network side of the same
// seconds. Inert on every other page that uses this component: without
// `selectable` no drag is claimed, and with nothing selected the overlay never
// leaves display:none.
const selection = defineModel<TimeSelection>('selection', { default: null })

const overlay = ref<HTMLDivElement>()

useChartSelection({
  el: () => el.value,
  chart: () => chart,
  selection,
  enabled: () => props.selectable === true,
})

function placeOverlay() {
  const box = overlay.value
  if (!box) return
  const sel = selection.value
  if (!chart || !sel) {
    box.style.display = 'none'
    return
  }
  const a = pixelAtTime(chart, sel[0])
  const b = pixelAtTime(chart, sel[1])
  if (a === null || b === null) {
    box.style.display = 'none'
    return
  }
  const gridLeft = compactChart ? 44 : aligned.value ? ALIGNED_GRID_LEFT : 58
  const gridRight = compactChart ? 12 : aligned.value ? ALIGNED_GRID_RIGHT : 22
  const left = Math.max(gridLeft, Math.min(a, b))
  const right = Math.min(chart.getWidth() - gridRight, Math.max(a, b))
  if (right <= left) {
    box.style.display = 'none'
    return
  }
  box.style.display = 'block'
  box.style.left = `${left}px`
  box.style.width = `${right - left}px`
}

onMounted(() => {
  chart = echarts.init(el.value!, undefined, { renderer: 'canvas' })
  compactChart = (el.value?.clientWidth ?? 999) < 480
  render()
  placeOverlay()
  // Dashboard panels can change width without a window resize (for example when
  // the host-status panel appears after the initial data request). Observe the
  // actual chart container so ECharts never keeps its old full-width canvas and
  // gets clipped by the new grid column.
  resizeObserver = new ResizeObserver(() => {
    resize()
  })
  resizeObserver.observe(el.value!)
  window.addEventListener('resize', resize)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', resize)
  resizeObserver?.disconnect()
  resizeObserver = null
  chart?.dispose()
  chart = null
})

// `locale` re-renders axis labels/legends/tooltips on language switch; `theme`
// re-renders the chart chrome palette on light/dark switch.
watch(
  () => [props.metrics, props.rangeSec, props.timeWindow, props.xMin, props.xMax, props.bands, locale.value, theme.value],
  () => {
    render()
    placeOverlay()
  },
  { deep: true },
)

// Its OWN watcher, shallow, and deliberately not in the list above: that one is
// deep and re-runs setOption(opt, true), so a selection in it would rebuild every
// chart on the page on every pointer event of a drag.
watch(selection, placeOverlay)
</script>

<template>
  <section class="chart-wrap" :aria-label="chartAriaLabel">
    <header class="chart-head">
      <div class="chart-title-block">
        <h3>{{ title }}</h3>
        <span v-if="windowLabel" class="chart-window">{{ windowLabel }}</span>
      </div>
      <div v-if="displayWindow" class="coverage-copy">
        <strong>{{ coverageLabel }}</strong>
        <span>{{ t('chart.coverageHint') }}</span>
      </div>
    </header>
    <div v-if="displayWindow" class="coverage-track" aria-hidden="true">
      <span v-if="coverageStyle" class="coverage-observed" :class="{ point: coverage?.pointCount === 1 }" :style="coverageStyle"></span>
    </div>
    <!-- The crosshair is the standing hint that a drag selects a span, so it is
         shown only where one actually does. -->
    <div ref="el" class="chart" :class="{ selectable, muted: loading }" :style="{ height: chartHeight }"></div>
    <div v-if="loading" class="chart-state loading-state" role="status">{{ t('chart.loading') }}</div>
    <div v-else-if="displayWindow && !hasSamples" class="chart-state empty-state">
      <strong>{{ t('chart.noData') }}</strong>
      <span>{{ t('chart.noDataHint') }}</span>
    </div>
    <div ref="overlay" class="selection" aria-hidden="true"></div>
  </section>
</template>

<style scoped>
/* Hallmark · component: historical chart · genre: modern-minimal · theme: NetTact tokens
 * states: default · hover · focus · active · disabled · loading · error · success
 * pre-emit critique: P5 H5 E4 S5 R5 V4
 */
.chart-wrap {
  position: relative;
  min-width: 0;
  container-type: inline-size;
}
.chart-head {
  display: flex;
  min-width: 0;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-sm);
  padding: var(--space-2xs) var(--space-sm) 0;
}
.chart-title-block {
  display: grid;
  min-width: 0;
  gap: var(--space-3xs);
}
.chart-title-block h3 {
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
  color: var(--color-ink);
  font-family: var(--font-body);
  font-size: var(--text-sm);
  font-style: normal;
  font-weight: 650;
  letter-spacing: 0;
}
.chart-window,
.coverage-copy span {
  color: var(--color-muted);
  font-family: var(--font-outlier);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
}
.coverage-copy {
  display: grid;
  flex: 0 1 auto;
  justify-items: end;
  gap: var(--space-3xs);
  text-align: right;
}
.coverage-copy strong {
  color: var(--color-ink-2);
  font-size: var(--text-xs);
  font-weight: 600;
  letter-spacing: 0;
}
.coverage-track {
  position: relative;
  height: 4px;
  margin: var(--space-xs) var(--space-sm) 0;
  overflow: hidden;
  border-radius: var(--radius-pill);
  background: var(--color-glass-subtle);
}
.coverage-observed {
  position: absolute;
  inset-block: 0;
  min-width: 2px;
  border-radius: var(--radius-pill);
  background: var(--color-info);
}
.coverage-observed.point {
  border-radius: 0;
}
.chart {
  width: 100%;
  height: 280px;
}
.chart.muted {
  opacity: 0.35;
}
.chart.selectable {
  cursor: crosshair;
}
.chart-state {
  position: absolute;
  inset-inline: var(--space-md);
  top: 52%;
  display: grid;
  justify-items: center;
  gap: var(--space-3xs);
  color: var(--color-muted);
  text-align: center;
  pointer-events: none;
}
.chart-state strong {
  color: var(--color-ink-2);
  font-size: var(--text-sm);
}
.chart-state span {
  max-width: 42ch;
  font-size: var(--text-xs);
}
.loading-state {
  color: var(--color-info-text);
}
.selection {
  position: absolute;
  top: 0;
  bottom: 0;
  display: none;
  pointer-events: none;
  /* The interaction accent rather than a colour of its own: this marks what the
     reader picked, and it must not be mistaken for one of the shaded bands
     underneath, which describe what the game did. */
  background: color-mix(in oklab, var(--color-accent) 14%, transparent);
  border-left: 1px solid color-mix(in oklab, var(--color-accent) 55%, transparent);
  border-right: 1px solid color-mix(in oklab, var(--color-accent) 55%, transparent);
}

@container (max-width: 30rem) {
  .chart-head {
    display: grid;
    gap: var(--space-xs);
  }
  .coverage-copy {
    justify-items: start;
    text-align: left;
  }
  .chart-window {
    white-space: normal;
  }
}

@media (prefers-reduced-motion: reduce) {
  .chart,
  .coverage-observed {
    transition: none;
  }
}
</style>

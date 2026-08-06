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

const aligned = computed(() => props.xMin !== undefined || props.xMax !== undefined)

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

const el = ref<HTMLDivElement>()
let chart: echarts.ECharts | null = null
let resizeObserver: ResizeObserver | null = null

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
  mark: chartColor('--color-warning', '#fbbf24'),
  markText: chartColor('--color-warning-text', '#8a4b00'),
}))

const UNIT_LABEL: Record<string, string> = { ms: 'ms', pct: '%', count: '', c: '°C' }
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

  const areas = [...baselineAreaData(), ...markAreaData()]
  const series = ms.map((m, i) => {
    const isBool = m.unit === 'bool'
    const ai = Math.max(0, axisUnits.indexOf(m.unit || ''))
    const color = oklchToRgb(m.color) ?? m.color
    return {
      name: m.label,
      type: 'line' as const,
      showSymbol: false,
      // The bands belong to the chart rather than to a line, but ECharts hangs
      // markArea off a series — so the first one carries them all, silent, which
      // keeps them out of the axis tooltip's hit testing.
      ...(i === 0 && areas.length ? { markArea: { silent: true, data: areas } } : {}),
      smooth: !isBool,
      step: isBool ? ('end' as const) : (false as const),
      yAxisIndex: ai,
      data: lineDataWithGaps(m.samples),
      connectNulls: false,
      lineStyle: { width: 2, color },
      itemStyle: { color },
      // Fill only when a single line owns the chart; overlaid areas muddy each other.
      areaStyle: multi
        ? undefined
        : {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: echarts.color.modifyAlpha(color, 0.33) ?? color },
              { offset: 1, color: echarts.color.modifyAlpha(color, 0) ?? 'transparent' },
            ]),
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
  const axisTooltip = (params: { axisValue: number; seriesName: string; marker: string; value: [number, number] }[]) => {
    const rows = params
      .map((p) => {
        const u = unitByName.get(p.seriesName) ?? ''
        const raw = p.value[1]
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
    // From the UNMERGED list, so a band drawn as one stretch still explains each
    // of the seconds inside it in its own terms.
    const hit = bandAt(props.bands, params[0].axisValue)
    const note = hit?.text ? `<br/><span style="opacity:0.85">${escapeHtml(hit.text)}</span>` : ''
    return `${fmtTime(params[0].axisValue)}<br/>${rows}${note}`
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
        ...(hasScaled || hasBands ? { formatter: axisTooltip as never } : {}),
      },
      // Title sits top-left; the legend is top-right for a few series, or wraps
      // into centered rows below the title when there are many (see above).
      legend,
      grid: {
        left: aligned.value ? ALIGNED_GRID_LEFT : 58,
        right: aligned.value ? ALIGNED_GRID_RIGHT : axisUnits.length > 1 ? 72 : 22,
        top: gridTop,
        bottom: 30,
      },
      xAxis: {
        type: 'time',
        ...(props.xMin === undefined ? {} : { min: props.xMin }),
        ...(props.xMax === undefined ? {} : { max: props.xMax }),
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

interface TimelineRow {
  label: string
  segs: Seg[]
}

function timelineBounds(ms: ChartMetric[], now: number): [number, number] {
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
      title: {
        ...baseTitle(),
        subtext: t('chart.statusTimelineHint'),
        subtextStyle: { color: ct.label, fontSize: 10, fontWeight: 400 },
      },
      tooltip: {
        trigger: 'item',
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
      grid: { left: 112, right: 20, top: 58, bottom: 30 },
      xAxis: {
        type: 'time',
        min: rangeStart,
        max: rangeEnd,
        axisLine: { lineStyle: { color: ct.axisLine } },
        axisLabel: { color: ct.label, fontSize: 11 },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'category',
        data: rows.map((row) => row.label),
        boundaryGap: true,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: ct.label, fontSize: 11, width: 88, overflow: 'truncate' },
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
            const start = api.coord([api.value(0), rowIndex])
            const end = api.coord([api.value(1), rowIndex])
            const bandH = Math.min(api.size([0, 1])[1] * 0.48, 18)
            const rawW = Math.max(end[0] - start[0], 1)
            const gap = rawW > 3 ? Math.min(1.6, rawW * 0.25) : 0.35
            const w = Math.max(rawW - gap, 0.8)
            return {
              type: 'rect',
              shape: { x: start[0] + gap / 2, y: start[1] - bandH / 2, width: w, height: bandH, r: 2 },
              style: { fill: api.value(2) ? state.on : state.off },
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
    },
    true,
  )
}

function render() {
  if (!chart) return
  const ms = props.metrics
  const now = Date.now()
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
  const left = Math.max(aligned.value ? ALIGNED_GRID_LEFT : 58, Math.min(a, b))
  const right = Math.min(chart.getWidth() - (aligned.value ? ALIGNED_GRID_RIGHT : 22), Math.max(a, b))
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
  render()
  placeOverlay()
  // Dashboard panels can change width without a window resize (for example when
  // the host-status panel appears after the initial data request). Observe the
  // actual chart container so ECharts never keeps its old full-width canvas and
  // gets clipped by the new grid column.
  resizeObserver = new ResizeObserver(() => {
    chart?.resize()
    placeOverlay()
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
  () => [props.metrics, props.rangeSec, props.xMin, props.xMax, props.bands, locale.value, theme.value],
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
  <div class="chart-wrap">
    <!-- The crosshair is the standing hint that a drag selects a span, so it is
         shown only where one actually does. -->
    <div ref="el" class="chart" :class="{ selectable }" :style="{ height: chartHeight }"></div>
    <div ref="overlay" class="selection" aria-hidden="true"></div>
  </div>
</template>

<style scoped>
.chart-wrap {
  position: relative;
}
.chart {
  width: 100%;
  height: 280px;
}
.chart.selectable {
  cursor: crosshair;
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
</style>

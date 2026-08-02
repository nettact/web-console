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
import { ALIGNED_GRID_LEFT, ALIGNED_GRID_RIGHT } from '../../lib/chartGrid'
import { fmtByUnit, isByteUnit } from '../../lib/format'
import { bandAt, mergeBands, type BandKind, type ChartBand } from '../../lib/chartBands'
import { pixelAtTime, useChartSelection, type TimeSelection } from '../../composables/useChartSelection'
import type { GameChartSeries, GamePoint } from '../../lib/gameRun'

const props = defineProps<{
  title: string
  // Axis suffix shown on tick labels and in the tooltip (e.g. 'FPS', 'ms'). The
  // capacity units ('bytes') are scaled to KB/MB/GB instead, as elsewhere: a
  // working set printed as 4831838208 is a number nobody reads as 4.5 GB.
  unit: string
  series: GameChartSeries[]
  // Fixed y bounds, for an axis whose scale is part of the meaning. A process
  // CPU chart pinned to 0-100 says "a quarter of the machine" at a glance; the
  // same series auto-scaled to its own range says "busy" no matter the figure.
  yMin?: number
  yMax?: number
  // Spans to shade behind the lines, each carrying the sentence its tooltip
  // adds for the seconds it covers, and the kind that decides its colour. The
  // kinds do not merge into one another — see lib/chartBands.
  bands?: ChartBand[]
  // The run's window (epoch ms). Pinning it keeps every chart on the page — these
  // frame charts and the network timeline below them — on one identical time
  // axis, so a spike at the same x really is the same moment. It also stops a run
  // whose seconds stop early from silently rescaling to its data. Equal bounds
  // are only half of it: the grid switches to the shared aligned geometry too, or
  // the same instant still lands at a different pixel in a differently-inset plot.
  xMin?: number
  xMax?: number
}>()

const aligned = computed(() => props.xMin !== undefined || props.xMax !== undefined)

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
    // One colour per band kind. A stutter is a fault and reads as a warning; a
    // gap is not — the game was minimized or loading, and shading that in the
    // same amber would have every alt-tab look like a problem.
    //
    // The two gap kinds differ from each other too, because their conclusions
    // are opposite: 'background' is time nobody was playing and the figures
    // around it must not be read as a stall, while 'no_frames' is the player
    // sitting there waiting, which is the one worth investigating.
    stutter: chartColor('--color-warning', isLight ? '#b45309' : '#fbbf24'),
    gapBackground: chartColor('--color-chart-label', isLight ? '#4a5768' : '#b7c3d4'),
    gapNoFrames: chartColor('--color-info', isLight ? '#0369a1' : '#38bdf8'),
  }
})

// How strongly each kind is shaded. The gaps are fainter than a stutter on
// purpose: they cover long stretches, and a band an hour wide at a stutter's
// opacity would dominate a chart whose subject is the lines on top of it.
const BAND_ALPHA: Record<BandKind, number> = {
  stutter: 0.16,
  gapBackground: 0.1,
  gapNoFrames: 0.12,
  gapUnknown: 0.1,
}

const scaled = computed(() => isByteUnit(props.unit))

const fmtTime = (ms: number) => new Date(ms).toLocaleString(toDateLocale(locale.value), { hour12: false })
const fmtValue = (v: number) =>
  scaled.value ? fmtByUnit(props.unit, v) : `${Number.isInteger(v) ? v : v.toFixed(1)} ${props.unit}`

// The colour a kind is drawn in, resolved to a concrete RGB with its alpha
// applied — ECharts renders to canvas and cannot read a design token.
function bandFill(kind: BandKind): string {
  const ct = chartTheme.value
  const base = kind === 'stutter' ? ct.stutter : kind === 'gapNoFrames' ? ct.gapNoFrames : ct.gapBackground
  return echarts.color.modifyAlpha(base, BAND_ALPHA[kind]) ?? base
}

// Every band as one flat list of markArea items, each carrying its own colour.
//
// ECharts hangs a markArea off a series and a chart gets one, so the kinds share
// it and are told apart by a per-item itemStyle rather than by having a markArea
// each. Merging happens within a kind only — a stutter must never absorb the
// alt-tab beside it — which is what mergeBands is for.
function markAreaData() {
  return mergeBands(props.bands ?? []).flatMap(({ kind, spans }) =>
    spans.map(([from, to]) => [{ xAxis: from, itemStyle: { color: bandFill(kind) } }, { xAxis: to }]),
  )
}

// A tooltip row for a second with no measurement says so, because an omitted row
// reads as "nothing happened" rather than "nothing was observed".
function tooltip(params: { axisValue: number; seriesName: string; marker: string; value: GamePoint }[]): string {
  // Read from the UNMERGED list, so a run that stuttered through a minute draws
  // one band and still explains each second individually.
  const hit = bandAt(props.bands, params[0].axisValue)
  const note = hit?.text ? `<br/><span style="opacity:0.85">${escapeHtml(hit.text)}</span>` : ''
  // Inside a gap every line is a dash, and a column of them buries the one
  // sentence that is actually the answer. The rows go, and only where the band
  // has something to say instead: a second that is blank for any other reason
  // still lists its series, because there "no value" IS the finding.
  if (note && params.every((p) => p.value[1] === null)) {
    return `${fmtTime(params[0].axisValue)}${note}`
  }
  const rows = params
    .map((p) => {
      const raw = p.value[1]
      const disp = raw === null ? t('gameRuns.chartNoValue') : fmtValue(raw)
      return `${p.marker}${escapeHtml(p.seriesName)}<span style="float:right;margin-left:20px;font-weight:600">${disp}</span>`
    })
    .join('<br/>')
  return `${fmtTime(params[0].axisValue)}<br/>${rows}${note}`
}

function render() {
  if (!chart) return
  const ct = chartTheme.value
  const multi = props.series.length > 1
  const areas = markAreaData()
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
      grid: {
        left: aligned.value ? ALIGNED_GRID_LEFT : 58,
        right: aligned.value ? ALIGNED_GRID_RIGHT : 22,
        top: multi ? 44 : 40,
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
      yAxis: {
        type: 'value',
        // A capacity axis carries its scaled suffix (MB/GB) on every tick, so
        // naming it 'bytes' as well would only contradict the labels.
        name: scaled.value ? '' : props.unit,
        nameLocation: 'middle',
        nameGap: 40,
        nameRotate: 90,
        nameTextStyle: { color: ct.label, fontSize: 11 },
        axisLabel: {
          color: ct.label,
          fontSize: 11,
          ...(scaled.value ? { formatter: (v: number) => fmtByUnit(props.unit, v) } : {}),
        },
        axisLine: { show: false },
        splitLine: { lineStyle: { color: ct.split } },
        ...(props.yMin === undefined ? {} : { min: props.yMin }),
        ...(props.yMax === undefined ? {} : { max: props.yMax }),
      },
      series: props.series.map((s, i) => {
        const color = oklchToRgb(s.color) ?? s.color
        return {
          name: s.label,
          type: 'line' as const,
          showSymbol: false,
          // The bands belong to the chart, not to a line, but ECharts hangs
          // markArea off a series — so the first one carries them all and they
          // are silent, which keeps them out of the axis tooltip's own hit
          // testing. Colour rides on each item rather than on the markArea,
          // because one markArea has to carry several kinds.
          ...(i === 0 && areas.length ? { markArea: { silent: true, data: areas } } : {}),
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
  placeOverlay()
}

// ---- the shared time selection ----
//
// Drag horizontally on any chart and every chart on the page highlights the same
// span. The highlight is this div, positioned in pixels — NOT a markArea and not
// an ECharts brush, because either would mean a full setOption on every chart on
// every pointermove. See composables/useChartSelection for the rest of the
// argument.
const selection = defineModel<TimeSelection>('selection', { default: null })

const overlay = ref<HTMLDivElement>()

useChartSelection({ el: () => el.value, chart: () => chart, selection })

// placeOverlay positions the highlight over the selected span, clamped to the
// plot rectangle so it never paints over the axis labels.
//
// It is the only thing a drag runs. It writes three style properties and touches
// no chart option, which is what keeps thirteen mirrored charts cheap.
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
    // The span is entirely outside this chart's window. Hidden rather than
    // clamped to a sliver, which would claim a selection that is not there.
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

watch(
  () => [
    props.series,
    props.title,
    props.unit,
    props.xMin,
    props.xMax,
    props.yMin,
    props.yMax,
    props.bands,
    locale.value,
    theme.value,
  ],
  () => {
    render()
    // The axis may have moved under the highlight, so it is repositioned after
    // the re-render rather than left where the old geometry put it.
    placeOverlay()
  },
  { deep: true },
)

// Its OWN watcher, shallow, and deliberately not part of the list above. That
// list is deep and re-runs setOption(opt, true); adding the selection to it would
// turn one drag into fourteen full chart rebuilds per pointer event.
watch(selection, placeOverlay)
</script>

<template>
  <div class="chart-wrap">
    <div ref="el" class="chart"></div>
    <!-- pointer-events: none so it never intercepts the drag that draws it, nor
         the hover that drives the axis tooltip underneath. -->
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
  /* The only standing hint that a drag does something. The caption above the
     charts says so once; this says it wherever the pointer happens to be. */
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

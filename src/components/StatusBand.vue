<script setup lang="ts">
// A tiny pure-SVG status band: sample-and-hold on/off segments drawn as colored
// rects. Used in the target overview grid where one ECharts instance per card
// would be far too heavy. For a full interactive timeline use MetricChart.
import { computed } from 'vue'
import type { Sample } from '../api'
import { boolSegments, toPoints, type Pt } from '../lib/timeline'
import { resolveChartWindow, type ChartWindow } from '../lib/chartWindow'

const props = defineProps<{
  samples: Sample[]
  // Normalizes a raw sample value to 0/1 "up" (e.g. ICMP loss: 100% ⇒ down).
  toUp?: (v: number) => number
  timeWindow?: ChartWindow
  label?: string
}>()

const STATE_ON = 'var(--color-success)'
const STATE_OFF = 'var(--color-danger)'
const W = 100
const H = 10

const rects = computed(() => {
  const raw = toPoints(props.samples)
  if (!raw.length) return []
  const pts: Pt[] = props.toUp ? raw.map((p) => ({ t: p.t, v: props.toUp!(p.v) })) : raw
  const window = resolveChartWindow(props.timeWindow)
  const rangeEnd = window?.endMs ?? Date.now()
  const visiblePts = window
    ? pts.filter((point) => Number.isFinite(point.t) && point.t >= window.startMs && point.t <= window.endMs)
    : pts
  if (!visiblePts.length) return []

  // This component is used as observation evidence, so an explicit display
  // window must not turn the newest point into evidence for the unobserved
  // remainder of that window. Keep sample-and-hold between observed points and
  // render the final point as a small marker; the neutral base remains visible
  // to its right. The legacy no-window path retains its live-state hold.
  const observedEnd = window ? visiblePts[visiblePts.length - 1].t : rangeEnd
  const segs = boolSegments(visiblePts, observedEnd)
  const start = window?.startMs ?? segs[0]?.start ?? visiblePts[0].t
  const end = window?.endMs ?? segs[segs.length - 1]?.end ?? observedEnd
  const span = Math.max(end - start, 1)
  const rendered = segs.flatMap((s) => {
    const clippedStart = Math.max(s.start, start)
    const clippedEnd = Math.min(s.end, end)
    if (clippedEnd <= clippedStart) return []
    return [{
      x: ((clippedStart - start) / span) * W,
      w: Math.max(((clippedEnd - clippedStart) / span) * W, 0.5),
      fill: s.ok ? STATE_ON : STATE_OFF,
      ok: s.ok,
    }]
  })

  if (window) {
    const last = visiblePts[visiblePts.length - 1]
    const markerW = Math.min(0.5, W)
    const markerX = Math.min(Math.max(((last.t - start) / span) * W, 0), W - markerW)
    rendered.push({
      x: markerX,
      w: markerW,
      fill: last.v >= 1 ? STATE_ON : STATE_OFF,
      ok: last.v >= 1,
    })
  }

  return rendered
})
</script>

<template>
  <svg
    class="band"
    :viewBox="`0 0 ${W} ${H}`"
    preserveAspectRatio="none"
    :role="label ? 'img' : undefined"
    :aria-label="label || undefined"
    :aria-hidden="label ? undefined : 'true'"
  >
    <rect :x="0" :y="0" :width="W" :height="H" class="empty-rect" />
    <rect
      v-for="(r, i) in rects"
      :key="i"
      :x="r.x"
      :y="0"
      :width="r.w"
      :height="H"
      :fill="r.fill"
      :class="{ interrupted: !r.ok }"
    />
  </svg>
</template>

<style scoped>
.band {
  width: 100%;
  height: 10px;
  border-radius: 3px;
  overflow: hidden;
  display: block;
}
.empty-rect {
  fill: var(--surface-2);
}
.interrupted {
  stroke: var(--color-danger-text);
  stroke-width: 0.65;
  stroke-dasharray: 1.2 0.8;
}
</style>

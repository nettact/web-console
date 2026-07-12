<script setup lang="ts">
// A tiny pure-SVG status band: sample-and-hold on/off segments drawn as colored
// rects. Used in the target overview grid where one ECharts instance per card
// would be far too heavy. For a full interactive timeline use MetricChart.
import { computed } from 'vue'
import type { Sample } from '../api'
import { boolSegments, toPoints, type Pt } from '../lib/timeline'

const props = defineProps<{
  samples: Sample[]
  // Normalizes a raw sample value to 0/1 "up" (e.g. ICMP loss: 100% ⇒ down).
  toUp?: (v: number) => number
}>()

const STATE_ON = '#34d399'
const STATE_OFF = '#f87171'
const W = 100
const H = 10

const rects = computed(() => {
  const raw = toPoints(props.samples)
  if (!raw.length) return []
  const pts: Pt[] = props.toUp ? raw.map((p) => ({ t: p.t, v: props.toUp!(p.v) })) : raw
  const now = Date.now()
  const segs = boolSegments(pts, now)
  if (!segs.length) return []
  const start = segs[0].start
  const end = segs[segs.length - 1].end
  const span = Math.max(end - start, 1)
  return segs.map((s) => ({
    x: ((s.start - start) / span) * W,
    w: Math.max(((s.end - s.start) / span) * W, 0.5),
    fill: s.ok ? STATE_ON : STATE_OFF,
  }))
})
</script>

<template>
  <svg class="band" :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="none" role="img">
    <rect v-if="!rects.length" :x="0" :y="0" :width="W" :height="H" class="empty-rect" />
    <rect v-for="(r, i) in rects" :key="i" :x="r.x" :y="0" :width="r.w" :height="H" :fill="r.fill" />
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
</style>

<script setup lang="ts">
// The 90-day uptime bar: one cell per UTC day, oldest on the left.
//
// SVG rects keep the visual compact; the focusable wrapper adds the one rich
// overview shared by hover, touch and keyboard. The console draws its equivalent
// (components/StatusBand.vue) the same way and for the same reason: this app is
// ~11 KB of its own code, and pulling in ECharts to draw ninety rectangles would
// multiply the whole download several times over for a shape that has no axes.
//
// A zero-round day is a HOLE, not an outage. Days before the deployment existed, or
// before this target was created, reached no verdict — colouring them red would
// invent months of downtime on a page whose entire job is to be trusted.
import { computed, onUnmounted, ref, useId } from 'vue'

import type { PublicDailyAvailability } from './api'

type DayTone = 'good' | 'warn' | 'bad' | 'muted'
type DaySummary = {
  date: string
  status: string
  availabilityLabel: string
  availability: string
  probesLabel: string
  probes: string
  tone: DayTone
  aria: string
}

const props = defineProps<{
  /** One summary per UTC day, oldest first. */
  days: PublicDailyAvailability[]
  /** UTC date of days[0], YYYY-MM-DD. */
  from: string
  barLabel: string
  /** Formats the selected day's public overview; keeps this component free of i18n. */
  summary: (date: string, day: PublicDailyAvailability) => DaySummary
}>()

// A viewBox in cell units rather than pixels: the SVG scales to whatever width the
// row gives it, and the gap stays proportional at every size.
const CELL = 3
const GAP = 1
const H = 30
const HOVER_DELAY_MS = 850

const bar = ref<HTMLElement | null>(null)
const cursor = ref(Math.max(props.days.length - 1, 0))
const visible = ref<number | null>(null)
const pointerInside = ref(false)
const focused = ref(false)
const tooltipId = `day-overview-${useId()}`
let hoverTimer: number | undefined

const cells = computed(() =>
  props.days.map((day, i) => ({
    x: i * (CELL + GAP),
    day,
    date: dayAt(i),
    tone: tone(day.ratio),
  })),
)

const width = computed(() => Math.max(props.days.length * (CELL + GAP) - GAP, 1))
const activeSummary = computed(() => {
  const i = visible.value ?? cursor.value
  const cell = cells.value[i]
  return cell ? props.summary(cell.date, cell.day) : null
})
const tooltipSummary = computed(() => {
  const i = visible.value
  const cell = i == null ? null : cells.value[i]
  return cell ? props.summary(cell.date, cell.day) : null
})
const tooltipLeft = computed(() => {
  if (visible.value == null || props.days.length === 0) return '50%'
  return `${((visible.value + 0.5) / props.days.length) * 100}%`
})

/** days[i] is i days after `from`, in UTC — the same calendar the server binned by. */
function dayAt(i: number): string {
  const base = Date.parse(props.from + 'T00:00:00Z')
  if (Number.isNaN(base)) return ''
  return new Date(base + i * 86_400_000).toISOString().slice(0, 10)
}

// Thresholds, not a gradient: a bar people read at a glance needs a small number
// of distinguishable states. Anything short of a full day is worth seeing, so the
// first band starts immediately below 100%.
function tone(ratio: number | null): string {
  if (ratio == null) return 'none'
  if (ratio >= 0.9999) return 'up'
  if (ratio >= 0.99) return 'minor'
  if (ratio >= 0.9) return 'major'
  return 'down'
}

function clearHoverTimer(): void {
  window.clearTimeout(hoverTimer)
  hoverTimer = undefined
}

function pointerIndex(event: Pick<PointerEvent, 'clientX'>): number {
  const rect = bar.value?.getBoundingClientRect()
  if (!rect || rect.width <= 0 || props.days.length === 0) return cursor.value
  const offset = Math.min(rect.width - Number.EPSILON, Math.max(0, event.clientX - rect.left))
  return Math.floor((offset / rect.width) * props.days.length)
}

function onPointerMove(event: PointerEvent): void {
  pointerInside.value = true
  cursor.value = pointerIndex(event)
  if (visible.value != null) {
    visible.value = cursor.value
    return
  }
  if (hoverTimer != null || event.pointerType === 'touch') return
  hoverTimer = window.setTimeout(() => {
    visible.value = cursor.value
    hoverTimer = undefined
  }, HOVER_DELAY_MS)
}

function onPointerLeave(): void {
  pointerInside.value = false
  clearHoverTimer()
  if (!focused.value) visible.value = null
}

function onFocus(): void {
  focused.value = true
  if (cursor.value >= props.days.length) cursor.value = Math.max(props.days.length - 1, 0)
  visible.value = props.days.length ? cursor.value : null
}

function onBlur(): void {
  focused.value = false
  if (!pointerInside.value) visible.value = null
}

function onClick(event: MouseEvent): void {
  cursor.value = pointerIndex(event)
  visible.value = props.days.length ? cursor.value : null
  bar.value?.focus({ preventScroll: true })
}

function onKeydown(event: KeyboardEvent): void {
  if (!props.days.length) return
  let next = cursor.value
  if (event.key === 'ArrowLeft') next--
  else if (event.key === 'ArrowRight') next++
  else if (event.key === 'PageUp') next -= 7
  else if (event.key === 'PageDown') next += 7
  else if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = props.days.length - 1
  else return
  event.preventDefault()
  cursor.value = Math.min(props.days.length - 1, Math.max(0, next))
  visible.value = cursor.value
}

onUnmounted(clearHoverTimer)
</script>

<template>
  <div class="bar-shell" :style="{ '--tooltip-x': tooltipLeft }">
    <div
      ref="bar"
      class="bar"
      role="slider"
      tabindex="0"
      aria-orientation="horizontal"
      :aria-label="barLabel"
      :aria-valuemin="1"
      :aria-valuemax="Math.max(days.length, 1)"
      :aria-valuenow="Math.min(cursor + 1, Math.max(days.length, 1))"
      :aria-valuetext="activeSummary?.aria"
      :aria-describedby="visible != null ? tooltipId : undefined"
      @pointerenter="onPointerMove"
      @pointermove="onPointerMove"
      @pointerleave="onPointerLeave"
      @focus="onFocus"
      @blur="onBlur"
      @click="onClick"
      @keydown="onKeydown"
    >
      <svg
        :viewBox="`0 0 ${width} ${H}`"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <rect
          v-for="(c, i) in cells"
          :key="i"
          :x="c.x"
          y="0"
          :width="CELL"
          :height="H"
          :class="[`cell cell-${c.tone}`, { 'cell-active': visible === i }]"
          rx="0.6"
        />
      </svg>
    </div>

    <div v-if="tooltipSummary" :id="tooltipId" class="day-tooltip" role="tooltip">
      <div class="day-tooltip-head">
        <time :datetime="cells[visible ?? 0]?.date">{{ tooltipSummary.date }}</time>
        <span class="day-status" :class="`day-status-${tooltipSummary.tone}`">
          {{ tooltipSummary.status }}
        </span>
      </div>
      <dl class="day-tooltip-grid">
        <div>
          <dt>{{ tooltipSummary.availabilityLabel }}</dt>
          <dd>{{ tooltipSummary.availability }}</dd>
        </div>
        <div>
          <dt>{{ tooltipSummary.probesLabel }}</dt>
          <dd>{{ tooltipSummary.probes }}</dd>
        </div>
      </dl>
    </div>
  </div>
</template>

<style scoped>
/* Hallmark · component: interactive timeline · genre: custom application system · theme: design.md
 * states: default · hover · focus · active · empty · success · warning · fault
 * contrast: pass · motion: none
 */
.bar-shell {
  position: relative;
  min-width: 0;
}

.bar {
  display: block;
  width: 100%;
  min-height: 2.75rem;
  padding-block: var(--space-2xs);
  border-radius: var(--radius-xs);
  outline: var(--rule-fine) solid transparent;
  outline-offset: var(--rule-hair);
  cursor: crosshair;
}

.bar svg {
  display: block;
  width: 100%;
  height: 1.875rem;
}

.bar:focus-visible {
  outline-color: var(--color-focus);
}

.bar:active {
  opacity: 0.92;
}
/* Every colour is a theme token, so the bar follows light/dark like everything
   else on the page. */
.cell {
  transition: opacity var(--dur-micro) var(--ease-out);
}

.cell-active {
  stroke: var(--color-focus);
  stroke-width: var(--rule-fine);
  vector-effect: non-scaling-stroke;
}

.cell-up {
  fill: var(--color-success);
}
.cell-minor {
  fill: var(--color-warning);
  opacity: 0.75;
}
.cell-major {
  fill: var(--color-warning);
}
.cell-down {
  fill: var(--color-danger);
}
/* A day with no verdict reads as absent rather than as any status. */
.cell-none {
  fill: var(--color-rule);
  opacity: 0.55;
}

.day-tooltip {
  position: absolute;
  z-index: var(--z-tooltip);
  top: calc(100% + var(--space-2xs));
  /* Follow the selected day until half the tooltip would cross the bar edge.
     The mobile override below centres a tooltip wider than the bar itself. */
  left: clamp(10rem, var(--tooltip-x), calc(100% - 10rem));
  width: min(20rem, calc(100vw - var(--space-md)));
  padding: var(--space-xs);
  transform: translateX(-50%);
  border: var(--rule-hair) solid var(--glass-border);
  border-radius: var(--radius-input);
  background: var(--glass-specular), var(--color-paper-2);
  box-shadow: var(--shadow-float);
  color: var(--color-ink);
  pointer-events: none;
}

.day-tooltip-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-xs);
  padding-bottom: var(--space-2xs);
  border-bottom: var(--rule-hair) solid var(--color-rule);
}

.day-tooltip-head time {
  font-family: var(--font-display);
  font-size: var(--text-sm);
  font-weight: 700;
}

.day-status {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3xs);
  color: var(--color-muted);
  font-size: var(--text-xs);
  font-weight: 600;
  white-space: nowrap;
}

.day-status::before {
  content: "";
  width: 0.5em;
  height: 0.5em;
  border-radius: 50%;
  background: currentColor;
}

.day-status-good {
  color: var(--color-success-text);
}

.day-status-warn {
  color: var(--color-warning-text);
}

.day-status-bad {
  color: var(--color-danger-text);
}

.day-status-muted {
  color: var(--color-muted);
}

.day-tooltip-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-xs);
  margin: var(--space-xs) 0 0;
}

.day-tooltip-grid dt {
  color: var(--color-muted);
  font-size: var(--text-xs);
}

.day-tooltip-grid dd {
  min-width: 0;
  margin: var(--space-3xs) 0 0;
  color: var(--color-ink-2);
  font-size: var(--text-sm);
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}

@media (max-width: 32rem) {
  .day-tooltip {
    left: 50%;
  }
}

@media (hover: hover) and (pointer: fine) {
  .bar:hover .cell:not(.cell-active) {
    opacity: 0.78;
  }
}

@media (prefers-reduced-motion: reduce) {
  .cell {
    transition-duration: 50ms;
  }
}
</style>

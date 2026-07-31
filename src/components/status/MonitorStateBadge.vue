<script setup lang="ts">
// A single authoritative target-status enum value as a coloured, always-labelled
// pill (STATUS-001). `dim` selects which dimension the `state` belongs to, which
// picks both the tone map and the i18n family (`targetStatus.<dim>.<state>`).
// State is text + colour, never colour alone; the pill carries an aria-label so
// screen readers announce the dimension and state.
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { AGENT_TONE, DISPLAY_TONE, EXECUTION_TONE, PROBE_TONE, FAULT_TONE, type Tone } from '../../lib/targetStatus'

const props = defineProps<{
  dim: 'display' | 'execution' | 'probe' | 'fault' | 'agent'
  state: string
  // Optional native tooltip (e.g. the stale window explanation on a stale badge).
  title?: string
}>()

const TONE_MAPS: Record<typeof props.dim, Record<string, Tone>> = {
  display: DISPLAY_TONE,
  execution: EXECUTION_TONE,
  probe: PROBE_TONE,
  fault: FAULT_TONE,
  agent: AGENT_TONE,
}
const { t, te } = useI18n()
const tone = computed<Tone>(() => TONE_MAPS[props.dim][props.state] ?? 'unknown')
const labelKey = computed(() => `targetStatus.${props.dim}.${props.state}`)
const label = computed(() => te(labelKey.value) ? t(labelKey.value) : props.state)
</script>

<template>
  <span class="pill" :class="`is-${tone}`" :aria-label="label" :title="title">{{ label }}</span>
</template>

<style scoped>
.pill {
  display: inline-flex;
  align-items: center;
  font-size: 12px;
  padding: 2px 9px;
  border-radius: 999px;
  border: 1px solid transparent;
  white-space: nowrap;
}
.pill.is-good {
  color: var(--color-success-text);
  border-color: color-mix(in oklch, var(--color-success) 40%, transparent);
  background: color-mix(in oklch, var(--color-success) 14%, transparent);
}
.pill.is-bad {
  color: var(--color-danger-text);
  border-color: color-mix(in oklch, var(--color-danger) 40%, transparent);
  background: color-mix(in oklch, var(--color-danger) 14%, transparent);
}
.pill.is-warn {
  color: var(--color-warning-text);
  border-color: color-mix(in oklch, var(--color-warning) 40%, transparent);
  background: color-mix(in oklch, var(--color-warning) 14%, transparent);
}
.pill.is-unknown {
  color: var(--text-dim);
  border-color: var(--border-strong);
}
</style>

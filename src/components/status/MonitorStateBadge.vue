<script setup lang="ts">
// A single authoritative target-status enum value as a coloured, always-labelled
// pill (STATUS-001). `dim` selects which dimension the `state` belongs to, which
// picks both the tone map and the i18n family (`targetStatus.<dim>.<state>`).
// State is text + colour, never colour alone; the pill carries an aria-label so
// screen readers announce the dimension and state.
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { AGENT_TONE, DISPLAY_TONE, EXECUTION_TONE, PROBE_TONE, RULE_TONE, type Tone } from '../../lib/targetStatus'

const props = defineProps<{
  dim: 'display' | 'execution' | 'probe' | 'rule' | 'agent'
  state: string
  // Optional native tooltip (e.g. the stale window explanation on a stale badge).
  title?: string
}>()

const TONE_MAPS: Record<typeof props.dim, Record<string, Tone>> = {
  display: DISPLAY_TONE,
  execution: EXECUTION_TONE,
  probe: PROBE_TONE,
  rule: RULE_TONE,
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
  color: #6ee7b7;
  border-color: rgba(52, 211, 153, 0.4);
  background: rgba(52, 211, 153, 0.1);
}
.pill.is-bad {
  color: #fca5a5;
  border-color: rgba(248, 113, 113, 0.4);
  background: rgba(248, 113, 113, 0.1);
}
.pill.is-warn {
  color: #fcd34d;
  border-color: rgba(251, 191, 36, 0.4);
  background: rgba(251, 191, 36, 0.1);
}
.pill.is-unknown {
  color: var(--text-dim);
  border-color: var(--border-strong);
}
</style>

<script setup lang="ts">
// A monitor's per-agent state as a coloured pill, extending the good/bad/unknown
// tone scheme used across the status grid. `agent_offline` is not a state of its
// own here — it renders as an ADDITIONAL chip beside the permission/probe state
// (an offline agent can still be permission_blocked), so pass `offline` alongside.
import { computed } from 'vue'

export type MonitorState =
  | 'active'
  | 'probe_failed'
  | 'permission_blocked'
  | 'target_blocked'
  | 'unsupported'

const props = defineProps<{ state: MonitorState; offline?: boolean }>()

type Tone = 'good' | 'bad' | 'unknown'
const TONES: Record<MonitorState, Tone> = {
  active: 'good',
  probe_failed: 'bad',
  permission_blocked: 'bad',
  target_blocked: 'unknown',
  unsupported: 'unknown',
}
const tone = computed<Tone>(() => TONES[props.state])
</script>

<template>
  <span class="state-badges">
    <span class="pill" :class="`is-${tone}`">{{ $t(`monitorState.${state}`) }}</span>
    <span v-if="offline" class="pill is-unknown offline">{{ $t('monitorState.agent_offline') }}</span>
  </span>
</template>

<style scoped>
.state-badges {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.pill {
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
.pill.is-unknown {
  color: var(--text-dim);
  border-color: var(--border-strong);
}
.pill.offline {
  border-style: dashed;
}
</style>

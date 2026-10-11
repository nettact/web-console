<script setup lang="ts">
// A route-monitor state as an always-labelled pill. The "recent change" state
// uses the informational tone on purpose — a route change is news, not an alarm —
// so it never borrows the warning/danger colours the abnormal states use.
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { routeStateTone, type RouteTargetState } from '../../lib/routeStatus'

const props = defineProps<{ state: RouteTargetState }>()
const { t } = useI18n()
const tone = computed(() => routeStateTone(props.state))
const label = computed(() => t(`route.state.${props.state}`))
</script>

<template>
  <span class="route-state" :class="`is-${tone}`" :title="t(`route.stateHint.${state}`)">{{ label }}</span>
</template>

<style scoped>
.route-state {
  display: inline-flex;
  align-items: center;
  padding: 2px 9px;
  border: 1px solid transparent;
  border-radius: var(--radius-pill);
  font-size: 12px;
  white-space: nowrap;
}
.route-state.is-ok {
  color: var(--color-success-text);
  border-color: color-mix(in oklch, var(--color-success) 40%, transparent);
  background: color-mix(in oklch, var(--color-success) 14%, transparent);
}
.route-state.is-info {
  color: var(--color-info-text);
  border-color: color-mix(in oklch, var(--color-info) 40%, transparent);
  background: color-mix(in oklch, var(--color-info) 14%, transparent);
}
.route-state.is-warning {
  color: var(--color-warning-text);
  border-color: color-mix(in oklch, var(--color-warning) 40%, transparent);
  background: color-mix(in oklch, var(--color-warning) 14%, transparent);
}
.route-state.is-danger {
  color: var(--color-danger-text);
  border-color: color-mix(in oklch, var(--color-danger) 40%, transparent);
  background: color-mix(in oklch, var(--color-danger) 14%, transparent);
}
.route-state.is-neutral {
  color: var(--text-dim);
  border-color: var(--border-strong);
}
</style>

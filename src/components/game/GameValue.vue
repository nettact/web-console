<script setup lang="ts">
// One measurement that may not exist.
//
// A null value renders as a dash carrying the reason it is absent, never as 0:
// "this source cannot see dropped frames" and "this game dropped no frames" are
// different statements, and only one of them is a measurement. The dash is
// hidden from assistive tech in favour of the spoken "not available", because a
// screen reader announcing an em dash tells the listener nothing.
import { useI18n } from 'vue-i18n'
import InfoTip from '../InfoTip.vue'

defineProps<{
  // null = not measured. An empty string is a legitimate rendered value.
  value: string | null
  unit?: string
  // Why the value is missing; shown in the tooltip beside the dash.
  reason?: string
}>()

const { t } = useI18n()
</script>

<template>
  <span v-if="value !== null" class="gv">{{ value }}<span v-if="unit" class="gv-unit">{{ unit }}</span></span>
  <span v-else class="gv gv-na">
    <span aria-hidden="true">—</span>
    <span class="sr-only">{{ t('gameRuns.notAvailable') }}</span>
    <InfoTip v-if="reason" :text="reason" />
  </span>
</template>

<style scoped>
.gv {
  font-variant-numeric: tabular-nums;
}
.gv-unit {
  margin-left: 3px;
  color: var(--text-muted);
  font-size: 0.82em;
}
.gv-na {
  color: var(--text-muted);
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
</style>

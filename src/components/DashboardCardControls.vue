<script setup lang="ts">
import type { DashboardCardSize } from '../lib/dashboardLayout'

defineProps<{
  title: string
  size: DashboardCardSize
  sizes: readonly DashboardCardSize[]
  first: boolean
  last: boolean
}>()

const emit = defineEmits<{
  resize: [size: DashboardCardSize]
  move: [offset: number]
  remove: []
  'pointer-drag': [event: PointerEvent]
}>()
</script>

<template>
  <div class="dashboard-card-controls" @mousedown.stop @click.stop>
    <span class="direct-drag-handle" :title="$t('dashboard.layoutDragWidget')" aria-hidden="true" @pointerdown.prevent.stop="emit('pointer-drag', $event)">
      <i></i><i></i><i></i><i></i><i></i><i></i>
    </span>
    <span class="control-title">{{ title }}</span>
    <div v-if="sizes.length > 1" class="ratio-buttons" :aria-label="$t('dashboard.layoutSize')">
      <button
        v-for="candidate in sizes"
        :key="candidate"
        type="button"
        :class="{ active: candidate === size }"
        :title="$t(`dashboard.layoutSize_${candidate}`)"
        @click="emit('resize', candidate)"
      >
        <span :class="`ratio-icon is-${candidate}`"></span>
      </button>
    </div>
    <div class="card-order-buttons">
      <button type="button" :disabled="first" :aria-label="$t('dashboard.layoutMovePrevious')" @click="emit('move', -1)">&#8592;</button>
      <button type="button" :disabled="last" :aria-label="$t('dashboard.layoutMoveNext')" @click="emit('move', 1)">&#8594;</button>
    </div>
    <button class="remove-card-button" type="button" :aria-label="$t('dashboard.layoutRemoveWidget')" @click="emit('remove')">&#215;</button>
  </div>
</template>

<style scoped>
/* Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V4
 * component: dashboard edit controls · design-system: design.md
 */
.dashboard-card-controls {
  position: absolute;
  top: 8px;
  right: 8px;
  left: 8px;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  min-height: 54px;
  padding: 4px 5px 4px 9px;
  color: var(--color-ink);
  border: 1px solid color-mix(in srgb, var(--color-accent) 38%, var(--color-rule));
  border-radius: var(--radius-input);
  background: var(--color-glass-strong);
  box-shadow: var(--shadow-card);
  backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
}
.direct-drag-handle { display: grid; grid-template-columns: repeat(2, 3px); gap: 2px; padding: 5px 3px; cursor: grab; touch-action: none; }
.direct-drag-handle i { width: 3px; height: 3px; border-radius: 50%; background: var(--color-muted); }
.control-title { min-width: 0; margin-right: auto; overflow: hidden; font-size: 10px; font-weight: 750; text-overflow: ellipsis; white-space: nowrap; }
.ratio-buttons, .card-order-buttons { display: flex; gap: 3px; }
button { display: grid; width: 44px; height: 44px; place-items: center; padding: 0; color: var(--color-muted); border: 1px solid var(--color-rule); border-radius: var(--radius-xs); background: var(--color-glass-subtle); cursor: pointer; }
button:hover, button.active { color: var(--color-accent-text); border-color: var(--color-accent); background: color-mix(in srgb, var(--color-accent) 14%, transparent); }
button:focus-visible { outline: 2px solid var(--color-focus); outline-offset: 2px; }
button:disabled { opacity: .3; cursor: default; }
.ratio-icon { display: block; height: 8px; border: 1.5px solid currentColor; border-radius: 2px; }
.ratio-icon.is-compact { width: 8px; }
.ratio-icon.is-medium { width: 14px; }
.ratio-icon.is-wide { width: 20px; }
.ratio-icon.is-tall { width: 13px; height: 15px; }
.remove-card-button { color: var(--color-danger-text); font-size: 17px; }
.remove-card-button:hover,
.remove-card-button:focus-visible { color: var(--color-danger-action-text); border-color: var(--color-danger-action-bg); background: var(--color-danger-action-bg); }
@media (max-width: 560px) {
  .control-title { display: none; }
  .dashboard-card-controls { left: auto; }
}
</style>

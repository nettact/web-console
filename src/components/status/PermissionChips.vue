<script setup lang="ts">
// A labelled row of permission chips (supported / granted / effective). Used on
// the Agents list rows and detail. Chips render the localized permission name; a
// title carries the raw ID for operators who know it.
import { usePermissionMeta } from '../../composables/usePermissionMeta'

defineProps<{ label: string; ids: string[]; tone?: 'neutral' | 'granted' | 'effective' }>()

const { permLabel } = usePermissionMeta()
</script>

<template>
  <div class="perm-list">
    <span class="perm-label">{{ label }}</span>
    <span v-if="!ids.length" class="perm-none">{{ $t('permission.none') }}</span>
    <span v-for="id in ids" :key="id" class="chip" :class="`is-${tone || 'neutral'}`" :title="id">
      {{ permLabel(id) }}
    </span>
  </div>
</template>

<style scoped>
.perm-list {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.perm-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
  margin-right: 2px;
}
.perm-none {
  font-size: 12px;
  color: var(--text-muted);
}
.chip {
  font-size: 11.5px;
  padding: 1px 8px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--border-strong);
  background: var(--surface-2);
  color: var(--text-dim);
  white-space: nowrap;
}
.chip.is-granted {
  border-color: rgba(56, 189, 248, 0.4);
  background: var(--primary-soft, rgba(56, 189, 248, 0.1));
  color: var(--primary);
}
.chip.is-effective {
  border-color: rgba(52, 211, 153, 0.4);
  background: rgba(52, 211, 153, 0.1);
  color: #6ee7b7;
}
</style>

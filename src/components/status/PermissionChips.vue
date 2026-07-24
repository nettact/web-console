<script setup lang="ts">
// A labelled row of permission chips (supported / granted / effective / blocked).
// Used on the Agents list rows and detail. Chips render the localized permission
// name; the title carries the raw ID for operators who know it, except for
// `blocked` chips (granted but not supported by this platform/build), whose
// title explains why instead.
import { useI18n } from 'vue-i18n'
import { usePermissionMeta } from '../../composables/usePermissionMeta'

const props = defineProps<{ label: string; ids: string[]; tone?: 'neutral' | 'granted' | 'effective' | 'blocked' }>()

const { t } = useI18n()
const { permLabel } = usePermissionMeta()

const chipTitle = (id: string): string =>
  props.tone === 'blocked' ? t('permission.blockedTitle', { name: permLabel(id) }) : id
</script>

<template>
  <div class="perm-list">
    <span class="perm-label">{{ label }}</span>
    <span v-if="!ids.length" class="perm-none">{{ $t('permission.none') }}</span>
    <span v-for="id in ids" :key="id" class="chip" :class="`is-${tone || 'neutral'}`" :title="chipTitle(id)">
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
.chip.is-blocked {
  border-color: rgba(248, 113, 113, 0.4);
  background: var(--danger-soft, rgba(248, 113, 113, 0.1));
  color: var(--danger, #f87171);
}
</style>

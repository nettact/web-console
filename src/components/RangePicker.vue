<script setup lang="ts">
// Segmented time-range selector (1h/6h/24h/7d/30d), v-model bound to the range in
// seconds. Shared by the Host Metrics and Target Status pages.
import { useI18n } from 'vue-i18n'
import { RANGES } from '../lib/metricMeta'

const { t } = useI18n()
const model = defineModel<number>({ required: true })
const emit = defineEmits<{ change: [number] }>()

function pick(sec: number) {
  if (model.value === sec) return
  model.value = sec
  emit('change', sec)
}
</script>

<template>
  <div class="segmented">
    <button v-for="r in RANGES" :key="r.sec" :class="{ active: model === r.sec }" @click="pick(r.sec)">
      {{ t(r.label) }}
    </button>
  </div>
</template>

<style scoped>
.segmented {
  display: inline-flex;
  padding: 3px;
  gap: 2px;
  background: var(--input-bg);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
}
.segmented button {
  border: none;
  background: transparent;
  color: var(--text-dim);
  font: inherit;
  font-size: 13px;
  padding: 6px 12px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s;
}
.segmented button:hover {
  color: var(--text);
}
.segmented button.active {
  color: #04121c;
  background: linear-gradient(180deg, #59c7fb, var(--primary-strong));
  font-weight: 600;
}
</style>

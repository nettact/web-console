<script setup lang="ts">
// An AS path as a left-to-right chain of networks: AS number, name, country.
// When `diff` is supplied (from diffASPaths), each network carries its state —
// 'removed' on the old path, 'added' on the new one — so a change reads as which
// carriers left and joined the route, not as two lists to compare by eye.
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ASHop } from '../../api'
import { asLabel, type DiffItem } from '../../lib/routePath'

const props = defineProps<{
  path?: ASHop[]
  diff?: DiffItem[]
  compact?: boolean
}>()

const { t } = useI18n()
const items = computed<DiffItem[]>(() =>
  props.diff ?? (props.path ?? []).map((hop) => ({ hop, state: 'same' as const })),
)
</script>

<template>
  <ol v-if="items.length" class="as-chain" :class="{ compact }">
    <template v-for="(it, i) in items" :key="`${i}-${it.hop.asn}`">
      <li v-if="i > 0" class="as-sep" aria-hidden="true">→</li>
      <li class="as-node" :class="`is-${it.state}`">
        <span class="as-num mono">{{ asLabel(it.hop.asn) }}</span>
        <span v-if="it.hop.as_name" class="as-name" :title="it.hop.as_name">{{ it.hop.as_name }}</span>
        <span v-if="it.hop.as_country && !compact" class="as-cc">{{ it.hop.as_country }}</span>
      </li>
    </template>
  </ol>
  <p v-else class="hint tiny as-empty">{{ t('route.asPathEmpty') }}</p>
</template>

<style scoped>
.as-chain {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.as-node {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  max-width: 100%;
  padding: 4px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  background: var(--surface-2);
  font-size: 12px;
}
.as-sep {
  color: var(--text-muted);
  font-size: 12px;
}
.as-num {
  color: var(--text);
  font-weight: 600;
}
.as-name {
  overflow: hidden;
  max-width: 220px;
  color: var(--text-dim);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.compact .as-name {
  max-width: 140px;
}
.as-cc {
  color: var(--text-muted);
  font-size: 11px;
}
.is-removed {
  border-color: color-mix(in oklch, var(--color-danger) 45%, transparent);
  background: var(--danger-soft);
}
.is-removed .as-num {
  color: var(--color-danger-text);
  text-decoration: line-through;
}
.is-added {
  border-color: color-mix(in oklch, var(--color-success) 45%, transparent);
  background: var(--success-soft);
}
.is-added .as-num {
  color: var(--color-success-text);
}
.as-empty {
  margin: 0;
}
</style>

<script setup lang="ts">
// One normalized route path as a hop table: TTL / IP / hostname / AS / network /
// country. Consecutive hops inside the same autonomous system share a tinted
// block so the carrier boundaries read at a glance; the AS columns print once
// per block. A TTL nobody answered renders as "*" — a silent router, not
// evidence of a break. Optional `highlight` marks TTLs that differ from a path
// this one is being compared against.
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { RouteHopView } from '../../api'
import { asLabel, groupHopsByAS } from '../../lib/routePath'

const props = defineProps<{
  hops: RouteHopView[]
  highlight?: Set<number>
  compact?: boolean
}>()

const { t } = useI18n()
const rows = computed(() => groupHopsByAS(props.hops))

// The AS-name/country shown for a block: from the first responder in it that
// carries one.
function asMeta(groupId: number): { name: string; country: string } {
  for (const r of rows.value) {
    if (r.groupId !== groupId) continue
    for (const resp of r.hop.responders) {
      if (resp.asn != null && resp.asn === r.asn) return { name: resp.as_name, country: resp.as_country }
    }
  }
  return { name: '', country: '' }
}
</script>

<template>
  <div class="route-hops-wrap">
    <table class="route-hops" :class="{ compact }" :aria-label="t('route.hopTableAria')">
      <thead>
        <tr>
          <th scope="col">{{ t('route.th.ttl') }}</th>
          <th scope="col">{{ t('route.th.ip') }}</th>
          <th v-if="!compact" scope="col">{{ t('route.th.hostname') }}</th>
          <th scope="col">{{ t('route.th.as') }}</th>
          <th scope="col">{{ t('route.th.asName') }}</th>
          <th v-if="!compact" scope="col">{{ t('route.th.country') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in rows"
          :key="row.hop.ttl"
          :class="{
            'band-0': row.band === 0,
            'band-1': row.band === 1,
            'group-start': row.groupStart,
            differs: highlight?.has(row.hop.ttl),
          }"
        >
          <th scope="row" class="ttl">{{ row.hop.ttl }}</th>
          <template v-if="row.hop.timeout || !row.hop.responders.length">
            <td class="ip">
              <span class="star" :title="t('route.timeoutHop')" :aria-label="t('route.timeoutHop')">*</span>
            </td>
            <td v-if="!compact"></td>
          </template>
          <template v-else>
            <td class="ip mono">
              <span v-for="r in row.hop.responders" :key="r.ip" class="resp">{{ r.ip }}</span>
            </td>
            <td v-if="!compact" class="host mono">
              <span v-for="r in row.hop.responders" :key="r.ip" class="resp">{{ r.hostname || '—' }}</span>
            </td>
          </template>
          <template v-if="row.groupStart">
            <td class="as mono">
              <template v-if="row.asn != null">{{ asLabel(row.asn) }}</template>
              <span v-else-if="!row.hop.timeout && row.hop.responders.length" class="muted">{{ t('route.privateAddr') }}</span>
            </td>
            <td class="as-name">{{ row.asn != null ? asMeta(row.groupId).name : '' }}</td>
            <td v-if="!compact" class="country">{{ row.asn != null ? asMeta(row.groupId).country : '' }}</td>
          </template>
          <template v-else>
            <td class="as cont" aria-hidden="true"></td>
            <td class="as-name cont" aria-hidden="true"></td>
            <td v-if="!compact" class="country cont" aria-hidden="true"></td>
          </template>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.route-hops-wrap {
  overflow-x: auto;
}
table.route-hops {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.route-hops th,
.route-hops td {
  text-align: left;
  padding: 5px 9px;
  vertical-align: top;
}
.route-hops thead th {
  color: var(--text-muted);
  font-weight: 600;
  border-bottom: 1px solid var(--border);
}
.route-hops tbody tr.group-start > * {
  border-top: 1px solid var(--border);
}
.route-hops tbody tr.band-0 > * {
  background: var(--surface-2);
}
.route-hops tbody tr.band-1 > * {
  background: color-mix(in oklch, var(--color-accent) 7%, transparent);
}
.route-hops tbody tr.differs > * {
  background: color-mix(in oklch, var(--color-warning) 18%, transparent);
}
.route-hops tbody tr.differs > .ttl {
  box-shadow: inset 3px 0 0 var(--color-warning);
}
.ttl {
  width: 40px;
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
}
.resp {
  display: block;
}
.ip {
  color: var(--text);
}
.host {
  color: var(--text-dim);
  overflow-wrap: anywhere;
}
.as {
  color: var(--text);
  white-space: nowrap;
}
.as-name {
  color: var(--text-dim);
}
.country {
  color: var(--text-muted);
}
.muted {
  color: var(--text-muted);
  font-family: inherit;
}
.star {
  color: var(--text-muted);
  font-weight: 700;
}
</style>

<script setup lang="ts">
// Confirmed route changes of one route monitor, newest first. A change is the
// server's verdict after the new AS path held for several consecutive checks, so
// the list holds real re-routes, never one-off detours. It is informational: the
// items use the info tone, not a warning colour — a moved path is not a fault.
//
// Used three ways: the full, filterable, pageable timeline (target "changes"
// tab), a short preview across all Agents (target overview), and one Agent's
// timeline (Agent view history).
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { api, type RouteChange } from '../../api'
import { toDateLocale } from '../../i18n'
import { diffASPaths, fmtMs, rttDeltas } from '../../lib/routePath'
import ASPathChain from './ASPathChain.vue'
import RouteChangeDetail from './RouteChangeDetail.vue'

const props = withDefaults(defineProps<{
  targetId: string
  // '' lists every Agent's changes.
  agentId?: string
  // When given (and more than one), an Agent filter is shown.
  agents?: Array<{ agent_id: string; agent_name: string }>
  pageSize?: number
  paged?: boolean
  // Print the Agent on each item (lists spanning several Agents).
  showAgent?: boolean
  // Hide the rule explainer (short previews).
  preview?: boolean
  // Changing this re-fetches (e.g. the summary saw a newer change).
  refreshKey?: string
}>(), {
  agentId: '',
  agents: () => [],
  pageSize: 20,
  paged: true,
  showAgent: false,
  preview: false,
  refreshKey: '',
})
const emit = defineEmits<{ 'update:agentId': [value: string] }>()

const { t, te, locale } = useI18n()

const changes = ref<RouteChange[]>([])
const loading = ref(false)
const error = ref('')
const more = ref(false)
const open = ref<number | null>(null)
let seq = 0

async function load(append = false) {
  const my = ++seq
  loading.value = true
  error.value = ''
  try {
    const before = append ? changes.value[changes.value.length - 1]?.confirmed_at : undefined
    const res = await api.targetRouteChanges(props.targetId, {
      agent_id: props.agentId || undefined,
      before,
      limit: props.pageSize,
    })
    if (my !== seq) return
    const page = res.changes ?? []
    changes.value = append ? [...changes.value, ...page] : page
    more.value = props.paged && page.length >= props.pageSize
  } catch (e) {
    if (my !== seq) return
    error.value = String((e as Error).message || e)
  } finally {
    if (my === seq) loading.value = false
  }
}

watch(() => [props.targetId, props.agentId, props.refreshKey], () => {
  open.value = null
  load()
}, { immediate: true })

const showFilter = computed(() => props.agents.length > 1)
const fmtTime = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleString(toDateLocale(locale.value), { hour12: false }) : '—'
function kindLabel(c: RouteChange): string {
  const key = `route.kind.${c.kind}`
  return te(key) ? t(key) : c.kind
}
function segmentLabel(c: RouteChange): string {
  const key = `route.segment.${c.segment}`
  return te(key) ? t(key) : c.segment
}
function toggle(id: number) {
  open.value = open.value === id ? null : id
}
</script>

<template>
  <section class="route-change-timeline" :aria-label="t('route.changes')">
    <div v-if="showFilter || !preview" class="timeline-toolbar">
      <p v-if="!preview" class="hint tiny">{{ t('route.changesRule') }}</p>
      <label v-if="showFilter" class="agent-filter">
        <span>{{ t('route.agentFilter') }}</span>
        <select :value="agentId" @change="emit('update:agentId', ($event.target as HTMLSelectElement).value)">
          <option value="">{{ t('route.allAgents') }}</option>
          <option v-for="a in agents" :key="a.agent_id" :value="a.agent_id">{{ a.agent_name || a.agent_id }}</option>
        </select>
      </label>
    </div>

    <p v-if="error" class="err" role="alert">{{ t('route.loadErr', { err: error }) }}</p>
    <p v-else-if="!changes.length && loading" class="hint">{{ t('route.loading') }}</p>
    <p v-else-if="!changes.length" class="hint">{{ t('route.changesEmpty') }}</p>
    <ol v-else class="change-list">
      <li v-for="c in changes" :key="c.id" class="change-item">
        <div class="change-head">
          <time :datetime="c.confirmed_at">{{ fmtTime(c.confirmed_at) }}</time>
          <span v-if="showAgent" class="change-agent">{{ c.agent_name || c.agent_id }}</span>
          <span class="tag tag-info">{{ kindLabel(c) }}</span>
          <span class="tag">{{ segmentLabel(c) }}</span>
          <span v-if="c.diverge_ttl != null" class="hint tiny">{{ t('route.divergeAt', { ttl: c.diverge_ttl }) }}</span>
        </div>
        <div class="change-paths">
          <div class="change-path">
            <span class="path-label">{{ t('route.oldPath') }}</span>
            <ASPathChain :diff="diffASPaths(c.from_as_path, c.to_as_path).from" compact />
          </div>
          <div class="change-path">
            <span class="path-label">{{ t('route.newPath') }}</span>
            <ASPathChain :diff="diffASPaths(c.from_as_path, c.to_as_path).to" compact />
          </div>
        </div>
        <dl class="change-rtt">
          <div v-for="q in (['p50', 'p95'] as const)" :key="q">
            <dt>{{ t(`route.${q}`) }}</dt>
            <dd>
              {{ fmtMs(q === 'p50' ? c.rtt_before?.p50_ms : c.rtt_before?.p95_ms) }}
              →
              {{ fmtMs(q === 'p50' ? c.rtt_after?.p50_ms : c.rtt_after?.p95_ms) }}
              <span class="delta" :class="`delta-${rttDeltas(c.rtt_before, c.rtt_after)[q].tone}`">
                ({{ rttDeltas(c.rtt_before, c.rtt_after)[q].text }})
              </span>
            </dd>
          </div>
        </dl>
        <button type="button" class="btn btn-ghost" :aria-expanded="open === c.id" @click="toggle(c.id)">
          {{ open === c.id ? t('route.hideDetail') : t('route.viewDetail') }}
        </button>
        <RouteChangeDetail v-if="open === c.id" :change-id="c.id" />
      </li>
    </ol>
    <button v-if="more" type="button" class="btn load-more" :disabled="loading" @click="load(true)">
      {{ t('route.loadMore') }}
    </button>
  </section>
</template>

<style scoped>
.route-change-timeline {
  display: grid;
  gap: var(--space-2xs);
  min-width: 0;
}
.timeline-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2xs);
}
.timeline-toolbar .hint {
  margin: 0;
}
.agent-filter {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2xs);
  color: var(--color-muted);
  font-size: var(--text-xs);
}
.agent-filter select {
  min-height: 36px;
}
.change-list {
  display: grid;
  gap: var(--space-2xs);
  margin: 0;
  padding: 0;
  list-style: none;
}
.change-item {
  display: grid;
  gap: 8px;
  min-width: 0;
  padding: var(--space-2xs) var(--space-xs);
  border: 1px solid var(--border);
  border-left: 3px solid var(--color-info);
  border-radius: var(--radius-sm);
  background: var(--surface);
}
.change-item > .btn {
  justify-self: start;
}
.change-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
}
.change-head time {
  color: var(--text);
  font-variant-numeric: tabular-nums;
}
.change-agent {
  color: var(--text-dim);
  font-weight: 600;
}
.tag {
  display: inline-flex;
  align-items: center;
  padding: 2px 9px;
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  color: var(--text-dim);
  background: var(--surface-2);
  font-size: 12px;
  white-space: nowrap;
}
.tag-info {
  color: var(--color-info-text);
  border-color: color-mix(in oklch, var(--color-info) 40%, transparent);
  background: color-mix(in oklch, var(--color-info) 14%, transparent);
}
.change-paths {
  display: grid;
  gap: 6px;
}
.change-path {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
}
.path-label {
  color: var(--text-muted);
  font-size: 12px;
}
.change-rtt {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 22px;
  margin: 0;
}
.change-rtt > div {
  display: flex;
  gap: 8px;
  font-size: 12.5px;
}
.change-rtt dt {
  color: var(--text-muted);
}
.change-rtt dd {
  margin: 0;
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
}
.delta-worse {
  color: var(--color-danger-text);
}
.delta-better {
  color: var(--color-success-text);
}
.delta-same,
.delta-unknown {
  color: var(--text-muted);
}
.load-more {
  justify-self: start;
}
</style>

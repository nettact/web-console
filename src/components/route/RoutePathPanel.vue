<script setup lang="ts">
// The current path of one route monitor, per Agent. A monitor can run on several
// Agents and each sees its own path, so the panel shows one at a time: pick an
// Agent, then read its AS chain, the current epoch's facts and the hop table.
// The change history lives in RouteChangeTimeline; this panel is only "where
// does the traffic go right now".
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { api, type RouteAgentView, type RouteOverview } from '../../api'
import { toDateLocale } from '../../i18n'
import { fmtMs, fmtRatio, humanizeSpan, type SpanUnits } from '../../lib/routePath'
import ASPathChain from './ASPathChain.vue'
import RouteHopTable from './RouteHopTable.vue'

const props = defineProps<{
  targetId: string
  // Optional preferred Agent; '' (or unknown) picks the first one with a route.
  agentId?: string
}>()
const emit = defineEmits<{ 'update:agentId': [value: string] }>()

const { t, te, locale } = useI18n()

const overview = ref<RouteOverview | null>(null)
const loading = ref(false)
const error = ref('')
const current = ref(props.agentId || '')
let seq = 0

async function load() {
  const my = ++seq
  loading.value = true
  error.value = ''
  try {
    const o = await api.targetRoute(props.targetId)
    if (my !== seq) return
    overview.value = o
    if (!o.agents.some((a) => a.agent_id === current.value)) {
      // Prefer an Agent that actually has a route to show.
      current.value = (o.agents.find((a) => a.current) ?? o.agents[0])?.agent_id ?? ''
    }
  } catch (e) {
    if (my !== seq) return
    error.value = String((e as Error).message || e)
  } finally {
    if (my === seq) loading.value = false
  }
}

watch(() => props.targetId, () => {
  overview.value = null
  load()
}, { immediate: true })
watch(() => props.agentId, (next) => {
  if (next && next !== current.value) current.value = next
})

function pick(id: string) {
  current.value = id
  emit('update:agentId', id)
}

const agents = computed<RouteAgentView[]>(() => overview.value?.agents ?? [])
const agent = computed(() => agents.value.find((a) => a.agent_id === current.value) ?? null)
const epoch = computed(() => agent.value?.current ?? null)
const path = computed(() => agent.value?.path ?? null)

function statusLabel(s: RouteAgentView['status']): string {
  // Collecting / permission blocked / unsupported already have console-wide
  // wording; only the route-specific states need their own.
  const shared = `monitorState.${s}`
  if (s !== 'pending' && te(shared)) return t(shared)
  return t(`route.status.${s}`)
}
function statusTone(s: RouteAgentView['status']): string {
  if (s === 'active') return 'ok'
  if (s === 'pending') return 'neutral'
  return 'bad'
}
const statusExplain = computed(() => {
  const s = agent.value?.status
  if (!s || s === 'active') return ''
  const key = `route.statusExplain.${s}`
  return te(key) ? t(key) : ''
})

const units = computed<SpanUnits>(() => ({
  d: t('route.unit.d'),
  h: t('route.unit.h'),
  m: t('route.unit.m'),
  lessThanMinute: t('route.unit.lessThanMinute'),
}))
const fmtTime = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleString(toDateLocale(locale.value), { hour12: false }) : '—'
const stableFor = computed(() => {
  const e = epoch.value
  if (!e) return '—'
  const start = new Date(e.start_at).getTime()
  const end = e.end_at ? new Date(e.end_at).getTime() : Date.now()
  if (!Number.isFinite(start) || !Number.isFinite(end)) return '—'
  return humanizeSpan((end - start) / 1000, units.value)
})
</script>

<template>
  <section class="route-path-panel" :aria-label="t('route.pathTitle')">
    <p v-if="loading && !overview" class="hint">{{ t('route.loading') }}</p>
    <p v-else-if="error" class="err" role="alert">{{ t('route.loadErr', { err: error }) }}</p>

    <template v-else-if="overview">
      <div v-if="!agents.length" class="quiet">
        <strong>{{ t('route.noAgents') }}</strong>
      </div>

      <template v-else>
        <div class="route-toolbar">
          <div class="agent-switch" role="tablist" :aria-label="t('route.agentSwitcherAria')">
            <button
              v-for="a in agents"
              :key="a.agent_id"
              type="button"
              role="tab"
              :aria-selected="a.agent_id === current"
              :class="{ active: a.agent_id === current }"
              @click="pick(a.agent_id)"
            >
              <span class="agent-dot" :class="`tone-${statusTone(a.status)}`" aria-hidden="true"></span>
              <span>{{ a.agent_name || a.agent_id }}</span>
            </button>
          </div>
          <span v-if="overview.asn_db_version" class="hint tiny">{{ t('route.asnDb', { v: overview.asn_db_version }) }}</span>
        </div>

        <template v-if="agent">
          <div class="status-line">
            <span class="badge" :class="statusTone(agent.status)">{{ statusLabel(agent.status) }}</span>
            <span v-if="agent.last_run_at" class="hint tiny">{{ t('route.lastRun') }} · {{ fmtTime(agent.last_run_at) }}</span>
          </div>
          <p v-if="statusExplain" class="status-explain" role="note">{{ statusExplain }}</p>

          <div v-if="!epoch && !path" class="quiet">
            <strong>{{ t('route.noData') }}</strong>
            <span v-if="agent.status === 'active' || agent.status === 'pending'">{{ t('route.noDataHint') }}</span>
          </div>

          <template v-else>
            <section class="route-block">
              <h4>{{ t('route.asPath') }}</h4>
              <ASPathChain :path="path?.as_path ?? epoch?.as_path ?? []" />
            </section>

            <section v-if="epoch" class="route-block">
              <h4>{{ t('route.current') }}</h4>
              <dl class="epoch-facts">
                <div><dt>{{ t('route.since') }}</dt><dd>{{ fmtTime(epoch.start_at) }}</dd></div>
                <div><dt>{{ t('route.stableFor') }}</dt><dd>{{ stableFor }}</dd></div>
                <div><dt>{{ t('route.runs') }}</dt><dd>{{ epoch.run_count }}</dd></div>
                <div v-if="epoch.deviation_count"><dt>{{ t('route.deviations') }}</dt><dd>{{ epoch.deviation_count }}</dd></div>
                <div><dt>{{ t('route.rttP50') }}</dt><dd>{{ fmtMs(epoch.rtt?.p50_ms) }}</dd></div>
                <div><dt>{{ t('route.rttP95') }}</dt><dd>{{ fmtMs(epoch.rtt?.p95_ms) }}</dd></div>
                <div><dt>{{ t('route.reach') }}</dt><dd>{{ fmtRatio(epoch.reached_ratio) }}</dd></div>
                <div><dt>{{ t('route.destIp') }}</dt><dd class="mono">{{ epoch.dest_ip || '—' }}</dd></div>
              </dl>
            </section>

            <section v-if="path" class="route-block">
              <h4>{{ t('route.hops') }}</h4>
              <p v-if="!path.reached" class="hint tiny">{{ t('route.notReached') }}</p>
              <RouteHopTable :hops="path.hops" />
              <p class="hint tiny star-note">{{ t('route.starNote') }}</p>
            </section>
          </template>
        </template>
      </template>
    </template>
  </section>
</template>

<style scoped>
.route-path-panel {
  display: grid;
  gap: var(--space-sm);
  min-width: 0;
}
.route-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2xs);
}
.agent-switch {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.agent-switch button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  padding: 5px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  background: var(--surface-2);
  color: var(--text-dim);
  font: inherit;
  font-size: 12.5px;
  cursor: pointer;
}
.agent-switch button.active {
  border-color: var(--border-hover);
  background: var(--accent-soft);
  color: var(--text);
}
.agent-switch button:focus-visible {
  outline: var(--rule-fine) solid var(--color-focus);
  outline-offset: var(--space-3xs);
}
.agent-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-muted);
}
.agent-dot.tone-ok {
  background: var(--color-success);
}
.agent-dot.tone-bad {
  background: var(--color-danger);
}
.status-line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}
.status-explain {
  margin: 0;
  padding: 8px 11px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  color: var(--text-dim);
  font-size: 12.5px;
  line-height: 1.5;
}
.quiet {
  display: grid;
  gap: 4px;
  padding: var(--space-sm);
  border: 1px dashed var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-dim);
  font-size: 13px;
}
.route-block {
  display: grid;
  gap: var(--space-2xs);
  min-width: 0;
}
.route-block h4 {
  margin: 0;
  font-size: 14px;
}
.route-block .hint {
  margin: 0;
}
.epoch-facts {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 22px;
  margin: 0;
}
.epoch-facts > div {
  display: flex;
  gap: 8px;
  font-size: 12.5px;
}
.epoch-facts dt {
  color: var(--text-muted);
}
.epoch-facts dd {
  margin: 0;
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
}
.star-note {
  margin-top: 2px;
}
</style>

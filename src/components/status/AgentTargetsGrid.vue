<script setup lang="ts">
// By-agent overview: one card per probe target this agent monitors. The current
// state (badge + accent) comes from the authoritative target-status batch for
// this (target, agent) pair; the availability%, outage count and mini state band
// stay metric-based (historical). Clicking a card drills into TargetDetail.
import { ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { api, type Sample, type TargetAgentStatusRow } from '../../api'
import StatusBand from '../StatusBand.vue'
import MonitorStateBadge from './MonitorStateBadge.vue'
import { natCodeLabel } from '../../lib/metricMeta'
import { groupLabel, bandSeriesFor, type BandSeries, type TargetGroup } from '../../lib/targetGroups'
import { agentHeadlineTone } from '../../lib/targetStatus'
import { targetIndex } from '../../targetStatus'
import { availability, toPoints } from '../../lib/timeline'

const props = defineProps<{
  agentId: string
  groups: TargetGroup[]
  rangeSec: number
  // A monitor group to visually highlight and scroll to (issue deep-link landing).
  highlightKey?: string
}>()
const emit = defineEmits<{ select: [TargetGroup] }>()

const { t } = useI18n()

// The authoritative per-agent status for a group's monitor on THIS agent.
function agentRow(g: TargetGroup): TargetAgentStatusRow | undefined {
  if (!g.monitorId) return undefined
  return targetIndex.value.get(g.monitorId)?.agents.find((a) => a.agent_id === props.agentId)
}

const samplesByKey = ref<Record<string, Sample[]>>({})
// NAT groups also carry the categorical NAT type (probe.nat.type), shown as a
// caption — a NAT card's real answer is "what NAT type" while its band/availability
// track binding reachability (probe.nat.ok).
const natTypeByKey = ref<Record<string, Sample[]>>({})
let seq = 0

const groups = computed<TargetGroup[]>(() => props.groups)

// The historical status series each card's band samples (never current-health).
function bandFor(g: TargetGroup): BandSeries | null {
  const b = bandSeriesFor(g.family)
  if (b && g.metrics.some((m) => m.kind === b.kind)) return b
  return null
}
const hasNatType = (g: TargetGroup) => g.family === 'probe.nat' && g.metrics.some((m) => m.kind === 'probe.nat.type')

function fetchKind(g: TargetGroup, kind: string) {
  return api
    .metrics(props.agentId, kind, {
      monitor: g.monitorId,
      target: g.monitorId ? undefined : g.target || undefined,
      limit: 5000,
      sinceSeconds: props.rangeSec,
    })
    .catch(() => [] as Sample[])
}

async function loadStatuses() {
  const cur = ++seq
  const gs = groups.value
  const jobs = gs.map(async (g) => {
    const b = bandFor(g)
    const ok = b ? await fetchKind(g, b.kind) : []
    const natType = hasNatType(g) ? await fetchKind(g, 'probe.nat.type') : []
    return [g.key, ok, natType] as [string, Sample[], Sample[]]
  })
  const results = await Promise.all(jobs)
  if (cur !== seq) return
  const okMap: Record<string, Sample[]> = {}
  const typeMap: Record<string, Sample[]> = {}
  for (const [k, ok, natType] of results) {
    okMap[k] = ok
    typeMap[k] = natType
  }
  samplesByKey.value = okMap
  natTypeByKey.value = typeMap
}

// The latest determinate NAT type code, falling back past a transient "unknown"
// (0) to the most recent real result. Returns null when there is no determinate
// result.
function latestNatCode(samples: Sample[]): number | null {
  const pts = toPoints(samples)
  for (let i = pts.length - 1; i >= 0; i--) if (Math.round(pts[i].v) > 0) return pts[i].v
  return null
}

interface Card {
  group: TargetGroup
  toUp?: (v: number) => number
  tone: 'good' | 'bad' | 'warn' | 'unknown'
  row?: TargetAgentStatusRow
  natType: string | null
  avail: string | null
  outages: number
  samples: Sample[]
}

const cards = computed<Card[]>(() =>
  groups.value.map((g) => {
    const b = bandFor(g)
    const samples = samplesByKey.value[g.key] ?? []
    const now = Date.now()
    const pts = b ? toPoints(samples).map((p) => ({ t: p.t, v: b.toUp(p.v) })) : []
    let outages = 0
    for (let i = 1; i < pts.length; i++) if (pts[i - 1].v >= 0.5 && pts[i].v < 0.5) outages++

    const row = agentRow(g)
    const natType = hasNatType(g)
      ? (() => {
          const code = latestNatCode(natTypeByKey.value[g.key] ?? [])
          return code === null ? null : natCodeLabel('probe.nat.type', code)
        })()
      : null
    return {
      group: g,
      toUp: b?.toUp,
      tone: row ? agentHeadlineTone(row) : 'unknown',
      row,
      natType,
      avail: pts.length ? (availability(pts, now) * 100).toFixed(1) : null,
      outages,
      samples,
    }
  }),
)

watch(() => [props.agentId, props.rangeSec, props.groups], loadStatuses)
onMounted(loadStatuses)
</script>

<template>
  <p v-if="!groups.length" class="hint pad">{{ t('targetStatus.noTargets') }}</p>
  <div v-else class="grid">
    <button v-for="c in cards" :key="c.group.key" class="tcard" :class="[`is-${c.tone}`, { highlight: highlightKey && c.group.key === highlightKey }]" @click="emit('select', c.group)">
      <div class="head">
        <span class="fam">{{ c.group.familyLabel }}</span>
        <span class="badges">
          <template v-if="c.row">
            <MonitorStateBadge dim="execution" :state="c.row.execution_state" />
            <MonitorStateBadge v-if="c.row.probe_state !== 'not_applicable'" dim="probe" :state="c.row.probe_state" />
            <MonitorStateBadge v-if="c.row.rule_state !== 'normal'" dim="rule" :state="c.row.rule_state" />
          </template>
          <span v-else class="pill is-unknown">{{ t('targetStatus.unavailable') }}</span>
        </span>
      </div>
      <div class="target mono">{{ groupLabel(c.group) || t('metrics.localTarget') }}</div>
      <div v-if="c.group.name && c.group.target" class="sub-target mono">{{ c.group.target }}</div>
      <div v-if="c.natType" class="nat-type">{{ t('dashboard.natType') }}: {{ c.natType }}</div>
      <StatusBand :samples="c.samples" :to-up="c.toUp" />
      <div class="foot">
        <span v-if="c.avail !== null">{{ t('targetStatus.thAvailability') }} {{ c.avail }}%</span>
        <span v-if="c.avail !== null">· {{ t('targetStatus.thOutages') }} {{ c.outages }}</span>
        <span v-else class="hint">{{ t('metrics.noDataRange') }}</span>
      </div>
    </button>
  </div>
</template>

<style scoped>
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 14px;
}
.tcard {
  position: relative;
  text-align: left;
  padding: 14px 16px 16px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface-2);
  cursor: pointer;
  font: inherit;
  color: var(--text);
  transition: border-color 0.15s, transform 0.1s;
  overflow: hidden;
}
.tcard::before {
  content: "";
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  opacity: 0.9;
}
.tcard.is-good::before {
  background: var(--success);
}
.tcard.is-bad::before {
  background: var(--danger);
}
.tcard.is-warn::before {
  background: var(--warn, #fbbf24);
}
.tcard.is-unknown::before {
  background: var(--text-dim);
}
.tcard:hover {
  border-color: var(--border-strong);
}
.tcard:active {
  transform: scale(0.995);
}
.tcard.highlight {
  border-color: var(--primary);
  box-shadow: 0 0 0 2px var(--primary-soft, rgba(56, 189, 248, 0.35));
}
.badges {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}
.fam {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-muted);
  flex-shrink: 0;
}
.pill {
  font-size: 12px;
  padding: 2px 9px;
  border-radius: 999px;
  border: 1px solid var(--border-strong);
  color: var(--text-dim);
  white-space: nowrap;
}
.target {
  font-size: 14px;
  margin-bottom: 12px;
  word-break: break-all;
}
.sub-target {
  font-size: 11px;
  color: var(--text-muted);
  margin: -8px 0 12px;
  word-break: break-all;
}
.nat-type {
  font-size: 11.5px;
  color: var(--text-dim);
  margin: -6px 0 10px;
}
.foot {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 10px;
  font-size: 12px;
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
}
.pad {
  padding: 8px 2px;
}
</style>

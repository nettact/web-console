<script setup lang="ts">
// By-agent overview: one card per probe target this agent monitors, showing the
// current up/down state, availability, outage count and a mini status band. Each
// card only fetches its target's primary status series (cheap); clicking a card
// drills into the full TargetDetail.
import { ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { api, type Sample, type MonitorStatusRow } from '../../api'
import StatusBand from '../StatusBand.vue'
import MonitorStateBadge, { type MonitorState } from './MonitorStateBadge.vue'
import { natCodeLabel, natTone, statusSource, type StatusSource } from '../../lib/metricMeta'
import { groupLabel, type TargetGroup } from '../../lib/targetGroups'
import { availability, boolCurrent, toPoints } from '../../lib/timeline'

const props = defineProps<{
  agentId: string
  groups: TargetGroup[]
  rangeSec: number
  // Per-monitor operational block state for THIS agent (permission/target/unsupported),
  // keyed by monitor_id. A blocked monitor emits no metric, so this is the only
  // signal of its state; it overrides the metric-derived pill when present.
  blocked?: Record<string, MonitorStatusRow>
  // Whether this agent is currently offline — rendered as an extra chip beside the
  // per-target state (offline never erases a permission/target block).
  offline?: boolean
  // A monitor group to visually highlight and scroll to (issue deep-link landing).
  highlightKey?: string
}>()
const emit = defineEmits<{ select: [TargetGroup] }>()

const { t } = useI18n()

// The non-active operational state for a group's monitor, if any — drives the
// MonitorStateBadge that replaces the metric pill for blocked monitors.
function blockState(g: TargetGroup): MonitorState | null {
  if (!g.monitorId) return null
  const row = props.blocked?.[g.monitorId]
  if (!row || row.status === 'active') return null
  return row.status as MonitorState
}

const samplesByKey = ref<Record<string, Sample[]>>({})
// NAT groups also carry the categorical NAT type (probe.nat.type), shown in the
// pill in place of a plain up/down — a card's real answer is "what NAT type",
// while its availability/band still track binding reachability (probe.nat.ok).
const natTypeByKey = ref<Record<string, Sample[]>>({})
let seq = 0

const groups = computed<TargetGroup[]>(() => props.groups)

// The status series each card samples, and how to normalize it to 0/1 up.
function sourceFor(g: TargetGroup): StatusSource | null {
  const src = statusSource(g.family)
  if (src && g.metrics.some((m) => m.kind === src.kind)) return src
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
    const src = sourceFor(g)
    const ok = src ? await fetchKind(g, src.kind) : []
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
// (0) to the most recent real result — mirrors the NAT stat card so the grid and
// the drilldown never disagree. Returns null when there is no determinate result.
function latestNatCode(samples: Sample[]): number | null {
  const pts = toPoints(samples)
  for (let i = pts.length - 1; i >= 0; i--) if (Math.round(pts[i].v) > 0) return pts[i].v
  return null
}

interface Card {
  group: TargetGroup
  toUp?: (v: number) => number
  tone: 'good' | 'bad' | 'unknown'
  status: string
  avail: string | null
  outages: number
  samples: Sample[]
}

const cards = computed<Card[]>(() =>
  groups.value.map((g) => {
    const src = sourceFor(g)
    const samples = samplesByKey.value[g.key] ?? []
    const now = Date.now()
    const pts = src ? toPoints(samples).map((p) => ({ t: p.t, v: src.toUp(p.v) })) : []
    const cur = pts.length ? boolCurrent(pts, now) : null
    let outages = 0
    for (let i = 1; i < pts.length; i++) if (pts[i - 1].v >= 0.5 && pts[i].v < 0.5) outages++

    let tone: 'good' | 'bad' | 'unknown'
    let status: string
    if (hasNatType(g)) {
      // NAT: the pill answers "what NAT type" (Full Cone / Symmetric / …) rather
      // than a generic 正常. Availability/band below still reflect reachability.
      const code = latestNatCode(natTypeByKey.value[g.key] ?? [])
      tone = code === null ? 'unknown' : natTone('probe.nat.type', code)
      status = code === null ? t('targetStatus.statusUnknown') : natCodeLabel('probe.nat.type', code)
    } else {
      tone = cur === null ? 'unknown' : cur ? 'good' : 'bad'
      status = cur === null ? t('targetStatus.statusUnknown') : cur ? t('targetStatus.statusNormal') : t('targetStatus.statusInterrupted')
    }
    return {
      group: g,
      toUp: src?.toUp,
      tone,
      status,
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
        <MonitorStateBadge v-if="blockState(c.group)" :state="blockState(c.group)!" :offline="offline" />
        <span v-else class="badges">
          <span class="pill" :class="`is-${c.tone}`">{{ c.status }}</span>
          <span v-if="offline" class="pill is-unknown offline">{{ t('monitorState.agent_offline') }}</span>
        </span>
      </div>
      <div class="target mono">{{ groupLabel(c.group) || t('metrics.localTarget') }}</div>
      <div v-if="c.group.name && c.group.target" class="sub-target mono">{{ c.group.target }}</div>
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
}
.pill.offline {
  border-style: dashed;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
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
  border: 1px solid transparent;
  white-space: nowrap;
}
.pill.is-good {
  color: #6ee7b7;
  border-color: rgba(52, 211, 153, 0.4);
  background: rgba(52, 211, 153, 0.1);
}
.pill.is-bad {
  color: #fca5a5;
  border-color: rgba(248, 113, 113, 0.4);
  background: rgba(248, 113, 113, 0.1);
}
.pill.is-unknown {
  color: var(--text-dim);
  border-color: var(--border-strong);
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

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { onBeforeRouteLeave } from 'vue-router'
import {
  api,
  type Agent,
  type AgentInterfaces,
  type FaultSignal,
  type Device,
  type IncidentSummary,
  type MetricsSummary,
  type ProbeState,
  type Quota,
  type Sample,
  type StatusEvent,
  type TargetStatusRow,
} from '../api'
import DashboardCardControls from '../components/DashboardCardControls.vue'
import DashboardPathCard from '../components/DashboardPathCard.vue'
import DashboardTargetCard from '../components/DashboardTargetCard.vue'
import MetricChart from '../components/MetricChart.vue'
import { toDateLocale } from '../i18n'
import {
  DASHBOARD_CARD_DEFINITIONS,
  MAX_DASHBOARD_CARDS,
  MONITOR_TARGET_CARD_DEFINITION,
  MONITOR_TARGET_CARD_TYPE,
  cloneDashboardLayout,
  dashboardLayoutPreset,
  defaultDashboardLayout,
  dashboardLayoutPayload,
  identifyDashboardLayoutPreset,
  normalizeDashboardLayout,
  type DashboardCardLayout,
  type DashboardLayoutPresetID,
} from '../lib/dashboardLayout'
import { fmtBps, fmtBytes } from '../lib/format'
import { chartColor } from '../lib/chartColor'
import { buildDashboardPath } from '../lib/dashboardPath'
import { agentLabel } from '../lib/agentLabel'
import { natCodeLabel, natTone } from '../lib/metricMeta'
import { formatAvailability, PROBE_TONE } from '../lib/targetStatus'
import { targetStatus } from '../targetStatus'

const { t, te, locale } = useI18n()

const SITE = 'site_default'
const agents = ref<Agent[]>([])
const selected = ref('')
const quota = ref<Quota | null>(null)
const statusHistory = ref<StatusEvent[]>([])
const snapshot = ref<Sample[]>([])
const devices = ref<Device[]>([])
const ifaceData = ref<AgentInterfaces | null>(null)
const faults = ref<FaultSignal[]>([])
const incidentSummary = ref<IncidentSummary | null>(null)
const qualityRttHistory = ref<Sample[]>([])
const qualityLossHistory = ref<Sample[]>([])
const qualityJitterHistory = ref<Sample[]>([])
// Server-side worst-target aggregates backing the quality stat numbers: raw
// observations reduced per timestamp, so P95 is a true percentile rather than
// a percentile of the chart's minute-bucket averages.
const qualitySummary = ref<MetricsSummary | null>(null)
const trafficRxHistory = ref<Sample[]>([])
const trafficTxHistory = ref<Sample[]>([])
const error = ref('')
const loading = ref(true)
const refreshing = ref(false)
const layoutLoading = ref(true)
const layoutSaving = ref(false)
let timer: number | undefined
let historyTimer: number | undefined
let loadSequence = 0
let historySequence = 0
let stopPointerCardDrag: (() => void) | undefined

// The console currently has one authenticated administrator and no lesser
// roles. The server stores one instance-wide layout, so every authenticated
// browser connected to this server sees the same dashboard arrangement.
const savedLayout = ref<DashboardCardLayout[]>(defaultDashboardLayout())
const draftLayout = ref<DashboardCardLayout[]>(defaultDashboardLayout())
const editingLayout = ref(false)
const layoutError = ref('')
const draggingCardID = ref('')
const layoutPresetIDs: readonly DashboardLayoutPresetID[] = ['simple', 'professional']
const targetCardDrawerOpen = ref(false)
const newTargetKind = ref('')
const newTargetID = ref('')
const activeLayout = computed(() => editingLayout.value ? draftLayout.value : savedLayout.value)
const activeLayoutPreset = computed(() => identifyDashboardLayoutPreset(draftLayout.value))
const layoutDirty = computed(() => JSON.stringify(draftLayout.value) !== JSON.stringify(savedLayout.value))
const allCardsHidden = computed(() => activeLayout.value.every((card) => !card.visible))
const hiddenCardDefinitions = computed(() =>
  DASHBOARD_CARD_DEFINITIONS.filter((definition) => !draftLayout.value.find((card) => card.id === definition.id)?.visible),
)
const visibleCardCount = computed(() => draftLayout.value.filter((card) => card.visible).length)
const monitorTargetKindOrder = ['gateway', 'icmp', 'dns', 'http', 'tcp', 'nat'] as const
const availableMonitorKinds = computed(() => monitorTargetKindOrder.filter((kind) =>
  targetStatus.targets.some((target) => target.enabled && target.kind === kind),
))
const newTargetOptions = computed(() => targetStatus.targets.filter((target) =>
  target.enabled && target.kind === newTargetKind.value,
))
const pendingTargetCard = computed(() => newTargetOptions.value.find((target) => target.target_id === newTargetID.value) ?? null)
const visibleTargetCards = computed(() => activeLayout.value.filter((card) => card.visible && card.type === MONITOR_TARGET_CARD_TYPE))
const layoutAtCardLimit = computed(() => draftLayout.value.length >= MAX_DASHBOARD_CARDS)

const cardLayout = (id: string) => activeLayout.value.find((card) => card.id === id)
const cardDefinition = (id: string) => {
  const type = cardLayout(id)?.type ?? id
  return type === MONITOR_TARGET_CARD_TYPE ? MONITOR_TARGET_CARD_DEFINITION : DASHBOARD_CARD_DEFINITIONS.find((card) => card.id === type)!
}
const cardVisible = (id: string) => cardLayout(id)?.visible ?? false
// compact = 3 cols, medium/tall = 6 cols (half row), wide = 12 cols. `tall` also
// claims two grid rows so its chart card renders at double height; narrow-screen
// CSS resets the row span so it degrades to a single stacked full-width card.
const cardGridStyle = (id: string): Record<string, string | number> => {
  const index = activeLayout.value.findIndex((card) => card.id === id)
  const size = cardLayout(id)?.size ?? 'wide'
  const columns = size === 'compact' ? 3 : size === 'medium' || size === 'tall' ? 6 : 12
  const style: Record<string, string | number> = { order: index, gridColumn: `span ${columns}` }
  if (size === 'tall') style.gridRow = 'span 2'
  return style
}
const cardIsTall = (id: string) => cardLayout(id)?.size === 'tall'

function beginLayoutEdit() {
  if (!editingLayout.value) draftLayout.value = cloneDashboardLayout(savedLayout.value)
  layoutError.value = ''
  editingLayout.value = true
}

function openTargetCardDrawer() {
  beginLayoutEdit()
  newTargetKind.value = availableMonitorKinds.value[0] ?? ''
  newTargetID.value = newTargetOptions.value[0]?.target_id ?? ''
  targetCardDrawerOpen.value = true
}

function changeTargetCardKind() {
  newTargetID.value = newTargetOptions.value[0]?.target_id ?? ''
}

function addTargetCard() {
  const target = targetStatus.targets.find((candidate) => candidate.target_id === newTargetID.value && candidate.kind === newTargetKind.value)
  if (!target || layoutAtCardLimit.value) return
  const suffix = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  draftLayout.value.push({
    id: `monitor-target-${suffix}`,
    type: MONITOR_TARGET_CARD_TYPE,
    visible: true,
    size: 'medium',
    target_id: target.target_id,
  })
  targetCardDrawerOpen.value = false
}

function targetForCard(card: DashboardCardLayout): TargetStatusRow | null {
  return targetStatus.targets.find((target) => target.target_id === card.target_id) ?? null
}
const targetCardViews = computed(() => visibleTargetCards.value.map((card) => ({ card, target: targetForCard(card) })))

function samplesForTarget(targetID: string): Sample[] {
  return snapshot.value.filter((sample) => sample.monitor_id === targetID)
}

async function loadServerLayout() {
  try {
    const next = normalizeDashboardLayout(await api.dashboardLayout())
    savedLayout.value = next
    draftLayout.value = cloneDashboardLayout(next)
    layoutError.value = ''
  } catch {
    layoutError.value = t('dashboard.layoutLoadError')
  } finally {
    layoutLoading.value = false
  }
}

async function saveLayout() {
  if (layoutSaving.value) return
  layoutSaving.value = true
  try {
    const stored = await api.updateDashboardLayout(dashboardLayoutPayload(draftLayout.value))
    const next = normalizeDashboardLayout(stored)
    savedLayout.value = next
    draftLayout.value = cloneDashboardLayout(next)
    layoutError.value = ''
    editingLayout.value = false
  } catch {
    layoutError.value = t('dashboard.layoutSaveError')
  } finally {
    layoutSaving.value = false
  }
}

function cancelLayoutEdit() {
  if (layoutDirty.value && !window.confirm(t('dashboard.layoutDiscardConfirm'))) return
  draftLayout.value = cloneDashboardLayout(savedLayout.value)
  layoutError.value = ''
  editingLayout.value = false
}

function applyLayoutPreset(id: DashboardLayoutPresetID) {
  draftLayout.value = dashboardLayoutPreset(id)
  layoutError.value = ''
}

function moveVisibleCard(id: string, offset: number) {
  const visible = draftLayout.value.filter((card) => card.visible)
  const visibleIndex = visible.findIndex((card) => card.id === id)
  const neighbor = visible[visibleIndex + offset]
  if (!neighbor) return
  const currentIndex = draftLayout.value.findIndex((card) => card.id === id)
  const neighborIndex = draftLayout.value.findIndex((card) => card.id === neighbor.id)
  const next = cloneDashboardLayout(draftLayout.value)
  ;[next[currentIndex], next[neighborIndex]] = [next[neighborIndex], next[currentIndex]]
  draftLayout.value = next
}

function visibleCardIndex(id: string): number {
  return draftLayout.value.filter((card) => card.visible).findIndex((card) => card.id === id)
}

function updateCardSize(id: string, size: DashboardCardLayout['size']) {
  const card = draftLayout.value.find((candidate) => candidate.id === id)
  const definition = cardDefinition(id)
  if (card && definition.sizes.includes(size)) card.size = size
}

function removeWidget(id: string) {
  const index = draftLayout.value.findIndex((candidate) => candidate.id === id)
  if (index < 0) return
  if (draftLayout.value[index].type === MONITOR_TARGET_CARD_TYPE) {
    draftLayout.value.splice(index, 1)
  } else {
    draftLayout.value[index].visible = false
  }
}

function addWidget(id: string) {
  const card = draftLayout.value.find((candidate) => candidate.id === id)
  if (card) card.visible = true
}

function startCardDrag(id: string, event: DragEvent) {
  if (!editingLayout.value) return
  draggingCardID.value = id
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', id)
  }
}

function reorderLayoutCard(sourceID: string, targetID: string) {
  const source = draftLayout.value.findIndex((card) => card.id === sourceID)
  const destination = draftLayout.value.findIndex((card) => card.id === targetID)
  if (source < 0 || destination < 0 || source === destination) return
  const next = cloneDashboardLayout(draftLayout.value)
  const [card] = next.splice(source, 1)
  next.splice(destination, 0, card)
  draftLayout.value = next
}

function dropLayoutCard(targetID: string) {
  if (!editingLayout.value) return
  const sourceID = draggingCardID.value
  draggingCardID.value = ''
  reorderLayoutCard(sourceID, targetID)
}

function startPointerCardDrag(id: string, event: PointerEvent) {
  if (!editingLayout.value) return
  stopPointerCardDrag?.()
  draggingCardID.value = id
  ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)

  const move = (nextEvent: PointerEvent) => {
    const target = (document.elementFromPoint(nextEvent.clientX, nextEvent.clientY) as HTMLElement | null)
      ?.closest<HTMLElement>('[data-layout-card]')
    const targetID = target?.dataset.layoutCard
    if (targetID && targetID !== id) reorderLayoutCard(id, targetID)
  }
  const finish = () => {
    draggingCardID.value = ''
    stopPointerCardDrag = undefined
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', finish)
    window.removeEventListener('pointercancel', finish)
  }
  stopPointerCardDrag = finish

  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', finish)
  window.addEventListener('pointercancel', finish)
}

function warnUnsaved(event: BeforeUnloadEvent) {
  if (!editingLayout.value || !layoutDirty.value) return
  event.preventDefault()
  event.returnValue = ''
}

onBeforeRouteLeave(() => {
  if (!editingLayout.value || !layoutDirty.value) return true
  return window.confirm(t('dashboard.layoutLeaveConfirm'))
})

const currentAgent = computed(() => agents.value.find((agent) => agent.id === selected.value) ?? null)
const onlineCount = computed(() => agents.value.filter((agent) => agent.status === 'online').length)

async function loadAgents() {
  try {
    ;[agents.value, quota.value] = await Promise.all([api.agents(), api.quota()])
    // (Re)select when nothing is selected yet, or when the selected agent was
    // deleted — a stale id would pin every metric poll to a gone agent and
    // block auto-selecting newly enrolled ones.
    const stillExists = agents.value.some((a) => a.id === selected.value)
    if ((!selected.value || !stillExists) && agents.value.length) selected.value = agents.value[0].id
    else if (!stillExists) selected.value = ''
  } catch (e) {
    error.value = String((e as Error).message || e)
  } finally {
    loading.value = false
  }
}

async function loadMetrics() {
  if (!selected.value) return
  const sequence = ++loadSequence
  refreshing.value = true
  try {
    const id = selected.value
    const [nextSnapshot, nextDevices, nextHistory, nextIfaces, nextFaults, nextIncidentSummary] = await Promise.all([
      api.latest(id),
      api.listDevices(SITE),
      api.agentStatusHistory(id),
      api.agentInterfaces(id).catch(() => null),
      // Scoped to the selected Agent server-side. Fetching the fleet-wide top 50
      // and filtering here would silently hide this Agent's faults the moment 50
      // others are firing — and the health badge would then read "healthy".
      api.faultSignals({ agent: id, state: 'firing', limit: 200 }).catch(() => [] as FaultSignal[]),
      api.incidents(1, 1).then((page) => page.summary).catch(() => null),
    ])
    if (sequence !== loadSequence) return
    snapshot.value = nextSnapshot
    devices.value = nextDevices
    statusHistory.value = nextHistory
    ifaceData.value = nextIfaces
    faults.value = nextFaults
    incidentSummary.value = nextIncidentSummary
    error.value = ''
  } catch (e) {
    if (sequence === loadSequence) error.value = String((e as Error).message || e)
  } finally {
    if (sequence === loadSequence) refreshing.value = false
  }
}

async function loadHistory() {
  if (!selected.value) return
  const sequence = ++historySequence
  const id = selected.value
  try {
    const opts = { sinceSeconds: 24 * 3600, limit: 1500 }
    const [rtt, loss, jitter, rx, tx, quality] = await Promise.all([
      api.metrics(id, 'probe.icmp.rtt_ms', opts),
      api.metrics(id, 'probe.icmp.loss_pct', opts),
      api.metrics(id, 'probe.icmp.jitter_ms', opts),
      api.metrics(id, 'host.net.rx_bps', opts),
      api.metrics(id, 'host.net.tx_bps', opts),
      // Same worst-target-per-second semantics as aggregateWorst, but computed
      // server-side from raw samples (the chart fetches above are minute
      // buckets past 2h, and a P95 of bucket averages understates spikes).
      api
        .metricsSummary(id, ['probe.icmp.rtt_ms', 'probe.icmp.jitter_ms', 'probe.icmp.loss_pct'], {
          sinceSeconds: 24 * 3600,
          reduce: 'worst',
          excludeTargets: ['gateway'],
        })
        .catch(() => null),
    ])
    if (sequence !== historySequence) return
    qualityRttHistory.value = rtt
    qualityLossHistory.value = loss
    qualityJitterHistory.value = jitter
    trafficRxHistory.value = rx
    trafficTxHistory.value = tx
    qualitySummary.value = quality
  } catch {
    // Keep the last successful history while live cards refresh independently.
  }
}

async function changeAgent() {
  snapshot.value = []
  statusHistory.value = []
  ifaceData.value = null
  qualityRttHistory.value = []
  qualityLossHistory.value = []
  qualityJitterHistory.value = []
  qualitySummary.value = null
  trafficRxHistory.value = []
  trafficTxHistory.value = []
  await Promise.all([loadMetrics(), loadHistory()])
}

const rowKey = (sample: Sample) => sample.monitor_id || sample.target
const byKind = (kind: string) => snapshot.value.filter((sample) => sample.kind === kind)
const byRowKey = (kind: string) => new Map(byKind(kind).map((sample) => [rowKey(sample), sample]))

// Authoritative current probe state for one monitor on the selected agent, from
// the target-status batch (the ONLY source of current health). null when the
// monitor/agent pair is not in the batch (e.g. a monitor-less system series).
function agentProbeState(monitorId: string): ProbeState | null {
  const row = targetStatus.targets.find((t) => t.target_id === monitorId)
  return row?.agents.find((a) => a.agent_id === selected.value)?.probe_state ?? null
}

// Service-badge tone for a current probe state, reusing the authoritative shared
// PROBE_TONE map so a given state paints the same everywhere. healthy→good,
// failed→bad, stale→warn; no_data / not_applicable / a missing batch row are
// neutral (''). Numeric HTTP status and NAT type never drive this tone.
function probeToneClass(ps: ProbeState | null): '' | 'good' | 'bad' | 'warn' {
  if (ps === null) return ''
  const tone = PROBE_TONE[ps]
  return tone === 'unknown' ? '' : tone
}

// NAT reachability chip label from the authoritative probe state. stale is its
// own warn state and is never mislabelled "unreachable"; no_data / not_applicable
// / a missing row read as neutral "—".
function natReachLabel(ps: ProbeState | null): string {
  if (ps === 'healthy') return t('dashboard.reachable')
  if (ps === 'failed') return t('dashboard.unreachable')
  if (ps === 'stale') return t('targetStatus.probe.stale')
  return '—'
}

const publicTargets = computed(() =>
  byKind('probe.icmp.rtt_ms')
    .filter((sample) => sample.target !== 'gateway')
    .sort((a, b) => a.target.localeCompare(b.target) || rowKey(a).localeCompare(rowKey(b))),
)
// Public ICMP targets feeding the 24h quality aggregate, derived from the
// authoritative target-status config (kind 'icmp' — the gateway is its own kind
// with target 'gateway', which the aggregate's excludeTargets:['gateway'] drops)
// scoped to the selected Agent's applicable monitors. NOT from the /latest
// snapshot: a target that just started failing or went stale has no fresh RTT
// sample there yet still counts in the 24h aggregate, so a snapshot-derived note
// would under-report. Sourcing from config keeps this footnote in lockstep with
// the request — it names exactly the set the aggregate covers, and shifts with it
// whenever monitors are added/removed.
const qualityTargetNames = computed(() =>
  [...new Set(
    targetStatus.targets
      .filter((row) => row.kind === 'icmp' && row.agents.some((a) => a.agent_id === selected.value))
      .map((row) => row.target),
  )].sort((a, b) => a.localeCompare(b)),
)
const qualitySourceNote = computed(() => {
  const names = qualityTargetNames.value
  const targets = names.length
    ? t('dashboard.qualitySourceTargets', { list: names.join(locale.value === 'en' ? ', ' : '、') })
    : t('dashboard.qualitySourceTargetsAll')
  return t('dashboard.qualitySourceNote', { targets })
})
const dnsTargets = computed(() =>
  byKind('probe.dns.resolve_ms').sort(
    (a, b) => a.target.localeCompare(b.target) || rowKey(a).localeCompare(rowKey(b)),
  ),
)
const httpRows = computed(() => {
  const status = byRowKey('probe.http.status')
  const latency = byRowKey('probe.http.latency_ms')
  return [...status.keys()].sort().map((key) => ({
    key,
    url: status.get(key)!.target,
    status: status.get(key)!.value,
    latency: latency.get(key)?.value ?? null,
    // Current health is the authoritative per-agent probe state (never inferred
    // from the numeric HTTP status code); null ⇒ not covered by the batch here.
    probeState: agentProbeState(key),
  }))
})
const interfaceSamples = computed(() => byKind('iface.up'))

// --- Network adapter list ------------------------------------------------
// Wi-Fi state and readings are folded into the matching network-adapter row.
// They come from the authoritative interface snapshot so connection state and
// numeric readings always belong to the same collection round.
const wifiSupported = computed(() => !!currentAgent.value?.effective?.includes('network.wifi.status.read'))
const wifiCollection = computed(() => ifaceData.value?.wifi ?? null)
const wifiAdapters = computed(() => (ifaceData.value?.interfaces ?? []).filter((i) => i.is_wireless))

// Current-state freshness gate. An offline Agent is never "current": its last
// snapshot can still sit inside the server's 90s freshness window, so liveness
// must fold in here (not just the server stale flag) — otherwise a just-offline
// Agent would keep rendering a green connected adapter with live numerics.
const wifiStale = computed(() => currentAgent.value?.status !== 'online' || (wifiCollection.value?.stale ?? true))

function dbmGrade(dbm: number | null): { label: string; tone: string } | null {
  if (dbm == null) return null
  if (dbm >= -60) return { label: t('dashboard.wifiGradeGood'), tone: 'good' }
  if (dbm >= -70) return { label: t('dashboard.wifiGradeFair'), tone: 'warn' }
  return { label: t('dashboard.wifiGradeWeak'), tone: 'bad' }
}

interface WifiAdapterView {
  name: string
  state: 'connected' | 'disconnected' | 'unreadable' | 'stale'
  reason: string
  connected: boolean
  ssid: string
  band: string
  channel: number | null
  signalDbm: number | null
  grade: { label: string; tone: string } | null
  quality: number | null
  rxMbps: number | null
  txMbps: number | null
}
// Numeric readings come straight from the authoritative interface snapshot
// (a.wifi), so they belong to the same round as the connection state — never a
// stale per-series value from /latest. The connected gate (state + freshness)
// also blanks them when disconnected/stale/offline.
const wifiRows = computed<WifiAdapterView[]>(() => {
  if (!wifiSupported.value) return []
  const stale = wifiStale.value
  return wifiAdapters.value
    .map((a) => {
      const w = a.wifi
      const reportedState: WifiAdapterView['state'] =
        w?.state === 'connected' || w?.state === 'disconnected' ? w.state : 'unreadable'
      const state: WifiAdapterView['state'] = stale ? 'stale' : reportedState
      const connected = state === 'connected' && !stale
      const dbm = connected ? w?.signal_dbm ?? null : null
      return {
        name: a.name,
        state,
        reason: w?.reason ?? wifiCollection.value?.reason ?? '',
        connected,
        ssid: connected ? w?.ssid ?? '' : '',
        band: connected ? w?.band ?? '' : '',
        channel: connected ? w?.channel ?? null : null,
        signalDbm: dbm,
        grade: dbmGrade(dbm),
        quality: connected ? w?.quality_pct ?? null : null,
        rxMbps: connected ? w?.rx_mbps ?? null : null,
        txMbps: connected ? w?.tx_mbps ?? null : null,
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
})
const wifiBandLabel = (band: string) => (band ? t('dashboard.wifiBandGhz', { n: band }) : '—')
const wifiStateLabel = (adapter: WifiAdapterView) => {
  if (adapter.state === 'connected') return t('dashboard.wifiConnected')
  if (adapter.state === 'stale') return t('dashboard.wifiStale')
  if (adapter.state === 'unreadable') return t('dashboard.wifiAdapterUnreadable')
  return t('dashboard.wifiDisconnected')
}
const wifiStateTone = (adapter: WifiAdapterView) => {
  if (adapter.state === 'connected') return 'good'
  if (adapter.state === 'unreadable' || adapter.state === 'stale') return 'warn'
  return 'bad'
}

interface NetworkAdapterView {
  name: string
  up: boolean
  isWireless: boolean
  wifi: WifiAdapterView | null
}

const interfaceRows = computed<NetworkAdapterView[]>(() => {
  const samples = new Map(interfaceSamples.value.map((sample) => [sample.target, sample]))
  const snapshots = new Map((ifaceData.value?.interfaces ?? []).map((adapter) => [adapter.name, adapter]))
  const wifiByName = new Map(wifiRows.value.map((adapter) => [adapter.name, adapter]))
  const names = new Set([...samples.keys(), ...snapshots.keys()])

  return [...names]
    .map((name) => {
      const sample = samples.get(name)
      const adapter = snapshots.get(name)
      return {
        name,
        up: adapter?.up ?? sample?.value === 1,
        isWireless: adapter?.is_wireless ?? false,
        wifi: wifiByName.get(name) ?? null,
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
})

const deviceColumns = computed(() => {
  const rows = devices.value.map((device, index) => ({ device, number: index + 1 }))
  const split = Math.ceil(rows.length / 2)
  return [rows.slice(0, split), rows.slice(split)]
})

interface NATRow {
  key: string
  target: string
  code: number
  type: string
  tone: 'good' | 'bad' | 'unknown'
  mapping: string
  filtering: string
  probeState: ProbeState | null
  ts: string
}

const natRows = computed<NATRow[]>(() => {
  const types = byRowKey('probe.nat.type')
  const mappings = byRowKey('probe.nat.mapping')
  const filterings = byRowKey('probe.nat.filtering')
  return [...types.entries()]
    .map(([key, sample]) => {
      const mapping = mappings.get(key)
      const filtering = filterings.get(key)
      // Current health is the authoritative per-agent probe state, never inferred
      // from a probe.nat.ok sample or the NAT type; null when the batch does not
      // cover this pair.
      const ps = agentProbeState(key)
      return {
        key,
        target: sample.target,
        code: Math.round(sample.value),
        type: natCodeLabel('probe.nat.type', sample.value),
        tone: natTone('probe.nat.type', sample.value),
        mapping: mapping ? natCodeLabel('probe.nat.mapping', mapping.value) : '—',
        filtering: filtering ? natCodeLabel('probe.nat.filtering', filtering.value) : '—',
        probeState: ps,
        ts: sample.ts,
      }
    })
    .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
})
const primaryNAT = computed(() => natRows.value.find((row) => row.code > 0) ?? natRows.value[0] ?? null)

const hasHost = computed(() => snapshot.value.some((sample) => sample.kind.startsWith('host.')))
function hostVal(kind: string, target = 'host'): number | null {
  const sample = snapshot.value.find((item) => item.kind === kind && item.target === target)
  return sample?.value ?? null
}
const diskMounts = computed(() => [...new Set(byKind('host.disk.pct').map((sample) => sample.target))].sort())
const cpuCoreCount = computed(() => byKind('host.cpu.core.pct').length)
function fmtUptime(seconds: number | null): string {
  if (seconds == null) return '—'
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return days ? `${days}d ${hours}h ${minutes}m` : hours ? `${hours}h ${minutes}m` : `${minutes}m`
}
function ringStyle(value: number | null): Record<string, string> {
  const pct = Math.max(0, Math.min(100, value ?? 0))
  return { '--usage-angle': `${pct * 3.6}deg` }
}
function loadPercent(value: number | null): number {
  const capacity = Math.max(cpuCoreCount.value, 1)
  return Math.max(0, Math.min(100, ((value ?? 0) / capacity) * 100))
}
function loadTone(value: number | null): string {
  const pct = loadPercent(value)
  return pct < 25 ? 'is-low' : pct < 60 ? 'is-normal' : pct < 85 ? 'is-high' : 'is-critical'
}
function loadLevel(value: number | null): string {
  const pct = loadPercent(value)
  return pct < 25 ? t('dashboard.loadLow') : pct < 60 ? t('dashboard.loadNormal') : pct < 85 ? t('dashboard.loadHigh') : t('dashboard.loadCritical')
}

// worstPublicRtt feeds the at-a-glance latency insight card: the worst last-sample
// RTT across public ICMP targets (the gateway is its own LAN-layer monitor and is
// excluded). Deliberately NOT used to grade overall health — far/anycast anchors
// (1.1.1.1, 8.8.8.8) legitimately sit above any fixed ms threshold even when the
// link is perfectly fine.
const worstPublicRtt = computed(() => {
  const vals = byKind('probe.icmp.rtt_ms').filter((s) => s.target !== 'gateway').map((s) => s.value)
  return vals.length ? Math.max(...vals) : null
})
// Overall network health tracks the selected Agent's confirmed faults — the
// authoritative signal — instead of re-thresholding raw RTT/loss (which trips
// permanently on naturally high-latency/lossy public anchors). An offline Agent is
// "attention" (its probes stopped); any firing fault on this Agent is "attention";
// otherwise "good".
// The fetch is already scoped to the selected Agent; this filter only covers the
// window between switching Agents and the new response landing, so the badge
// never briefly reports the previous Agent's faults as this one's.
const agentFaults = computed(() => faults.value.filter((f) => f.agent_id === selected.value))
const networkHealth = computed(() => {
  if (currentAgent.value?.status !== 'online') return { tone: 'bad', label: t('dashboard.healthOffline') }
  if (agentFaults.value.length) return { tone: 'warn', label: t('dashboard.healthAttention') }
  return { tone: 'good', label: t('dashboard.healthGood') }
})

const publicLosses = computed(() => byKind('probe.icmp.loss_pct').filter((sample) => sample.target !== 'gateway').map((sample) => sample.value))
const availabilityPct = computed(() => {
  const losses = publicLosses.value
  if (!losses.length) return null
  return losses.reduce((sum, loss) => sum + Math.max(0, 100 - loss), 0) / losses.length
})
// Per-target availability behind the averaged card number, worst first, so the
// card can name which public ICMP target is dragging the average down. targetId
// is the monitor that owns the series (used to deep-link into target status);
// empty when the sample carries no monitor_id, leaving the name un-linked.
const availabilityBreakdown = computed(() =>
  byKind('probe.icmp.loss_pct')
    .filter((sample) => sample.target !== 'gateway')
    .map((sample) => ({ targetId: sample.monitor_id ?? '', name: sample.target, pct: Math.max(0, 100 - sample.value) }))
    .sort((a, b) => a.pct - b.pct),
)
const availabilityOffenders = computed(() => availabilityBreakdown.value.filter((row) => row.pct < 100))
const worstAvailabilityTarget = computed(() => availabilityOffenders.value[0] ?? null)
const failureCount = computed(() => statusHistory.value.filter((event) => event.status === 'offline').length)

const severityRank: Record<string, number> = { critical: 0, error: 1, warn: 2, info: 3 }
const currentFaults = computed(() => [...agentFaults.value].sort((a, b) =>
  (severityRank[a.severity] ?? 9) - (severityRank[b.severity] ?? 9)
    || new Date(a.confirmed_at).getTime() - new Date(b.confirmed_at).getTime(),
))
const faultReason = (f: FaultSignal) =>
  (locale.value === 'en' ? f.desc_en : f.desc_zh) || f.target_name || f.target_addr

// Monitor health for the selected Agent, counted from the authoritative
// target-status batch (per-agent execution/probe state) — never re-inferred from
// /latest samples. `active` = collecting with a fresh healthy probe;
// `probe_failed` folds current failing and stale probes; blocked/unsupported come
// straight from the execution dimension.
type MonitorHealthState = 'active' | 'probe_failed' | 'permission_blocked' | 'target_blocked' | 'unsupported'
const monitorHealth = computed(() => {
  const counts: Record<MonitorHealthState, number> = {
    active: 0,
    probe_failed: 0,
    permission_blocked: 0,
    target_blocked: 0,
    unsupported: 0,
  }
  let total = 0
  for (const row of targetStatus.targets) {
    const a = row.agents.find((x) => x.agent_id === selected.value)
    if (!a) continue
    total++
    switch (a.execution_state) {
      case 'permission_blocked':
        counts.permission_blocked++
        break
      case 'target_blocked':
        counts.target_blocked++
        break
      case 'unsupported':
        counts.unsupported++
        break
      case 'collecting':
        if (a.probe_state === 'failed' || a.probe_state === 'stale') counts.probe_failed++
        else if (a.probe_state === 'healthy') counts.active++
        // no_data / not_applicable: the pair is collecting but has no current
        // healthy probe result — kept in the total, never counted as active.
        break
      default:
        // pending / agent_offline / disabled / unassigned — not a health problem
        // and not "collecting"; kept in the total but not attributed to a bucket.
        break
    }
  }
  return { ...counts, total }
})

function aggregateWorst(samples: Sample[]): Sample[] {
  const buckets = new Map<string, Sample>()
  for (const sample of samples) {
    if (sample.target === 'gateway') continue
    const previous = buckets.get(sample.ts)
    if (!previous || sample.value > previous.value) buckets.set(sample.ts, { ...sample, target: 'public' })
  }
  return [...buckets.values()].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())
}

const qualityRtt = computed(() => aggregateWorst(qualityRttHistory.value))
const qualityLoss = computed(() => aggregateWorst(qualityLossHistory.value))
const qualityJitter = computed(() => aggregateWorst(qualityJitterHistory.value))
const qualityChartMetrics = computed(() => [
  { key: 'rtt', label: t('dashboard.qualityRtt'), kind: 'probe.icmp.rtt_ms', unit: 'ms', color: chartColor('--color-info', '#38bdf8'), samples: qualityRtt.value },
  { key: 'jitter', label: t('dashboard.qualityJitter'), kind: 'probe.icmp.jitter_ms', unit: 'ms', color: chartColor('--color-chart-secondary', '#f472b6'), samples: qualityJitter.value },
  { key: 'loss', label: t('dashboard.qualityLoss'), kind: 'probe.icmp.loss_pct', unit: 'pct', color: chartColor('--color-warning', '#fbbf24'), samples: qualityLoss.value },
].filter((metric) => metric.samples.length))

const qualityRttP95 = computed(() => qualitySummary.value?.kinds['probe.icmp.rtt_ms']?.p95 ?? null)
const qualityJitterP95 = computed(() => qualitySummary.value?.kinds['probe.icmp.jitter_ms']?.p95 ?? null)
const qualityLossAvg = computed(() => qualitySummary.value?.kinds['probe.icmp.loss_pct']?.avg ?? null)

const trafficChartMetrics = computed(() => [
  { key: 'rx', label: t('dashboard.download'), kind: 'host.net.rx_bps', unit: 'bps', color: chartColor('--color-info', '#38bdf8'), samples: trafficRxHistory.value },
  { key: 'tx', label: t('dashboard.upload'), kind: 'host.net.tx_bps', unit: 'bps', color: chartColor('--color-chart-secondary', '#f472b6'), samples: trafficTxHistory.value },
].filter((metric) => metric.samples.length))
const trafficPeak = computed(() => {
  const values = [...trafficRxHistory.value, ...trafficTxHistory.value].map((sample) => sample.value)
  return values.length ? Math.max(...values) : null
})

const newestTelemetryAt = computed(() => {
  const times = snapshot.value.map((sample) => new Date(sample.ts).getTime()).filter(Number.isFinite)
  if (times.length) return Math.max(...times)
  const seen = currentAgent.value?.last_seen_at ? new Date(currentAgent.value.last_seen_at).getTime() : NaN
  return Number.isFinite(seen) ? seen : null
})
const freshnessAgeSeconds = computed(() => newestTelemetryAt.value == null ? null : Math.max(0, (Date.now() - newestTelemetryAt.value) / 1000))
const freshnessTone = computed(() => {
  if (currentAgent.value?.status !== 'online') return 'bad'
  if (freshnessAgeSeconds.value == null) return 'unknown'
  if (freshnessAgeSeconds.value <= 90) return 'good'
  if (freshnessAgeSeconds.value <= 300) return 'warn'
  return 'bad'
})
const freshnessLabel = computed(() => t(`dashboard.freshness_${freshnessTone.value}`))
function fmtAge(seconds: number | null): string {
  if (seconds == null) return '—'
  if (seconds < 90) return t('common.durSeconds', { n: Math.round(seconds) })
  if (seconds < 5400) return t('common.durMinutes', { n: Math.round(seconds / 60) })
  return t('common.durHours', { n: (seconds / 3600).toFixed(1) })
}

const primaryWifi = computed(() => wifiRows.value.find((adapter) => adapter.connected) ?? wifiRows.value[0] ?? null)
// The Agent resolves the OS default gateway with the same logic used by the
// gateway monitor and names the interface it belongs to, so that name is the
// join key — never the gateway address. Several adapters can carry the same
// gateway: a disconnected Wi-Fi adapter keeps a stale route to the LAN gateway
// its wired sibling now owns, and matching by address picked that down adapter
// and reported the whole path as failed on a host with no Wi-Fi in use.
const defaultRouteInterface = computed(() => {
  const name = ifaceData.value?.default_route?.interface
  if (!name) return null
  return (ifaceData.value?.interfaces ?? []).find((adapter) => adapter.name === name) ?? null
})
const pathInterfaceKind = computed<'wifi' | 'wired' | 'unknown'>(() => {
  const adapter = defaultRouteInterface.value
  if (!adapter) return 'unknown'
  return adapter.is_wireless ? 'wifi' : 'wired'
})
const pathNetworkInterface = computed(() => {
  const adapter = defaultRouteInterface.value
  if (!adapter) return { tone: 'unknown' as const, state: 'no_data' as const }
  if (!adapter.up) return { tone: 'bad' as const, state: 'failed' as const }
  if (!adapter.is_wireless) return { tone: 'good' as const, state: 'healthy' as const }

  const wifi = wifiRows.value.find((row) => row.name === adapter.name)
  // The interface and its default gateway are still authoritative when the
  // optional Wi-Fi detail permission is absent.
  if (!wifi) return { tone: 'good' as const, state: 'healthy' as const }
  if (wifi.state === 'connected') {
    return wifi.grade?.tone === 'bad'
      ? { tone: 'warn' as const, state: 'degraded' as const }
      : { tone: 'good' as const, state: 'healthy' as const }
  }
  if (wifi.state === 'disconnected') return { tone: 'bad' as const, state: 'failed' as const }
  if (wifi.state === 'stale') return { tone: 'warn' as const, state: 'stale' as const }
  return { tone: 'warn' as const, state: 'blocked' as const }
})
const pathLatencyMsByTarget = computed<Record<string, number>>(() => {
  const metricByKind: Readonly<Record<string, string>> = {
    gateway: 'probe.icmp.rtt_ms',
    icmp: 'probe.icmp.rtt_ms',
    dns: 'probe.dns.resolve_ms',
    http: 'probe.http.latency_ms',
  }
  const expectedMetric = new Map(
    targetStatus.targets
      .filter((target) => metricByKind[target.kind])
      .map((target) => [target.target_id, metricByKind[target.kind]]),
  )
  const latest = new Map<string, Sample>()
  for (const sample of snapshot.value) {
    if (!sample.monitor_id || expectedMetric.get(sample.monitor_id) !== sample.kind) continue
    if (!Number.isFinite(sample.value) || sample.value < 0) continue
    const current = latest.get(sample.monitor_id)
    if (!current || new Date(sample.ts).getTime() > new Date(current.ts).getTime()) latest.set(sample.monitor_id, sample)
  }
  return Object.fromEntries([...latest].map(([targetID, sample]) => [targetID, sample.value]))
})
const dashboardPath = computed(() => buildDashboardPath({
  agentId: selected.value,
  agentOnline: currentAgent.value?.status === 'online',
  freshnessTone: freshnessTone.value,
  networkInterface: pathNetworkInterface.value,
  targets: targetStatus.targets,
  latencyMsByTarget: pathLatencyMsByTarget.value,
}))
const pathInterfaceDetail = computed(() => {
  const adapter = defaultRouteInterface.value
  if (!adapter) return t('dashboard.pathInterfaceUnknown')
  if (!adapter.is_wireless) return adapter.name

  const wifi = wifiRows.value.find((row) => row.name === adapter.name)
  if (!wifi) return adapter.name
  if (!wifi.connected) return `${adapter.name} · ${wifiStateLabel(wifi)}`
  return [
    adapter.name,
    wifi.ssid || t('dashboard.wifiConnected'),
    wifi.signalDbm == null ? '' : `${wifi.signalDbm} dBm`,
  ].filter(Boolean).join(' · ')
})
const incidentLayerLabel = computed(() => {
  const layer = incidentSummary.value?.top_layer
  if (!layer) return '—'
  const key = `incidents.layer.${layer}`
  return te(key) ? t(key) : layer
})

const fmt = (value: number | null, digits = 0) => (value == null ? '—' : value.toFixed(digits))
const fmtTime = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleString(toDateLocale(locale.value), { hour12: false }) : '—'

onMounted(async () => {
  window.addEventListener('beforeunload', warnUnsaved)
  await Promise.all([loadAgents(), loadServerLayout()])
  await loadMetrics()
  await loadHistory()
  // Refresh agents alongside metrics: status now flips within seconds
  // server-side. loadAgents only assigns `selected` when it's empty, so the
  // current selection survives every refresh.
  timer = window.setInterval(() => {
    loadMetrics()
    loadAgents()
  }, 5000)
  historyTimer = window.setInterval(loadHistory, 5 * 60 * 1000)
})
onBeforeUnmount(() => {
  if (timer) window.clearInterval(timer)
  if (historyTimer) window.clearInterval(historyTimer)
  window.removeEventListener('beforeunload', warnUnsaved)
  stopPointerCardDrag?.()
})
</script>

<template>
  <main class="page dashboard-page">
    <header class="dashboard-head">
      <div>
        <div class="eyebrow"><span class="pulse-dot"></span>{{ t('dashboard.liveOverview') }}</div>
        <h2>{{ t('dashboard.title') }}</h2>
        <p>{{ t('dashboard.subtitle') }}</p>
      </div>
      <div v-if="agents.length" class="head-actions">
        <label class="agent-picker">
          <span>{{ t('dashboard.viewingAgent') }}</span>
          <select v-model="selected" @change="changeAgent">
            <option v-for="agent in agents" :key="agent.id" :value="agent.id">
              {{ agentLabel(agent) }}
            </option>
          </select>
        </label>
        <button class="layout-add-button" type="button" :disabled="layoutLoading || layoutSaving" @click="beginLayoutEdit">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
          {{ t('dashboard.layoutModifyLayout') }}
        </button>
        <button class="refresh-button" :class="{ spinning: refreshing }" :title="t('common.refresh')" @click="loadMetrics">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6v5h-5M4 18v-5h5M6.1 9a7 7 0 0 1 11.8-2.6L20 11M4 13l2.1 4.6A7 7 0 0 0 17.9 15" /></svg>
        </button>
      </div>
    </header>
    <section v-if="editingLayout" class="direct-layout-toolbar">
      <div>
        <span v-if="layoutDirty" class="unsaved-chip">{{ t('dashboard.layoutUnsaved') }}</span>
        <p>{{ t('dashboard.layoutDirectHint') }}</p>
      </div>
      <p v-if="layoutError" class="err">{{ layoutError }}</p>
      <div class="direct-layout-actions">
        <button class="btn" type="button" @click="cancelLayoutEdit">{{ t('dashboard.layoutCancel') }}</button>
        <button class="btn btn-primary" type="button" :disabled="layoutSaving || !layoutDirty" @click="saveLayout">{{ t('common.save') }}</button>
      </div>
    </section>

    <section v-if="editingLayout" class="layout-presets" aria-labelledby="layout-presets-title">
      <div class="layout-presets-head">
        <div>
          <h3 id="layout-presets-title">{{ t('dashboard.layoutPresetsTitle') }}</h3>
          <p>{{ t('dashboard.layoutPresetsHint') }}</p>
        </div>
        <span class="layout-mode-chip" :class="{ custom: !activeLayoutPreset }">
          {{ activeLayoutPreset ? t('dashboard.layoutPreset_' + activeLayoutPreset) : t('dashboard.layoutPresetCustom') }}
        </span>
      </div>
      <div class="layout-preset-grid">
        <button
          v-for="presetID in layoutPresetIDs"
          :key="presetID"
          class="layout-preset-option"
          :class="{ selected: activeLayoutPreset === presetID }"
          type="button"
          :aria-pressed="activeLayoutPreset === presetID"
          :data-layout-preset="presetID"
          @click="applyLayoutPreset(presetID)"
        >
          <span class="layout-preset-preview" :class="presetID">
            <i v-for="index in (presetID === 'simple' ? 6 : 10)" :key="index"></i>
          </span>
          <span class="layout-preset-copy">
            <strong>{{ t('dashboard.layoutPreset_' + presetID) }}</strong>
            <small>{{ t('dashboard.layoutPreset_' + presetID + 'Hint') }}</small>
          </span>
          <span v-if="activeLayoutPreset === presetID" class="layout-preset-check" aria-hidden="true">✓</span>
        </button>
      </div>
    </section>

    <section v-if="editingLayout" class="widget-catalog" aria-labelledby="widget-catalog-title">
      <div class="widget-catalog-head">
        <div>
          <h3 id="widget-catalog-title">{{ t('dashboard.layoutCatalogTitle') }}</h3>
          <p>{{ t('dashboard.layoutCatalogHint') }}</p>
        </div>
      </div>
      <div class="widget-catalog-grid">
        <article v-for="definition in hiddenCardDefinitions" :key="definition.id" class="widget-option">
          <div class="widget-preview">
            <span class="widget-preview-icon"><i></i><i></i><i></i><i></i></span>
            <div><strong>{{ t(definition.titleKey) }}</strong><small>{{ definition.sizes.map((size) => t(`dashboard.layoutSize_${size}`)).join(' / ') }}</small></div>
          </div>
          <button class="btn btn-primary" type="button" @click="addWidget(definition.id)">
            {{ t('dashboard.layoutAdd') }}
          </button>
        </article>
        <article class="widget-option monitor-target-widget-option" data-widget-type="monitor-target">
          <div class="widget-preview">
            <span class="widget-preview-icon monitor"><i></i><i></i><i></i><i></i></span>
            <div>
              <strong>{{ t('dashboard.cardMonitorTarget') }}</strong>
              <small>{{ t('dashboard.monitorWidgetHint') }}</small>
            </div>
          </div>
          <button
            class="btn btn-primary target-card-add-button"
            type="button"
            :disabled="layoutAtCardLimit || !availableMonitorKinds.length"
            @click="openTargetCardDrawer"
          >
            {{ t('dashboard.monitorWidgetAction') }}
          </button>
        </article>
      </div>
    </section>

    <p v-if="error" class="err dashboard-error">{{ error }}</p>
    <p v-if="layoutError && !editingLayout" class="err dashboard-error">{{ layoutError }}</p>

    <div v-if="loading || layoutLoading" class="dashboard-loading">
      <span></span><span></span><span></span>
    </div>

    <div v-else-if="!agents.length" class="card empty">
      <div class="empty-ico">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" /></svg>
      </div>
      <h3>{{ t('common.noAgents') }}</h3>
      <p class="hint">{{ t('dashboard.noAgentHint') }}</p>
    </div>

    <template v-else>
      <div class="custom-dashboard-grid">
      <section v-if="cardVisible('overall')" class="agent-hero dashboard-card-shell" :class="`health-${networkHealth.tone}`" :style="cardGridStyle('overall')" data-layout-card="overall" :data-layout-editing="editingLayout || undefined" :data-dragging="draggingCardID === 'overall' || undefined" :draggable="editingLayout" @dragstart="startCardDrag('overall', $event)" @dragend="draggingCardID = ''" @dragover.prevent @drop="dropLayoutCard('overall')">
        <DashboardCardControls v-if="editingLayout" :title="t(cardDefinition('overall').titleKey)" :size="cardLayout('overall')!.size" :sizes="cardDefinition('overall').sizes" :first="visibleCardIndex('overall') === 0" :last="visibleCardIndex('overall') === visibleCardCount - 1" @resize="updateCardSize('overall', $event)" @move="moveVisibleCard('overall', $event)" @remove="removeWidget('overall')" @pointer-drag="startPointerCardDrag('overall', $event)" />
        <div class="agent-identity">
          <div class="agent-mark">
            <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8M12 17v4M7 9h.01M10 9h7M7 12h.01M10 12h5" /></svg>
          </div>
          <div>
            <div class="agent-line">
              <h3>{{ currentAgent ? agentLabel(currentAgent) : '' }}</h3>
              <span class="status-chip" :class="currentAgent?.status === 'online' ? 'online' : 'offline'">
                <i></i>{{ currentAgent?.status === 'online' ? t('dashboard.statusOnline') : t('dashboard.statusOffline') }}
              </span>
            </div>
            <p>{{ currentAgent?.hostname }} · {{ currentAgent?.platform }}<template v-if="currentAgent?.agent_version"> · {{ currentAgent.agent_version }}</template></p>
          </div>
        </div>
        <div class="health-summary">
          <span>{{ t('dashboard.networkHealth') }}</span>
          <strong>{{ networkHealth.label }}</strong>
          <small>{{ t('dashboard.updatedAt') }} {{ fmtTime(currentAgent?.last_seen_at) }}</small>
        </div>
        <div class="fleet-summary">
          <div><strong>{{ onlineCount }}</strong><span>/ {{ agents.length }} {{ t('dashboard.onlineAgents') }}</span></div>
          <div v-if="quota"><strong>{{ quota.used }}</strong><span>/ {{ quota.max === 0 ? '∞' : quota.max }} {{ t('dashboard.agentQuota') }}</span></div>
        </div>
      </section>
      <section v-if="cardVisible('path-status')" class="surface path-status-card dashboard-card-shell" :style="cardGridStyle('path-status')" data-layout-card="path-status" :data-layout-editing="editingLayout || undefined" :data-dragging="draggingCardID === 'path-status' || undefined" :draggable="editingLayout" @dragstart="startCardDrag('path-status', $event)" @dragend="draggingCardID = ''" @dragover.prevent @drop="dropLayoutCard('path-status')">
        <DashboardCardControls v-if="editingLayout" :title="t(cardDefinition('path-status').titleKey)" :size="cardLayout('path-status')!.size" :sizes="cardDefinition('path-status').sizes" :first="visibleCardIndex('path-status') === 0" :last="visibleCardIndex('path-status') === visibleCardCount - 1" @resize="updateCardSize('path-status', $event)" @move="moveVisibleCard('path-status', $event)" @remove="removeWidget('path-status')" @pointer-drag="startPointerCardDrag('path-status', $event)" />
        <DashboardPathCard
          :stages="dashboardPath.stages"
          :root="dashboardPath.root"
          :agent-name="currentAgent ? agentLabel(currentAgent) : '—'"
          :interface-kind="pathInterfaceKind"
          :interface-detail="pathInterfaceDetail"
          :nat-detail="primaryNAT ? {
            type: primaryNAT.type,
            mapping: primaryNAT.mapping,
            filtering: primaryNAT.filtering,
          } : null"
        />
      </section>
      <article v-if="cardVisible('availability')" class="insight-card dashboard-card-shell" :class="availabilityPct == null ? 'is-unknown' : availabilityPct >= 99 ? 'is-good' : availabilityPct >= 95 ? 'is-warn' : 'is-bad'" :style="cardGridStyle('availability')" data-layout-card="availability" :data-layout-editing="editingLayout || undefined" :data-dragging="draggingCardID === 'availability' || undefined" :draggable="editingLayout" @dragstart="startCardDrag('availability', $event)" @dragend="draggingCardID = ''" @dragover.prevent @drop="dropLayoutCard('availability')">
        <DashboardCardControls v-if="editingLayout" :title="t(cardDefinition('availability').titleKey)" :size="cardLayout('availability')!.size" :sizes="cardDefinition('availability').sizes" :first="visibleCardIndex('availability') === 0" :last="visibleCardIndex('availability') === visibleCardCount - 1" @resize="updateCardSize('availability', $event)" @move="moveVisibleCard('availability', $event)" @remove="removeWidget('availability')" @pointer-drag="startPointerCardDrag('availability', $event)" />
        <span>{{ t('dashboard.cardAvailability') }}</span>
        <strong>{{ availabilityPct == null ? '--' : formatAvailability(availabilityPct / 100) }}</strong>
        <p v-if="availabilityPct != null && worstAvailabilityTarget" class="availability-attribution">
          <RouterLink
            v-if="worstAvailabilityTarget.targetId"
            class="attribution-link"
            :to="{ path: '/target-status', query: { agent: selected, target: worstAvailabilityTarget.targetId } }"
          >{{ worstAvailabilityTarget.name }} {{ formatAvailability(worstAvailabilityTarget.pct / 100) }}</RouterLink>
          <span v-else class="mono">{{ worstAvailabilityTarget.name }} {{ formatAvailability(worstAvailabilityTarget.pct / 100) }}</span>
          <span v-if="availabilityOffenders.length > 1"> · {{ t('dashboard.availabilityMoreOffenders', { n: availabilityOffenders.length - 1 }) }}</span>
        </p>
        <p v-else>{{ t('dashboard.availabilityFoot', { n: publicLosses.length }) }}</p>
      </article>
      <article v-if="cardVisible('latency')" class="insight-card dashboard-card-shell" :class="worstPublicRtt == null ? 'is-unknown' : worstPublicRtt < 80 ? 'is-good' : worstPublicRtt < 150 ? 'is-warn' : 'is-bad'" :style="cardGridStyle('latency')" data-layout-card="latency" :data-layout-editing="editingLayout || undefined" :data-dragging="draggingCardID === 'latency' || undefined" :draggable="editingLayout" @dragstart="startCardDrag('latency', $event)" @dragend="draggingCardID = ''" @dragover.prevent @drop="dropLayoutCard('latency')">
        <DashboardCardControls v-if="editingLayout" :title="t(cardDefinition('latency').titleKey)" :size="cardLayout('latency')!.size" :sizes="cardDefinition('latency').sizes" :first="visibleCardIndex('latency') === 0" :last="visibleCardIndex('latency') === visibleCardCount - 1" @resize="updateCardSize('latency', $event)" @move="moveVisibleCard('latency', $event)" @remove="removeWidget('latency')" @pointer-drag="startPointerCardDrag('latency', $event)" />
        <span>{{ t('dashboard.cardLatency') }}</span>
        <strong>{{ worstPublicRtt == null ? '--' : `${worstPublicRtt.toFixed(0)} ms` }}</strong>
        <p>{{ t('dashboard.latencyFoot') }}</p>
      </article>
      <article v-if="cardVisible('failures')" class="insight-card dashboard-card-shell" :class="failureCount ? 'is-bad' : 'is-good'" :style="cardGridStyle('failures')" data-layout-card="failures" :data-layout-editing="editingLayout || undefined" :data-dragging="draggingCardID === 'failures' || undefined" :draggable="editingLayout" @dragstart="startCardDrag('failures', $event)" @dragend="draggingCardID = ''" @dragover.prevent @drop="dropLayoutCard('failures')">
        <DashboardCardControls v-if="editingLayout" :title="t(cardDefinition('failures').titleKey)" :size="cardLayout('failures')!.size" :sizes="cardDefinition('failures').sizes" :first="visibleCardIndex('failures') === 0" :last="visibleCardIndex('failures') === visibleCardCount - 1" @resize="updateCardSize('failures', $event)" @move="moveVisibleCard('failures', $event)" @remove="removeWidget('failures')" @pointer-drag="startPointerCardDrag('failures', $event)" />
        <span>{{ t('dashboard.cardFailures') }}</span>
        <strong>{{ failureCount }}</strong>
        <p>{{ t('dashboard.failuresFoot') }}</p>
      </article>
      <article v-if="cardVisible('agent-status')" class="insight-card dashboard-card-shell" :class="onlineCount === agents.length ? 'is-good' : onlineCount ? 'is-warn' : 'is-bad'" :style="cardGridStyle('agent-status')" data-layout-card="agent-status" :data-layout-editing="editingLayout || undefined" :data-dragging="draggingCardID === 'agent-status' || undefined" :draggable="editingLayout" @dragstart="startCardDrag('agent-status', $event)" @dragend="draggingCardID = ''" @dragover.prevent @drop="dropLayoutCard('agent-status')">
        <DashboardCardControls v-if="editingLayout" :title="t(cardDefinition('agent-status').titleKey)" :size="cardLayout('agent-status')!.size" :sizes="cardDefinition('agent-status').sizes" :first="visibleCardIndex('agent-status') === 0" :last="visibleCardIndex('agent-status') === visibleCardCount - 1" @resize="updateCardSize('agent-status', $event)" @move="moveVisibleCard('agent-status', $event)" @remove="removeWidget('agent-status')" @pointer-drag="startPointerCardDrag('agent-status', $event)" />
        <span>{{ t('dashboard.cardAgentStatus') }}</span>
        <strong>{{ onlineCount }} / {{ agents.length }}</strong>
        <p>{{ t('dashboard.onlineAgentsFoot') }}</p>
      </article>

      <section v-if="cardVisible('active-alerts')" class="surface overview-summary-card alert-summary-card dashboard-card-shell" :class="currentFaults.length ? 'has-problem' : 'is-clear'" :style="cardGridStyle('active-alerts')" data-layout-card="active-alerts" :data-layout-editing="editingLayout || undefined" :data-dragging="draggingCardID === 'active-alerts' || undefined" :draggable="editingLayout" @dragstart="startCardDrag('active-alerts', $event)" @dragend="draggingCardID = ''" @dragover.prevent @drop="dropLayoutCard('active-alerts')">
        <DashboardCardControls v-if="editingLayout" :title="t(cardDefinition('active-alerts').titleKey)" :size="cardLayout('active-alerts')!.size" :sizes="cardDefinition('active-alerts').sizes" :first="visibleCardIndex('active-alerts') === 0" :last="visibleCardIndex('active-alerts') === visibleCardCount - 1" @resize="updateCardSize('active-alerts', $event)" @move="moveVisibleCard('active-alerts', $event)" @remove="removeWidget('active-alerts')" @pointer-drag="startPointerCardDrag('active-alerts', $event)" />
        <div class="summary-card-head">
          <div><span class="section-kicker">SITE</span><h3>{{ t('dashboard.activeFaults') }}</h3></div>
          <RouterLink class="text-link" to="/incidents">{{ t('dashboard.viewAll') }} →</RouterLink>
        </div>
        <div v-if="!currentFaults.length" class="summary-clear-state"><strong>✓</strong><span>{{ t('dashboard.noActiveFaults') }}</span></div>
        <div v-else class="summary-list">
          <article v-for="f in currentFaults.slice(0, 3)" :key="f.id" class="summary-list-row">
            <i class="severity-dot" :class="`severity-${f.severity}`"></i>
            <span class="summary-row-copy"><strong>{{ f.title || faultReason(f) }}</strong><small>{{ f.agent_name || f.agent_id }} · {{ faultReason(f) }}</small></span>
            <time>{{ fmtAge((Date.now() - new Date(f.observed_at).getTime()) / 1000) }}</time>
          </article>
        </div>
      </section>

      <section v-if="cardVisible('monitor-health')" class="surface overview-summary-card dashboard-card-shell" :class="monitorHealth.probe_failed || monitorHealth.permission_blocked || monitorHealth.target_blocked ? 'has-problem' : 'is-clear'" :style="cardGridStyle('monitor-health')" data-layout-card="monitor-health" :data-layout-editing="editingLayout || undefined" :data-dragging="draggingCardID === 'monitor-health' || undefined" :draggable="editingLayout" @dragstart="startCardDrag('monitor-health', $event)" @dragend="draggingCardID = ''" @dragover.prevent @drop="dropLayoutCard('monitor-health')">
        <DashboardCardControls v-if="editingLayout" :title="t(cardDefinition('monitor-health').titleKey)" :size="cardLayout('monitor-health')!.size" :sizes="cardDefinition('monitor-health').sizes" :first="visibleCardIndex('monitor-health') === 0" :last="visibleCardIndex('monitor-health') === visibleCardCount - 1" @resize="updateCardSize('monitor-health', $event)" @move="moveVisibleCard('monitor-health', $event)" @remove="removeWidget('monitor-health')" @pointer-drag="startPointerCardDrag('monitor-health', $event)" />
        <div class="summary-card-head">
          <div><span class="section-kicker">AGENT</span><h3>{{ t('dashboard.monitorHealth') }}</h3></div>
          <RouterLink class="text-link" :to="{ path: '/target-status', query: { agent: selected } }">{{ t('dashboard.viewAll') }} →</RouterLink>
        </div>
        <p v-if="currentAgent?.status !== 'online'" class="offline-impact">{{ t('dashboard.monitorOfflineImpact', { n: monitorHealth.total }) }}</p>
        <div class="health-count-grid">
          <div class="health-count good"><strong>{{ monitorHealth.active }}</strong><span>{{ t('dashboard.monitorActive') }}</span></div>
          <div class="health-count bad"><strong>{{ monitorHealth.probe_failed }}</strong><span>{{ t('dashboard.monitorProbeFailed') }}</span></div>
          <div class="health-count warn"><strong>{{ monitorHealth.permission_blocked + monitorHealth.target_blocked }}</strong><span>{{ t('dashboard.monitorBlocked') }}</span></div>
          <div class="health-count muted"><strong>{{ monitorHealth.unsupported }}</strong><span>{{ t('dashboard.monitorUnsupported') }}</span></div>
        </div>
      </section>

      <section v-if="cardVisible('network-quality')" class="surface trend-summary-card dashboard-card-shell" :class="{ 'is-tall': cardIsTall('network-quality') }" :style="cardGridStyle('network-quality')" data-layout-card="network-quality" :data-layout-editing="editingLayout || undefined" :data-dragging="draggingCardID === 'network-quality' || undefined" :draggable="editingLayout" @dragstart="startCardDrag('network-quality', $event)" @dragend="draggingCardID = ''" @dragover.prevent @drop="dropLayoutCard('network-quality')">
        <DashboardCardControls v-if="editingLayout" :title="t(cardDefinition('network-quality').titleKey)" :size="cardLayout('network-quality')!.size" :sizes="cardDefinition('network-quality').sizes" :first="visibleCardIndex('network-quality') === 0" :last="visibleCardIndex('network-quality') === visibleCardCount - 1" @resize="updateCardSize('network-quality', $event)" @move="moveVisibleCard('network-quality', $event)" @remove="removeWidget('network-quality')" @pointer-drag="startPointerCardDrag('network-quality', $event)" />
        <div class="summary-card-head">
          <div><span class="section-kicker">24H</span><h3>{{ t('dashboard.networkQuality24h') }}</h3></div>
          <RouterLink class="text-link" :to="{ path: '/target-status', query: { agent: selected } }">{{ t('dashboard.viewAll') }} →</RouterLink>
        </div>
        <p class="card-source-note">{{ qualitySourceNote }}</p>
        <div class="trend-stat-row">
          <div><span>{{ t('dashboard.qualityRttP95') }}</span><strong>{{ fmt(qualityRttP95, 1) }}<small> ms</small></strong></div>
          <div><span>{{ t('dashboard.qualityLossAvg') }}</span><strong>{{ fmt(qualityLossAvg, 2) }}<small>%</small></strong></div>
          <div><span>{{ t('dashboard.qualityJitterP95') }}</span><strong>{{ fmt(qualityJitterP95, 1) }}<small> ms</small></strong></div>
        </div>
        <MetricChart v-if="qualityChartMetrics.length" class="dashboard-trend-chart" :title="t('dashboard.last24Hours')" :metrics="qualityChartMetrics" />
        <div v-else class="summary-empty">{{ t('dashboard.noQualityHistory') }}</div>
      </section>

      <article v-if="cardVisible('data-freshness')" class="metric-card freshness-card dashboard-card-shell" :class="`is-${freshnessTone}`" :style="cardGridStyle('data-freshness')" data-layout-card="data-freshness" :data-layout-editing="editingLayout || undefined" :data-dragging="draggingCardID === 'data-freshness' || undefined" :draggable="editingLayout" @dragstart="startCardDrag('data-freshness', $event)" @dragend="draggingCardID = ''" @dragover.prevent @drop="dropLayoutCard('data-freshness')">
        <DashboardCardControls v-if="editingLayout" :title="t(cardDefinition('data-freshness').titleKey)" :size="cardLayout('data-freshness')!.size" :sizes="cardDefinition('data-freshness').sizes" :first="visibleCardIndex('data-freshness') === 0" :last="visibleCardIndex('data-freshness') === visibleCardCount - 1" @resize="updateCardSize('data-freshness', $event)" @move="moveVisibleCard('data-freshness', $event)" @remove="removeWidget('data-freshness')" @pointer-drag="startPointerCardDrag('data-freshness', $event)" />
        <div class="freshness-content">
          <span>{{ t('dashboard.dataFreshness') }}</span>
          <strong>{{ freshnessLabel }}</strong>
          <b>{{ fmtAge(freshnessAgeSeconds) }}</b>
          <small>{{ t('dashboard.freshnessSeries', { n: snapshot.length }) }}</small>
        </div>
      </article>

      <article v-if="cardVisible('wifi-summary')" class="metric-card wifi-summary-card dashboard-card-shell" :class="primaryWifi?.connected ? 'is-good' : primaryWifi ? 'is-warn' : 'is-unknown'" :style="cardGridStyle('wifi-summary')" data-layout-card="wifi-summary" :data-layout-editing="editingLayout || undefined" :data-dragging="draggingCardID === 'wifi-summary' || undefined" :draggable="editingLayout" @dragstart="startCardDrag('wifi-summary', $event)" @dragend="draggingCardID = ''" @dragover.prevent @drop="dropLayoutCard('wifi-summary')">
        <DashboardCardControls v-if="editingLayout" :title="t(cardDefinition('wifi-summary').titleKey)" :size="cardLayout('wifi-summary')!.size" :sizes="cardDefinition('wifi-summary').sizes" :first="visibleCardIndex('wifi-summary') === 0" :last="visibleCardIndex('wifi-summary') === visibleCardCount - 1" @resize="updateCardSize('wifi-summary', $event)" @move="moveVisibleCard('wifi-summary', $event)" @remove="removeWidget('wifi-summary')" @pointer-drag="startPointerCardDrag('wifi-summary', $event)" />
        <div class="wifi-summary-content">
          <span>{{ t('dashboard.wifiSummary') }}</span>
          <template v-if="primaryWifi">
            <strong>{{ primaryWifi.connected ? (primaryWifi.ssid || t('dashboard.wifiHiddenSsid')) : wifiStateLabel(primaryWifi) }}</strong>
            <b>{{ primaryWifi.signalDbm == null ? '—' : `${primaryWifi.signalDbm} dBm` }}<small v-if="primaryWifi.grade"> · {{ primaryWifi.grade.label }}</small></b>
            <small v-if="primaryWifi.connected">{{ wifiBandLabel(primaryWifi.band) }} · {{ primaryWifi.channel == null ? '—' : t('dashboard.wifiChannelShort', { n: primaryWifi.channel }) }}</small>
          </template>
          <template v-else><strong>{{ wifiSupported ? t('dashboard.wifiNoAdapter') : t('dashboard.wifiUnsupported') }}</strong><small>{{ t('dashboard.wifiSummaryHint') }}</small></template>
        </div>
      </article>

      <section v-if="cardVisible('traffic-trend')" class="surface trend-summary-card dashboard-card-shell" :class="{ 'is-tall': cardIsTall('traffic-trend') }" :style="cardGridStyle('traffic-trend')" data-layout-card="traffic-trend" :data-layout-editing="editingLayout || undefined" :data-dragging="draggingCardID === 'traffic-trend' || undefined" :draggable="editingLayout" @dragstart="startCardDrag('traffic-trend', $event)" @dragend="draggingCardID = ''" @dragover.prevent @drop="dropLayoutCard('traffic-trend')">
        <DashboardCardControls v-if="editingLayout" :title="t(cardDefinition('traffic-trend').titleKey)" :size="cardLayout('traffic-trend')!.size" :sizes="cardDefinition('traffic-trend').sizes" :first="visibleCardIndex('traffic-trend') === 0" :last="visibleCardIndex('traffic-trend') === visibleCardCount - 1" @resize="updateCardSize('traffic-trend', $event)" @move="moveVisibleCard('traffic-trend', $event)" @remove="removeWidget('traffic-trend')" @pointer-drag="startPointerCardDrag('traffic-trend', $event)" />
        <div class="summary-card-head"><div><span class="section-kicker">24H</span><h3>{{ t('dashboard.trafficTrend') }}</h3></div></div>
        <div class="traffic-live-row">
          <span><i class="rx-dot"></i>{{ t('dashboard.download') }} <strong>{{ fmtBps(hostVal('host.net.rx_bps')) }}</strong></span>
          <span><i class="tx-dot"></i>{{ t('dashboard.upload') }} <strong>{{ fmtBps(hostVal('host.net.tx_bps')) }}</strong></span>
          <span>{{ t('dashboard.trafficPeak') }} <strong>{{ fmtBps(trafficPeak) }}</strong></span>
        </div>
        <MetricChart v-if="trafficChartMetrics.length" class="dashboard-trend-chart compact-chart" :title="t('dashboard.last24Hours')" :metrics="trafficChartMetrics" />
        <div v-else class="summary-empty">{{ t('dashboard.noTrafficHistory') }}</div>
      </section>

      <section v-if="cardVisible('incident-summary')" class="surface overview-summary-card incident-summary-card dashboard-card-shell" :class="incidentSummary?.open ? 'has-problem' : 'is-clear'" :style="cardGridStyle('incident-summary')" data-layout-card="incident-summary" :data-layout-editing="editingLayout || undefined" :data-dragging="draggingCardID === 'incident-summary' || undefined" :draggable="editingLayout" @dragstart="startCardDrag('incident-summary', $event)" @dragend="draggingCardID = ''" @dragover.prevent @drop="dropLayoutCard('incident-summary')">
        <DashboardCardControls v-if="editingLayout" :title="t(cardDefinition('incident-summary').titleKey)" :size="cardLayout('incident-summary')!.size" :sizes="cardDefinition('incident-summary').sizes" :first="visibleCardIndex('incident-summary') === 0" :last="visibleCardIndex('incident-summary') === visibleCardCount - 1" @resize="updateCardSize('incident-summary', $event)" @move="moveVisibleCard('incident-summary', $event)" @remove="removeWidget('incident-summary')" @pointer-drag="startPointerCardDrag('incident-summary', $event)" />
        <div class="summary-card-head">
          <div><span class="section-kicker">SITE · 24H</span><h3>{{ t('dashboard.incidentSummary') }}</h3></div>
          <RouterLink class="text-link" to="/incidents">{{ t('dashboard.viewAll') }} →</RouterLink>
        </div>
        <div class="incident-stat-grid">
          <div><strong>{{ incidentSummary?.open ?? 0 }}</strong><span>{{ t('dashboard.incidentOpen') }}</span></div>
          <div><strong>{{ incidentSummary?.opened_24h ?? 0 }}</strong><span>{{ t('dashboard.incidentOpened24h') }}</span></div>
          <div><strong>{{ incidentSummary?.resolved_24h ?? 0 }}</strong><span>{{ t('dashboard.incidentResolved24h') }}</span></div>
        </div>
        <p class="incident-layer"><span>{{ t('dashboard.incidentTopLayer') }}</span><strong>{{ incidentLayerLabel }}</strong></p>
      </section>

      <article v-if="cardVisible('nat-summary')" class="metric-card nat-kpi dashboard-card-shell" :class="primaryNAT ? `is-${primaryNAT.tone}` : 'is-unknown'" :style="cardGridStyle('nat-summary')" data-layout-card="nat-summary" :data-layout-editing="editingLayout || undefined" :data-dragging="draggingCardID === 'nat-summary' || undefined" :draggable="editingLayout" @dragstart="startCardDrag('nat-summary', $event)" @dragend="draggingCardID = ''" @dragover.prevent @drop="dropLayoutCard('nat-summary')">
        <DashboardCardControls v-if="editingLayout" :title="t(cardDefinition('nat-summary').titleKey)" :size="cardLayout('nat-summary')!.size" :sizes="cardDefinition('nat-summary').sizes" :first="visibleCardIndex('nat-summary') === 0" :last="visibleCardIndex('nat-summary') === visibleCardCount - 1" @resize="updateCardSize('nat-summary', $event)" @move="moveVisibleCard('nat-summary', $event)" @remove="removeWidget('nat-summary')" @pointer-drag="startPointerCardDrag('nat-summary', $event)" />
        <div class="metric-icon nat"><svg viewBox="0 0 24 24"><path d="M12 3v4M5.6 5.6l2.8 2.8M3 12h4M5.6 18.4l2.8-2.8M12 17v4M18.4 18.4l-2.8-2.8M17 12h4M18.4 5.6l-2.8 2.8" /><circle cx="12" cy="12" r="5" /></svg></div>
        <div class="metric-copy"><span>{{ t('dashboard.natType') }}</span><strong class="nat-type-value">{{ primaryNAT?.type ?? t('dashboard.notDetected') }}</strong><p>{{ primaryNAT?.target ?? t('dashboard.natTypeFoot') }}</p></div>
      </article>
      <article v-if="cardVisible('lan-summary')" class="metric-card is-info dashboard-card-shell" :style="cardGridStyle('lan-summary')" data-layout-card="lan-summary" :data-layout-editing="editingLayout || undefined" :data-dragging="draggingCardID === 'lan-summary' || undefined" :draggable="editingLayout" @dragstart="startCardDrag('lan-summary', $event)" @dragend="draggingCardID = ''" @dragover.prevent @drop="dropLayoutCard('lan-summary')">
        <DashboardCardControls v-if="editingLayout" :title="t(cardDefinition('lan-summary').titleKey)" :size="cardLayout('lan-summary')!.size" :sizes="cardDefinition('lan-summary').sizes" :first="visibleCardIndex('lan-summary') === 0" :last="visibleCardIndex('lan-summary') === visibleCardCount - 1" @resize="updateCardSize('lan-summary', $event)" @move="moveVisibleCard('lan-summary', $event)" @remove="removeWidget('lan-summary')" @pointer-drag="startPointerCardDrag('lan-summary', $event)" />
        <div class="metric-icon devices"><svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></svg></div>
        <div class="metric-copy"><span>{{ t('dashboard.lanDevices') }}</span><strong>{{ devices.length }}</strong><p>{{ t('dashboard.lanDevicesFoot') }}</p></div>
      </article>

      <section v-if="(hasHost || editingLayout) && cardVisible('system-status')" class="surface system-monitor-surface dashboard-section dashboard-card-shell" :style="cardGridStyle('system-status')" data-layout-card="system-status" :data-layout-editing="editingLayout || undefined" :data-dragging="draggingCardID === 'system-status' || undefined" :draggable="editingLayout" @dragstart="startCardDrag('system-status', $event)" @dragend="draggingCardID = ''" @dragover.prevent @drop="dropLayoutCard('system-status')">
        <DashboardCardControls v-if="editingLayout" :title="t(cardDefinition('system-status').titleKey)" :size="cardLayout('system-status')!.size" :sizes="cardDefinition('system-status').sizes" :first="visibleCardIndex('system-status') === 0" :last="visibleCardIndex('system-status') === visibleCardCount - 1" @resize="updateCardSize('system-status', $event)" @move="moveVisibleCard('system-status', $event)" @remove="removeWidget('system-status')" @pointer-drag="startPointerCardDrag('system-status', $event)" />
        <div class="surface-head compact">
          <div><span class="section-kicker">HOST</span><h3>{{ t('dashboard.systemStatus') }}</h3></div>
          <RouterLink class="icon-link" :to="{ path: '/target-status', query: { view: 'agents', agent: selected, tab: 'metrics' } }">→</RouterLink>
        </div>
        <div class="system-monitor-grid">
          <div class="monitor-primary-column">
            <article class="monitor-card cpu-monitor-card">
              <div class="monitor-card-title">
                <span class="monitor-icon cpu"><svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3M9 9h6v6H9z"/></svg></span>
                <strong>{{ t('dashboard.cpuUsage') }}</strong>
              </div>
              <div class="cpu-monitor-body">
                <span class="monitor-big-value cpu-value">{{ fmt(hostVal('host.cpu.pct'), 1) }}%</span>
                <span class="usage-ring cpu-ring" :style="ringStyle(hostVal('host.cpu.pct'))"><i></i></span>
              </div>
              <p>{{ t('dashboard.logicalCores', { n: cpuCoreCount || '—' }) }}</p>
            </article>

            <article class="monitor-card memory-monitor-card">
              <div class="monitor-card-title">
                <span class="monitor-icon memory"><svg viewBox="0 0 24 24"><rect x="3" y="7" width="18" height="10" rx="2"/><path d="M7 10v4M11 10v4M15 10v4M19 10v4M6 4v3M10 4v3M14 4v3M18 4v3M6 17v3M10 17v3M14 17v3M18 17v3"/></svg></span>
                <strong>{{ t('dashboard.memory') }}</strong>
              </div>
              <span class="monitor-big-value memory-value">{{ fmt(hostVal('host.mem.pct'), 1) }}%</span>
              <div class="memory-progress"><i :style="{ width: `${hostVal('host.mem.pct') ?? 0}%` }"></i></div>
              <p>{{ fmtBytes(hostVal('host.mem.used')) }} / {{ fmtBytes(hostVal('host.mem.total')) }}</p>
            </article>
          </div>

          <div class="monitor-secondary-column">
            <article class="monitor-card load-monitor-card">
              <div class="monitor-card-title">
                <span class="monitor-icon load"><svg viewBox="0 0 24 24"><path d="M4 16a8 8 0 1 1 16 0M12 12l4-4M6 17h12"/></svg></span>
                <strong>{{ t('dashboard.systemLoad') }}</strong>
              </div>
              <div class="load-levels">
                <div v-for="period in [{ label: '1m', kind: 'host.load.1m' }, { label: '5m', kind: 'host.load.5m' }, { label: '15m', kind: 'host.load.15m' }]" :key="period.kind" class="load-level-item" :class="loadTone(hostVal(period.kind))">
                  <div class="load-level-head"><span>{{ period.label }}</span><em>{{ loadLevel(hostVal(period.kind)) }}</em></div>
                  <strong>{{ fmt(hostVal(period.kind), 2) }}</strong>
                  <div class="load-level-track"><i :style="{ width: `${Math.max(hostVal(period.kind) ? 4 : 0, loadPercent(hostVal(period.kind)))}%` }"></i></div>
                </div>
              </div>
            </article>

            <article class="monitor-card io-monitor-card">
              <div class="monitor-card-title">
                <span class="monitor-icon io"><svg viewBox="0 0 24 24"><path d="M4 19V5M4 19h16M7 15l4-4 3 2 5-7"/></svg></span>
                <strong>{{ t('dashboard.networkIO') }}</strong>
              </div>
              <div class="io-values">
                <div><span class="io-arrow up">↑</span><span>{{ t('dashboard.upload') }}</span><strong>{{ fmtBps(hostVal('host.net.tx_bps')) }}</strong></div>
                <div><span class="io-arrow down">↓</span><span>{{ t('dashboard.download') }}</span><strong>{{ fmtBps(hostVal('host.net.rx_bps')) }}</strong></div>
              </div>
            </article>

            <article class="monitor-card uptime-monitor-card">
              <span class="monitor-icon uptime"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v6l4 2"/></svg></span>
              <div><span>{{ t('dashboard.uptime') }}</span><strong>{{ fmtUptime(hostVal('host.uptime_s')) }}</strong></div>
            </article>
          </div>
        </div>
      </section>

      <section v-if="cardVisible('important-targets')" class="surface services-surface dashboard-section dashboard-card-shell" :style="cardGridStyle('important-targets')" data-layout-card="important-targets" :data-layout-editing="editingLayout || undefined" :data-dragging="draggingCardID === 'important-targets' || undefined" :draggable="editingLayout" @dragstart="startCardDrag('important-targets', $event)" @dragend="draggingCardID = ''" @dragover.prevent @drop="dropLayoutCard('important-targets')">
        <DashboardCardControls v-if="editingLayout" :title="t(cardDefinition('important-targets').titleKey)" :size="cardLayout('important-targets')!.size" :sizes="cardDefinition('important-targets').sizes" :first="visibleCardIndex('important-targets') === 0" :last="visibleCardIndex('important-targets') === visibleCardCount - 1" @resize="updateCardSize('important-targets', $event)" @move="moveVisibleCard('important-targets', $event)" @remove="removeWidget('important-targets')" @pointer-drag="startPointerCardDrag('important-targets', $event)" />
        <div class="surface-head">
          <div><span class="section-kicker">{{ t('dashboard.monitoring') }}</span><h3>{{ t('dashboard.serviceStatus') }}</h3></div>
          <RouterLink class="text-link" to="/target-status">{{ t('dashboard.viewAll') }} →</RouterLink>
        </div>
        <div class="service-columns">
          <div class="service-group">
            <div class="service-title"><span class="service-symbol icmp"><svg viewBox="0 0 24 24"><path d="M3 12h4l2-5 4 10 2-5h6"/></svg></span><strong>{{ t('dashboard.publicReach') }}</strong><b>{{ publicTargets.length }}</b></div>
            <div v-if="!publicTargets.length" class="mini-empty">{{ t('common.noData') }}</div>
            <div v-for="sample in publicTargets.slice(0, 4)" :key="rowKey(sample)" class="service-row">
              <span class="target-name mono">{{ sample.target }}</span><span class="value">{{ sample.value.toFixed(0) }} ms</span>
            </div>
          </div>
          <div class="service-group">
            <div class="service-title"><span class="service-symbol dns"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 4 6 4 9s-1 6-4 9c-3-3-4-6-4-9s1-6 4-9z"/></svg></span><strong>{{ t('dashboard.dnsResolve') }}</strong><b>{{ dnsTargets.length }}</b></div>
            <div v-if="!dnsTargets.length" class="mini-empty">{{ t('dashboard.noDataDns') }}</div>
            <div v-for="sample in dnsTargets.slice(0, 4)" :key="rowKey(sample)" class="service-row">
              <span class="target-name mono">{{ sample.target }}</span><span class="value">{{ sample.value.toFixed(0) }} ms</span>
            </div>
          </div>
          <div class="service-group">
            <div class="service-title"><span class="service-symbol http"><svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M7 6.5h.01M10 6.5h.01"/></svg></span><strong>{{ t('dashboard.httpTitle') }}</strong><b>{{ httpRows.length }}</b></div>
            <div v-if="!httpRows.length" class="mini-empty">{{ t('dashboard.noDataHttp') }}</div>
            <div v-for="row in httpRows.slice(0, 4)" :key="row.key" class="service-row">
              <span class="target-name mono">{{ row.url }}</span>
              <span class="http-status" :class="probeToneClass(row.probeState)">{{ row.status }}</span>
              <span class="value">{{ row.latency == null ? '—' : `${row.latency.toFixed(0)} ms` }}</span>
            </div>
          </div>
          <div class="service-group">
            <div class="service-title"><span class="service-symbol nat"><svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="2"/><circle cx="5" cy="18" r="2"/><circle cx="19" cy="18" r="2"/><path d="M12 7v4M5 16v-3h14v3M12 11v2"/></svg></span><strong>{{ t('dashboard.natDetails') }}</strong><b>{{ natRows.length }}</b></div>
            <div v-if="!natRows.length" class="mini-empty">{{ t('dashboard.notDetected') }}</div>
            <div v-for="row in natRows.slice(0, 4)" :key="row.key" class="service-row nat-service-row">
              <span class="nat-service-copy"><strong>{{ row.type }}</strong><small class="mono">{{ row.target }}</small></span>
              <span class="reach-chip" :class="probeToneClass(row.probeState)">{{ natReachLabel(row.probeState) }}</span>
            </div>
          </div>
        </div>
      </section>

        <section v-if="cardVisible('lan-devices')" class="surface overview-resource-panel devices-surface dashboard-card-shell" :style="cardGridStyle('lan-devices')" data-layout-card="lan-devices" :data-layout-editing="editingLayout || undefined" :data-dragging="draggingCardID === 'lan-devices' || undefined" :draggable="editingLayout" @dragstart="startCardDrag('lan-devices', $event)" @dragend="draggingCardID = ''" @dragover.prevent @drop="dropLayoutCard('lan-devices')">
          <DashboardCardControls v-if="editingLayout" :title="t(cardDefinition('lan-devices').titleKey)" :size="cardLayout('lan-devices')!.size" :sizes="cardDefinition('lan-devices').sizes" :first="visibleCardIndex('lan-devices') === 0" :last="visibleCardIndex('lan-devices') === visibleCardCount - 1" @resize="updateCardSize('lan-devices', $event)" @move="moveVisibleCard('lan-devices', $event)" @remove="removeWidget('lan-devices')" @pointer-drag="startPointerCardDrag('lan-devices', $event)" />
          <div class="resource-panel-head">
            <span class="resource-panel-icon devices"><svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg></span>
            <h3>{{ t('dashboard.lanDevices') }}</h3>
            <span>{{ t('dashboard.deviceCount', { n: devices.length }) }}</span>
          </div>
          <div v-if="!devices.length" class="mini-empty resource-panel-empty">{{ t('dashboard.noDeviceYet') }}</div>
          <div v-else class="resource-panel-scroll device-scroll">
            <div class="device-columns">
              <div v-for="(column, columnIndex) in deviceColumns" :key="columnIndex" class="compact-column">
                <article v-for="row in column" :key="`${row.device.mac}-${row.number}`" class="device-row">
                  <span class="row-number">{{ row.number }}</span>
                  <span class="compact-item-icon device"><svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg></span>
                  <span class="compact-item-copy">
                    <strong>{{ row.device.hostname || row.device.ip }}</strong>
                    <small class="mono">{{ row.device.hostname ? `${row.device.ip} · ${row.device.mac}` : row.device.mac }}</small>
                  </span>
                </article>
              </div>
            </div>
          </div>
        </section>

        <section v-if="cardVisible('interfaces')" class="surface overview-resource-panel interface-surface dashboard-card-shell" :style="cardGridStyle('interfaces')" data-layout-card="interfaces" :data-layout-editing="editingLayout || undefined" :data-dragging="draggingCardID === 'interfaces' || undefined" :draggable="editingLayout" @dragstart="startCardDrag('interfaces', $event)" @dragend="draggingCardID = ''" @dragover.prevent @drop="dropLayoutCard('interfaces')">
          <DashboardCardControls v-if="editingLayout" :title="t(cardDefinition('interfaces').titleKey)" :size="cardLayout('interfaces')!.size" :sizes="cardDefinition('interfaces').sizes" :first="visibleCardIndex('interfaces') === 0" :last="visibleCardIndex('interfaces') === visibleCardCount - 1" @resize="updateCardSize('interfaces', $event)" @move="moveVisibleCard('interfaces', $event)" @remove="removeWidget('interfaces')" @pointer-drag="startPointerCardDrag('interfaces', $event)" />
          <div class="resource-panel-head">
            <span class="resource-panel-icon interfaces"><svg viewBox="0 0 24 24"><rect x="5" y="7" width="14" height="10" rx="2"/><path d="M9 11h6M12 7V3M12 17v4M8 3h8"/></svg></span>
            <h3>{{ t('dashboard.adapterList') }}</h3>
            <span>{{ t('dashboard.adapterCount', { n: interfaceRows.length }) }}</span>
          </div>
          <div v-if="!interfaceRows.length" class="mini-empty resource-panel-empty">{{ t('common.noData') }}</div>
          <div v-else class="resource-panel-scroll adapter-scroll">
            <div class="adapter-list">
              <article v-for="item in interfaceRows" :key="item.name" class="adapter-row" :class="{ 'has-wifi': item.wifi?.connected }">
                <span v-if="item.isWireless" class="compact-item-icon wifi"><svg viewBox="0 0 24 24"><path d="M4 9a13 13 0 0 1 16 0M7 12.5a8 8 0 0 1 10 0M10 16a3 3 0 0 1 4 0"/><circle cx="12" cy="19" r="1"/></svg></span>
                <span v-else class="compact-item-icon interface"><svg viewBox="0 0 24 24"><path d="M5 8h14v8H5zM9 12h6M12 8V4M12 16v4"/></svg></span>
                <span class="adapter-copy">
                  <span class="adapter-name-line">
                    <strong>{{ item.name }}</strong>
                    <small v-if="!item.wifi">{{ t('dashboard.networkAdapter') }}</small>
                  </span>
                  <small v-if="item.wifi" class="wifi-summary">
                    <span :class="wifiStateTone(item.wifi)">{{ wifiStateLabel(item.wifi) }}</span>
                    <template v-if="item.wifi.connected">
                      · {{ item.wifi.ssid || t('dashboard.wifiHiddenSsid') }}
                      <template v-if="item.wifi.band"> · {{ wifiBandLabel(item.wifi.band) }}</template>
                      <template v-if="item.wifi.channel"> · {{ t('dashboard.wifiChannelShort', { n: item.wifi.channel }) }}</template>
                    </template>
                    <template v-if="item.wifi.reason === 'permission'"> · {{ t('dashboard.wifiPermission') }}</template>
                  </small>
                </span>
                <div v-if="item.wifi?.connected" class="wifi-metrics">
                  <span class="wifi-metric">
                    <i>{{ t('dashboard.wifiSignal') }}</i>
                    <b :class="item.wifi.grade ? `grade-${item.wifi.grade.tone}` : ''">{{ item.wifi.signalDbm == null ? '—' : `${item.wifi.signalDbm} dBm` }}</b>
                    <em v-if="item.wifi.grade" :class="`grade-${item.wifi.grade.tone}`">{{ item.wifi.grade.label }}</em>
                  </span>
                  <span class="wifi-metric">
                    <i>{{ t('dashboard.wifiQuality') }}</i>
                    <b>{{ item.wifi.quality == null ? '—' : `${item.wifi.quality.toFixed(0)}%` }}</b>
                  </span>
                  <span class="wifi-metric">
                    <i>{{ t('dashboard.wifiLinkRate') }}</i>
                    <b>{{ item.wifi.rxMbps == null && item.wifi.txMbps == null ? '—' : `${item.wifi.rxMbps == null ? '—' : item.wifi.rxMbps.toFixed(0)} / ${item.wifi.txMbps == null ? '—' : item.wifi.txMbps.toFixed(0)} Mbps` }}</b>
                  </span>
                </div>
                <span class="state-pill" :class="item.up ? 'good' : 'bad'">{{ item.up ? 'UP' : 'DOWN' }}</span>
              </article>
            </div>
          </div>
        </section>

        <section v-if="cardVisible('disks')" class="surface overview-resource-panel disk-surface dashboard-card-shell" :style="cardGridStyle('disks')" data-layout-card="disks" :data-layout-editing="editingLayout || undefined" :data-dragging="draggingCardID === 'disks' || undefined" :draggable="editingLayout" @dragstart="startCardDrag('disks', $event)" @dragend="draggingCardID = ''" @dragover.prevent @drop="dropLayoutCard('disks')">
          <DashboardCardControls v-if="editingLayout" :title="t(cardDefinition('disks').titleKey)" :size="cardLayout('disks')!.size" :sizes="cardDefinition('disks').sizes" :first="visibleCardIndex('disks') === 0" :last="visibleCardIndex('disks') === visibleCardCount - 1" @resize="updateCardSize('disks', $event)" @move="moveVisibleCard('disks', $event)" @remove="removeWidget('disks')" @pointer-drag="startPointerCardDrag('disks', $event)" />
          <div class="resource-panel-head">
            <span class="resource-panel-icon disks"><svg viewBox="0 0 24 24"><path d="M5 4h14l2 5v10H3V9l2-5zM3 10h18M7 15h.01M11 15h6"/></svg></span>
            <h3>{{ t('dashboard.diskStatus') }}</h3>
            <span>{{ t('dashboard.diskCount', { n: diskMounts.length }) }}</span>
          </div>
          <div v-if="!diskMounts.length" class="mini-empty resource-panel-empty">{{ t('common.noData') }}</div>
          <div v-else class="resource-panel-scroll disk-scroll">
            <div class="disk-list">
              <article v-for="(mount, index) in diskMounts" :key="mount" class="disk-overview-item" :class="`disk-tone-${index % 3}`">
                <span class="disk-usage-ring" :style="ringStyle(hostVal('host.disk.pct', mount))">
                  <strong>{{ fmt(hostVal('host.disk.pct', mount), 1) }}%</strong>
                </span>
                <span class="disk-overview-copy">
                  <span class="disk-name-line"><strong class="mono">{{ mount }}</strong><small>{{ t('dashboard.storage') }}</small></span>
                  <span class="disk-progress"><i :style="{ width: `${hostVal('host.disk.pct', mount) ?? 0}%` }"></i></span>
                  <small class="disk-capacity">{{ fmtBytes(hostVal('host.disk.used', mount)) }} / {{ fmtBytes(hostVal('host.disk.total', mount)) }}</small>
                </span>
              </article>
            </div>
          </div>
        </section>

        <section v-if="cardVisible('activity')" class="surface overview-resource-panel activity-surface dashboard-card-shell" :style="cardGridStyle('activity')" data-layout-card="activity" :data-layout-editing="editingLayout || undefined" :data-dragging="draggingCardID === 'activity' || undefined" :draggable="editingLayout" @dragstart="startCardDrag('activity', $event)" @dragend="draggingCardID = ''" @dragover.prevent @drop="dropLayoutCard('activity')">
          <DashboardCardControls v-if="editingLayout" :title="t(cardDefinition('activity').titleKey)" :size="cardLayout('activity')!.size" :sizes="cardDefinition('activity').sizes" :first="visibleCardIndex('activity') === 0" :last="visibleCardIndex('activity') === visibleCardCount - 1" @resize="updateCardSize('activity', $event)" @move="moveVisibleCard('activity', $event)" @remove="removeWidget('activity')" @pointer-drag="startPointerCardDrag('activity', $event)" />
          <div class="resource-panel-head">
            <span class="resource-panel-icon activity"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v6l4 2"/></svg></span>
            <h3>{{ t('dashboard.recentActivity') }}</h3>
            <span>{{ t('dashboard.activityCount', { n: statusHistory.length }) }}</span>
          </div>
          <div v-if="!statusHistory.length" class="mini-empty resource-panel-empty">{{ t('dashboard.noStatusChange') }}</div>
          <div v-else class="resource-panel-scroll activity-timeline">
            <div class="timeline-track">
              <article
                v-for="(event, index) in statusHistory"
                :key="`${event.changed_at}-${index}`"
                class="timeline-event"
                :class="event.status === 'online' ? 'is-online' : 'is-offline'"
              >
                <span class="timeline-content">
                  <span class="row-number">{{ index + 1 }}</span>
                  <strong>{{ event.status === 'online' ? t('dashboard.statusOnline') : t('dashboard.statusOffline') }}</strong>
                  <small>{{ t('dashboard.agentStateChanged') }}</small>
                  <time :datetime="event.changed_at">{{ fmtTime(event.changed_at) }}</time>
                </span>
                <span class="timeline-marker" :class="event.status === 'online' ? 'good' : 'bad'"><i>{{ event.status === 'online' ? '↑' : '↓' }}</i></span>
              </article>
            </div>
          </div>
        </section>

        <section v-for="item in targetCardViews" :key="item.card.id" class="surface monitor-target-card dashboard-card-shell" :style="cardGridStyle(item.card.id)" :data-layout-card="item.card.id" :data-layout-editing="editingLayout || undefined" :data-dragging="draggingCardID === item.card.id || undefined" :draggable="editingLayout" @dragstart="startCardDrag(item.card.id, $event)" @dragend="draggingCardID = ''" @dragover.prevent @drop="dropLayoutCard(item.card.id)">
          <DashboardCardControls v-if="editingLayout" :title="item.target?.name ?? t('dashboard.targetDeleted')" :size="item.card.size" :sizes="cardDefinition(item.card.id).sizes" :first="visibleCardIndex(item.card.id) === 0" :last="visibleCardIndex(item.card.id) === visibleCardCount - 1" @resize="updateCardSize(item.card.id, $event)" @move="moveVisibleCard(item.card.id, $event)" @remove="removeWidget(item.card.id)" @pointer-drag="startPointerCardDrag(item.card.id, $event)" />
          <DashboardTargetCard v-if="item.target" :target="item.target" :agent-id="selected" :samples="samplesForTarget(item.target.target_id)" />
          <div v-else class="missing-target-card"><strong>{{ t('dashboard.targetDeleted') }}</strong><p>{{ t('dashboard.targetDeletedHint') }}</p></div>
        </section>
      </div>
        <section v-if="allCardsHidden" class="card empty-layout-state">
          <h3>{{ t('dashboard.layoutAllHidden') }}</h3>
          <p>{{ t('dashboard.layoutAllHiddenHint') }}</p>
          <button v-if="!editingLayout" class="btn btn-primary" type="button" @click="beginLayoutEdit">{{ t('dashboard.layoutAddWidget') }}</button>
        </section>
    </template>
    <Teleport to="body">
      <div v-if="targetCardDrawerOpen" class="target-card-drawer-backdrop" @click.self="targetCardDrawerOpen = false">
        <aside class="target-card-drawer" role="dialog" aria-modal="true" :aria-label="t('dashboard.addMonitorCard')">
          <header><div><span class="section-kicker">MONITOR</span><h3>{{ t('dashboard.addMonitorCard') }}</h3></div><button type="button" :aria-label="t('common.close')" @click="targetCardDrawerOpen = false">×</button></header>
          <div class="target-card-form">
            <label><span>{{ t('dashboard.monitorCardType') }}</span><select v-model="newTargetKind" @change="changeTargetCardKind"><option v-for="kind in availableMonitorKinds" :key="kind" :value="kind">{{ te(`dashboard.monitorType_${kind}`) ? t(`dashboard.monitorType_${kind}`) : kind.toUpperCase() }}</option></select></label>
            <label><span>{{ t('dashboard.monitorCardTarget') }}</span><select v-model="newTargetID"><option v-for="target in newTargetOptions" :key="target.target_id" :value="target.target_id">{{ target.name }} · {{ target.target }}</option></select></label>
            <p :class="{ 'is-limit': layoutAtCardLimit }">{{ layoutAtCardLimit ? t('dashboard.monitorCardLimitHint') : t('dashboard.monitorCardFilterHint') }}</p>
          </div>
          <div class="target-card-preview"><span>{{ t('dashboard.monitorCardPreview') }}</span><DashboardTargetCard v-if="pendingTargetCard" :target="pendingTargetCard" :agent-id="selected" :samples="samplesForTarget(pendingTargetCard.target_id)" /><div v-else class="missing-target-card">{{ t('dashboard.monitorCardNoTargets') }}</div></div>
          <footer><button class="btn" type="button" @click="targetCardDrawerOpen = false">{{ t('dashboard.layoutCancel') }}</button><button class="btn btn-primary" type="button" :disabled="!pendingTargetCard || layoutAtCardLimit" @click="addTargetCard">{{ t('dashboard.addToOverview') }}</button></footer>
        </aside>
      </div>
    </Teleport>
  </main>
</template>

<style scoped>
/* Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V4
 * macrostructure: Workbench · genre: operational · design-system: design.md
 */
.dashboard-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; margin-bottom: 24px; }
.dashboard-head h2 { font-family: var(--font-display); font-size: clamp(26px, 3vw, 34px); letter-spacing: -.028em; }
.dashboard-head p { margin: 6px 0 0; color: var(--color-muted); }
.eyebrow, .section-kicker { color: var(--color-accent-text); font-size: 10px; font-weight: 750; letter-spacing: .14em; text-transform: uppercase; }
.eyebrow { display: flex; align-items: center; gap: 8px; margin-bottom: 7px; }
.pulse-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--color-success); box-shadow: 0 0 0 5px color-mix(in srgb, var(--color-success) 14%, transparent); }
.head-actions { display: flex; align-items: flex-end; gap: 10px; }
.agent-picker { display: grid; gap: 5px; }
.agent-picker > span { padding-left: 2px; font-size: 10px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; }
.agent-picker select { min-width: 240px; height: 44px; background: var(--color-glass); }
.refresh-button { display: grid; place-items: center; width: 44px; height: 44px; color: var(--color-ink-2); border: 1px solid var(--color-rule-2); border-radius: var(--radius-input); background: var(--color-glass); cursor: pointer; }
.refresh-button:hover,
.refresh-button:focus-visible { color: var(--color-accent-text); border-color: var(--color-accent); }
.refresh-button:focus-visible { outline: 2px solid var(--color-focus); outline-offset: 2px; }
.refresh-button svg { width: 17px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.refresh-button.spinning svg { animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.dashboard-error { margin-bottom: 16px; }
.dashboard-loading { display: flex; justify-content: center; gap: 8px; padding: 100px; }
.dashboard-loading span { width: 7px; height: 7px; border-radius: 50%; background: var(--color-accent); animation: bounce 1s infinite alternate; }
.dashboard-loading span:nth-child(2) { animation-delay: .2s; }.dashboard-loading span:nth-child(3) { animation-delay: .4s; }
@keyframes bounce { to { transform: translateY(-8px); opacity: .35; } }
.empty { display: grid; place-items: center; text-align: center; gap: 8px; padding: 64px 20px; }
.empty-ico { display: grid; place-items: center; width: 64px; height: 64px; color: var(--color-accent-text); background: color-mix(in srgb, var(--color-accent) 14%, transparent); border-radius: 20px; }
.empty-ico svg { width: 30px; }

.agent-hero {
  --health-color: var(--color-neutral);
  --health-border-color: var(--glass-border);
  position: relative;
  display: grid;
  grid-template-columns: minmax(260px, 1.5fr) minmax(170px, .8fr) auto;
  align-items: center;
  gap: 28px;
  min-height: 144px;
  margin-bottom: 18px;
  padding: 28px 30px;
  overflow: hidden;
  border: 1px solid var(--health-border-color);
  border-radius: var(--radius-panel);
  background: var(--glass-specular), var(--color-glass-strong);
  box-shadow: inset 0 1px var(--glass-highlight), var(--shadow-card);
  backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
}
.agent-hero.health-good { --health-color: var(--color-success); }
.agent-hero.health-warn {
  --health-color: var(--color-warning);
  --health-border-color: color-mix(in srgb, var(--color-warning) 34%, var(--color-rule));
}
.agent-hero.health-bad {
  --health-color: var(--color-danger);
  --health-border-color: color-mix(in srgb, var(--color-danger) 34%, var(--color-rule));
}
.agent-identity { display: flex; align-items: center; gap: 16px; min-width: 0; z-index: 1; }
.agent-mark { display: grid; place-items: center; width: 58px; height: 58px; flex: none; color: var(--color-accent-text); border: 1px solid color-mix(in srgb, var(--color-accent) 30%, transparent); border-radius: 17px; background: color-mix(in srgb, var(--color-accent) 14%, transparent); }
.agent-mark svg { width: 28px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
.agent-line { display: flex; align-items: center; gap: 10px; min-width: 0; }.agent-line h3 { overflow: hidden; font-size: 20px; text-overflow: ellipsis; white-space: nowrap; }
.agent-identity p { margin: 5px 0 0; color: var(--color-muted); font-size: 12px; }
.status-chip { display: inline-flex; align-items: center; gap: 6px; padding: 3px 9px; font-size: 10px; font-weight: 700; border-radius: 999px; }
.status-chip i { width: 6px; height: 6px; border-radius: 50%; background: var(--status-dot-color); }.status-chip.online { --status-dot-color: var(--color-success); color: var(--color-success-text); background: color-mix(in srgb, var(--color-success) 14%, transparent); }.status-chip.offline { --status-dot-color: var(--color-danger); color: var(--color-danger-text); background: color-mix(in srgb, var(--color-danger) 14%, transparent); }
.health-summary { display: grid; gap: 3px; z-index: 1; }.health-summary > span { color: var(--color-muted); font-size: 11px; text-transform: uppercase; letter-spacing: .08em; }.health-summary strong { font-size: 22px; }.health-summary small { color: var(--color-muted); font-size: 11px; }
.health-good .health-summary strong { color: var(--color-success-text); }.health-warn .health-summary strong { color: var(--color-warning-text); }.health-bad .health-summary strong { color: var(--color-danger-text); }
.fleet-summary { display: flex; gap: 26px; padding-left: 26px; border-left: 1px solid var(--color-rule); z-index: 1; }.fleet-summary div { display: grid; }.fleet-summary strong { font-size: 24px; line-height: 1.1; }.fleet-summary span { color: var(--color-muted); font-size: 10px; white-space: nowrap; }

.metric-card { position: relative; display: flex; align-items: center; gap: 14px; min-height: 126px; padding: 20px; overflow: hidden; border: 1px solid var(--glass-border); border-radius: var(--radius-card); background: var(--glass-specular), var(--color-glass); box-shadow: var(--shadow-card); backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate)); -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate)); }
.metric-card.is-good { --metric-color: var(--color-success); color: var(--color-success-text); }.metric-card.is-warn { --metric-color: var(--color-warning); color: var(--color-warning-text); }.metric-card.is-bad { --metric-color: var(--color-danger); color: var(--color-danger-text); }.metric-card.is-unknown, .metric-card.is-info { --metric-color: var(--color-accent); color: var(--color-accent-text); }
.metric-icon { display: grid; place-items: center; width: 46px; height: 46px; flex: none; color: currentColor; border-radius: 14px; background: color-mix(in srgb, var(--metric-color) 12%, transparent); }
.metric-icon svg { width: 23px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
.metric-copy { min-width: 0; }.metric-copy > span { display: block; color: var(--color-muted); font-size: 11px; font-weight: 650; letter-spacing: .06em; text-transform: uppercase; }.metric-copy strong { display: block; margin-top: 5px; overflow: hidden; color: var(--color-ink); font-size: 27px; line-height: 1.15; letter-spacing: -.025em; text-overflow: ellipsis; white-space: nowrap; }.metric-copy strong small { margin-left: 4px; color: var(--color-muted); font-size: 12px; font-weight: 500; }.metric-copy p { margin: 5px 0 0; overflow: hidden; color: var(--color-muted); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }.metric-copy .nat-type-value { font-size: clamp(17px, 1.7vw, 23px); }

.dashboard-section { margin-bottom: 18px; }
.surface {
  overflow: hidden;
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-card);
  background: var(--glass-specular), var(--color-glass);
  box-shadow: inset 0 1px var(--glass-highlight), var(--shadow-card);
  backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
}
.surface-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 18px 20px 14px; }.surface-head.compact { padding-bottom: 14px; border-bottom: 1px solid var(--color-rule); }.surface-head h3 { margin-top: 3px; font-size: 16px; }.range-chip, .count-chip { padding: 4px 9px; color: var(--color-muted); font-size: 10px; border: 1px solid var(--color-rule); border-radius: 999px; background: var(--color-glass-subtle); }.text-link, .icon-link { color: var(--color-accent-text); font-size: 12px; }.text-link:focus-visible, .icon-link:focus-visible { border-radius: var(--radius-xs); outline: 2px solid var(--color-focus); outline-offset: 2px; }.icon-link { display: grid; place-items: center; width: 44px; height: 44px; border-radius: var(--radius-xs); background: color-mix(in srgb, var(--color-accent) 14%, transparent); }
.services-surface { padding-bottom: 4px; }.service-columns { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); border-top: 1px solid var(--color-rule); }.service-group { min-width: 0; padding: 16px 18px; }.service-group + .service-group { border-left: 1px solid var(--color-rule); }.service-title { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }.service-title strong { overflow: hidden; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }.service-title b { margin-left: auto; color: var(--color-muted); font-size: 10px; }.service-symbol { display: grid; place-items: center; width: 29px; height: 29px; flex: none; border-radius: 9px; }.service-symbol svg { width: 17px; height: 17px; overflow: visible; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }.service-symbol.icmp { color: var(--color-accent-text); background: color-mix(in srgb, var(--color-accent) 14%, transparent); }.service-symbol.dns { color: var(--color-info-text); background: color-mix(in srgb, var(--color-info) 13%, transparent); }.service-symbol.http { color: var(--color-warning-text); background: color-mix(in srgb, var(--color-warning) 12%, transparent); }.service-symbol.nat { color: var(--color-success-text); background: color-mix(in srgb, var(--color-success) 14%, transparent); }
.service-row { display: flex; align-items: center; gap: 7px; min-height: 31px; border-top: 1px solid color-mix(in srgb, var(--color-rule) 60%, transparent); }.service-row:first-of-type { border-top: 0; }.target-name { flex: 1; overflow: hidden; color: var(--color-ink-2); text-overflow: ellipsis; white-space: nowrap; }.service-row .value { color: var(--color-ink); font-size: 11px; font-variant-numeric: tabular-nums; white-space: nowrap; }.http-status { padding: 1px 5px; font-size: 9px; font-weight: 700; border-radius: 5px; }.http-status.good { color: var(--color-success-text); background: color-mix(in srgb, var(--color-success) 14%, transparent); }.http-status.bad { color: var(--color-danger-text); background: color-mix(in srgb, var(--color-danger) 14%, transparent); }.http-status.warn { color: var(--color-warning-text); background: color-mix(in srgb, var(--color-warning) 14%, transparent); }.mini-empty { padding: 16px 0; color: var(--color-muted); font-size: 11px; }.mini-empty.padded { padding: 28px 20px; text-align: center; }

.system-monitor-surface { padding-bottom: 16px; }.system-monitor-grid { display: grid; grid-template-columns: minmax(280px, .95fr) minmax(420px, 1.25fr); gap: 14px; padding: 16px; }.monitor-primary-column, .monitor-secondary-column { display: grid; gap: 14px; min-width: 0; }.monitor-primary-column { grid-template-rows: 1fr 1fr; }.monitor-secondary-column { grid-template-rows: auto 1fr auto; }.monitor-card { min-width: 0; padding: 18px 20px; border: 0; border-radius: var(--radius-input); background: var(--color-glass-subtle); box-shadow: none; }.monitor-card-title { display: flex; align-items: center; gap: 10px; }.monitor-card-title > strong { font-size: 14px; }.monitor-icon { display: grid; place-items: center; width: 30px; height: 30px; flex: none; border-radius: 9px; }.monitor-icon svg { width: 20px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }.monitor-icon.cpu { color: var(--color-success-text); background: color-mix(in srgb, var(--color-success) 14%, transparent); }.monitor-icon.memory, .monitor-icon.load, .monitor-icon.io, .monitor-icon.uptime { color: var(--color-accent-text); background: color-mix(in srgb, var(--color-accent) 14%, transparent); }.monitor-big-value { display: block; margin-top: 14px; font-size: clamp(34px, 4vw, 48px); font-weight: 700; line-height: 1; letter-spacing: -.04em; font-variant-numeric: tabular-nums; }.cpu-value { color: var(--color-success-text); }.memory-value { color: var(--color-accent-text); }.monitor-card p { margin: 12px 0 0; color: var(--color-muted); font-size: 12px; }.cpu-monitor-body { display: flex; align-items: center; justify-content: space-between; gap: 20px; }.usage-ring { --usage-angle: 0deg; position: relative; display: block; width: 70px; height: 70px; flex: none; border-radius: 50%; background: conic-gradient(var(--color-success) var(--usage-angle), color-mix(in srgb, var(--color-success) 13%, var(--color-glass-subtle)) 0); }.usage-ring::after { content: ''; position: absolute; inset: 9px; border-radius: 50%; background: var(--color-paper-2); }.usage-ring i { position: absolute; inset: 16px; z-index: 1; border-radius: 50%; background: var(--color-glass-subtle); }.memory-progress { height: 8px; margin-top: 18px; overflow: hidden; border-radius: var(--radius-pill); background: color-mix(in srgb, var(--color-accent) 12%, var(--color-glass)); }.memory-progress i { display: block; height: 100%; border-radius: inherit; background: var(--color-accent); }.load-monitor-card { padding-bottom: 14px; }.load-dials { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-top: 10px; }.load-dial-item { display: grid; justify-items: center; min-width: 0; }.load-dial-item > span { margin-top: -2px; color: var(--color-muted); font-size: 11px; white-space: nowrap; }.load-dial-item > span strong { color: var(--color-ink); }.load-dial { --needle-angle: -125deg; position: relative; width: 74px; height: 48px; overflow: hidden; }.load-dial::before { content: ''; position: absolute; left: 5px; top: 5px; width: 64px; height: 64px; border-radius: 50%; background: conic-gradient(from 225deg, var(--color-success) 0 17%, var(--color-accent) 17% 36%, var(--color-warning) 36% 50%, var(--color-danger) 50% 56%, transparent 56% 100%); -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 9px), var(--color-ink) 0); mask: radial-gradient(farthest-side, transparent calc(100% - 9px), var(--color-ink) 0); opacity: .9; }.load-dial i { position: absolute; left: 36px; bottom: 4px; width: 2px; height: 27px; z-index: 1; border-radius: 2px; background: var(--color-ink); transform: rotate(var(--needle-angle)); transform-origin: 50% 100%; }.load-dial b { position: absolute; left: 32px; bottom: 0; width: 10px; height: 10px; z-index: 2; border: 3px solid var(--color-paper-2); border-radius: 50%; background: var(--color-ink); }.io-monitor-card { display: grid; align-content: center; }.io-values { display: grid; gap: 10px; margin-top: 14px; }.io-values > div { display: grid; grid-template-columns: 24px 70px 1fr; align-items: center; gap: 6px; }.io-values span { color: var(--color-muted); }.io-values strong { font-size: 16px; font-variant-numeric: tabular-nums; }.io-arrow { font-size: 22px; line-height: 1; }.io-arrow.up { color: var(--color-success-text); }.io-arrow.down { color: var(--color-accent-text); }.uptime-monitor-card { display: flex; align-items: center; gap: 14px; padding-top: 14px; padding-bottom: 14px; }.uptime-monitor-card > div { display: grid; }.uptime-monitor-card span { color: var(--color-muted); font-size: 11px; }.uptime-monitor-card strong { margin-top: 2px; font-size: 20px; font-variant-numeric: tabular-nums; }
.system-monitor-surface { container-type: inline-size; }
@container (max-width: 680px) {
  .system-monitor-surface .system-monitor-grid { grid-template-columns: 1fr; }
  .system-monitor-surface .monitor-primary-column {
    grid-template-columns: 1fr 1fr;
    grid-template-rows: auto;
  }
  .system-monitor-surface .monitor-secondary-column {
    grid-template-columns: 1fr 1fr;
    grid-template-rows: auto;
  }
  .system-monitor-surface .load-monitor-card { grid-column: 1 / -1; }
}
.resource-card { display: grid; align-content: center; min-width: 0; min-height: 92px; padding: 15px 16px; border: 1px solid var(--color-rule); border-radius: 13px; background: var(--color-glass-subtle); }.resource-card > div:first-child { display: flex; justify-content: space-between; gap: 12px; font-size: 11px; }.resource-card span { color: var(--color-muted); }.resource-card em { margin-left: 4px; color: var(--color-ink-2); font-style: normal; }.resource-card strong { font-variant-numeric: tabular-nums; }.resource-card > small { display: block; margin-top: 5px; color: var(--color-muted); font-size: 9px; text-align: right; }.resource-track { height: 5px; margin-top: 9px; overflow: hidden; border-radius: 99px; background: var(--color-glass); }.resource-track i { display: block; height: 100%; border-radius: inherit; background: var(--color-accent); }.resource-track i.is-good { background: var(--color-success); }.resource-track i.is-warn { background: var(--color-warning); }.resource-track i.is-bad { background: var(--color-danger); }

/* Keep the system monitor compact so its inner cards have a useful width. */
.system-monitor-grid { grid-template-columns: minmax(210px, .9fr) minmax(320px, 1.1fr); gap: 10px; padding: 12px; }
.monitor-primary-column,
.monitor-secondary-column { gap: 10px; }
.monitor-card { padding: 12px 14px; border-radius: 12px; }
.monitor-card-title { gap: 8px; }
.monitor-card-title > strong { font-size: 13px; }
.monitor-icon { width: 27px; height: 27px; border-radius: 8px; }
.monitor-icon svg { width: 17px; }
.monitor-big-value { margin-top: 9px; font-size: clamp(30px, 3vw, 40px); }
.monitor-card p { margin-top: 8px; font-size: 11px; }
.cpu-monitor-body { gap: 12px; }
.usage-ring { width: 58px; height: 58px; }
.usage-ring::after { inset: 7px; }
.usage-ring i { inset: 13px; }
.memory-progress { height: 7px; margin-top: 12px; }
.load-monitor-card { padding-bottom: 9px; }
.load-dials { gap: 6px; margin-top: 5px; }
.load-dial { width: 66px; height: 42px; transform: scale(.88); transform-origin: center bottom; }
.load-dial-item > span { font-size: 10px; }
.io-values { gap: 6px; margin-top: 8px; }
.io-values > div { grid-template-columns: 20px 54px 1fr; gap: 4px; }
.io-values strong { font-size: 14px; }
.io-arrow { font-size: 19px; }
.uptime-monitor-card { gap: 10px; padding-top: 10px; padding-bottom: 10px; }
.uptime-monitor-card strong { font-size: 17px; }
.load-levels { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-top: 8px; }
.load-level-item { --load-color: var(--color-success); --load-text-color: var(--color-success-text); min-width: 0; padding: 8px 9px; border: 1px solid var(--color-rule); border-radius: 10px; background: color-mix(in srgb, var(--color-glass) 58%, transparent); }
.load-level-head { display: flex; align-items: center; justify-content: space-between; gap: 5px; }
.load-level-head > span { color: var(--color-muted); font-size: 10px; font-weight: 650; }
.load-level-head em { padding: 1px 5px; color: var(--load-text-color); font-size: 8px; font-style: normal; font-weight: 750; border-radius: 999px; background: color-mix(in srgb, var(--load-color) 13%, transparent); white-space: nowrap; }
.load-level-item > strong { display: block; margin-top: 4px; color: var(--load-text-color); font-size: 18px; line-height: 1.1; font-variant-numeric: tabular-nums; }
.load-level-track { height: 4px; margin-top: 7px; overflow: hidden; border-radius: 999px; background: color-mix(in srgb, var(--load-color) 12%, var(--color-glass)); }
.load-level-track i { display: block; height: 100%; border-radius: inherit; background: var(--load-color); }
.load-level-item.is-normal { --load-color: var(--color-accent); --load-text-color: var(--color-accent-text); }
.load-level-item.is-high { --load-color: var(--color-warning); --load-text-color: var(--color-warning-text); }
.load-level-item.is-critical { --load-color: var(--color-danger); --load-text-color: var(--color-danger-text); }

.nat-service-copy { display: grid; min-width: 0; flex: 1; }
.nat-service-copy strong, .nat-service-copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nat-service-copy strong { font-size: 11px; }
.nat-service-copy small { color: var(--color-muted); font-size: 9px; }
.reach-chip { margin-left: auto; padding: 2px 7px; color: var(--color-muted); font-size: 9px; border-radius: 999px; background: var(--color-glass); }
.reach-chip.good { color: var(--color-success-text); background: color-mix(in srgb, var(--color-success) 14%, transparent); }
.reach-chip.bad { color: var(--color-danger-text); background: color-mix(in srgb, var(--color-danger) 14%, transparent); }
.reach-chip.warn { color: var(--color-warning-text); background: color-mix(in srgb, var(--color-warning) 14%, transparent); }

/* Reference-style resource board: paired cards share a fixed row height, while
   every body scrolls independently once it reaches that row's height cap. */
.resource-overview-grid {
  display: grid;
  grid-template-columns: repeat(20, minmax(0, 1fr));
  grid-template-rows: clamp(420px, 31vw, 500px) clamp(330px, 23vw, 364px);
  gap: 24px;
}

.overview-resource-panel {
  display: flex;
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: hidden;
  flex-direction: column;
  border-color: color-mix(in srgb, var(--color-rule-2) 76%, transparent);
  background: var(--glass-specular-soft), var(--color-glass);
  box-shadow: var(--shadow-card);
}
.resource-panel-head {
  display: grid;
  grid-template-columns: 42px max-content minmax(0, 1fr);
  align-items: center;
  gap: 12px;
  min-height: 76px;
  padding: 16px 18px;
  flex: none;
  border-bottom: 1px solid var(--color-rule);
}
.resource-panel-head h3 { font-size: 18px; letter-spacing: -.02em; }
.resource-panel-head > span:last-child { justify-self: start; color: var(--color-muted); font-size: 12px; white-space: nowrap; }
.resource-panel-icon {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  color: var(--color-status-solid-text);
  border-radius: 13px;
}
.resource-panel-icon svg { width: 23px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.resource-panel-icon.devices { background: var(--color-info); }
.resource-panel-icon.interfaces { background: var(--color-accent); }
.resource-panel-icon.disks { background: var(--color-success); }
.resource-panel-icon.activity { background: var(--color-warning); }
.devices-surface .resource-panel-head > span:last-child { color: var(--color-info-text); }
.interface-surface .resource-panel-head > span:last-child { color: var(--color-accent-text); }
.disk-surface .resource-panel-head > span:last-child { color: var(--color-success-text); }
.activity-surface .resource-panel-head > span:last-child { color: var(--color-warning-text); }

.resource-panel-scroll {
  min-height: 0;
  overflow: auto;
  flex: 1;
  overscroll-behavior-y: auto;
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.resource-panel-scroll::-webkit-scrollbar { display: none; width: 0; height: 0; }
.resource-panel-empty { display: grid; min-height: 0; place-items: center; flex: 1; }

.device-scroll { padding: 14px 18px 18px; }
.device-columns { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.compact-column { display: grid; align-content: start; gap: 6px; min-width: 0; }
.device-row {
  display: grid;
  grid-template-columns: 22px 28px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  min-width: 0;
  min-height: 50px;
  padding: 7px 10px;
  border: 1px solid var(--color-rule);
  border-radius: 10px;
  background: color-mix(in srgb, var(--color-glass-subtle) 86%, transparent);
}
.row-number { color: var(--color-muted); font-size: 11px; font-style: italic; font-variant-numeric: tabular-nums; text-align: center; }
.device-row .row-number { color: var(--color-info-text); font-size: 13px; font-style: normal; font-weight: 750; }
.compact-item-icon {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  color: var(--color-accent-text);
  border-radius: 8px;
  background: color-mix(in srgb, var(--color-accent) 14%, transparent);
}
.compact-item-icon svg { width: 17px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
.compact-item-icon.device,
.compact-item-icon.interface { color: var(--color-info-text); background: color-mix(in srgb, var(--color-info) 12%, transparent); }
.compact-item-icon.wifi { color: var(--color-accent-text); background: color-mix(in srgb, var(--color-accent) 12%, transparent); }
.compact-item-copy { display: flex; align-items: center; gap: 10px; min-width: 0; }
.compact-item-copy strong, .compact-item-copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.compact-item-copy strong { min-width: 0; font-size: 12px; }
.compact-item-copy small { margin-left: auto; color: var(--color-muted); font-size: 9px; }

.adapter-scroll { padding: 10px 16px 16px; }
.adapter-list { display: grid; align-content: start; gap: 4px; }
.adapter-row {
  display: grid;
  grid-template-columns: 30px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  min-width: 0;
  min-height: 43px;
  padding: 6px 10px;
  border: 1px solid var(--color-rule);
  border-radius: 9px;
  background: color-mix(in srgb, var(--color-glass-subtle) 80%, transparent);
}
.adapter-row.has-wifi {
  grid-template-columns: 30px minmax(180px, .9fr) minmax(250px, 1.15fr) auto;
  min-height: 78px;
  border-color: color-mix(in srgb, var(--color-accent) 35%, var(--color-rule));
  background: color-mix(in srgb, var(--color-accent) 7%, var(--color-glass-subtle));
}
.adapter-copy { display: grid; min-width: 0; }
.adapter-name-line { display: flex; align-items: center; gap: 12px; min-width: 0; }
.adapter-name-line strong, .adapter-name-line small, .wifi-summary { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.adapter-name-line strong { min-width: 0; font-size: 12px; }
.adapter-name-line small, .wifi-summary { color: var(--color-muted); font-size: 9px; }
.wifi-summary { margin-top: 3px; }
.wifi-summary span { font-weight: 750; }
.wifi-summary span.good { color: var(--color-success-text); }
.wifi-summary span.warn { color: var(--color-warning-text); }
.wifi-summary span.bad { color: var(--color-danger-text); }
.wifi-metrics {
  display: grid;
  grid-template-columns: .9fr .75fr 1.45fr;
  align-items: stretch;
  min-width: 0;
  border-left: 1px solid var(--color-rule);
}
.wifi-metric { display: grid; align-content: center; gap: 1px; min-width: 0; padding: 0 12px; }
.wifi-metric + .wifi-metric { border-left: 1px solid var(--color-rule); }
.wifi-metric i { color: var(--color-muted); font-size: 9px; font-style: normal; }
.wifi-metric b { overflow: hidden; font-size: 12px; font-variant-numeric: tabular-nums; text-overflow: ellipsis; white-space: nowrap; }
.wifi-metric em { font-size: 9px; font-style: normal; }
.wifi-metric .grade-good { color: var(--color-success-text); }
.wifi-metric .grade-warn { color: var(--color-warning-text); }
.wifi-metric .grade-bad { color: var(--color-danger-text); }
.state-pill { min-width: 54px; padding: 5px 10px; font-size: 10px; font-weight: 800; border-radius: 8px; text-align: center; }
.state-pill.good { color: var(--color-success-text); background: color-mix(in srgb, var(--color-success) 12%, transparent); }
.state-pill.bad { color: var(--color-danger-text); background: color-mix(in srgb, var(--color-danger) 12%, transparent); }

.disk-scroll { padding: 14px 20px 18px; }
.disk-list { display: grid; align-content: start; gap: 12px; }
.disk-overview-item {
  --disk-accent: var(--color-info);
  --disk-text-accent: var(--color-info-text);
  display: grid;
  grid-template-columns: 76px minmax(0, 1fr);
  align-items: center;
  gap: 18px;
  min-height: 78px;
  padding: 7px 16px;
  border: 1px solid color-mix(in srgb, var(--disk-accent) 24%, var(--color-rule));
  border-radius: 11px;
  background: color-mix(in srgb, var(--disk-accent) 5%, var(--color-glass-subtle));
}
.disk-overview-item.disk-tone-1 { --disk-accent: var(--color-success); --disk-text-accent: var(--color-success-text); }
.disk-overview-item.disk-tone-2 { --disk-accent: var(--color-warning); --disk-text-accent: var(--color-warning-text); }
.disk-usage-ring {
  position: relative;
  display: grid;
  width: 64px;
  height: 64px;
  place-items: center;
  border-radius: 50%;
  background: conic-gradient(var(--disk-accent) 0 var(--usage-angle), color-mix(in srgb, var(--disk-accent) 13%, var(--color-glass)) var(--usage-angle) 360deg);
}
.disk-usage-ring::after { content: ''; position: absolute; inset: 6px; border-radius: 50%; background: var(--color-paper-2); }
.disk-usage-ring strong { position: relative; z-index: 1; color: var(--disk-text-accent); font-size: 13px; font-variant-numeric: tabular-nums; }
.disk-overview-copy { display: grid; min-width: 0; }
.disk-name-line { display: flex; align-items: baseline; gap: 14px; }
.disk-name-line strong { font-size: 14px; }
.disk-name-line small { color: var(--color-muted); font-size: 10px; }
.disk-progress { height: 6px; margin-top: 8px; overflow: hidden; border-radius: 999px; background: color-mix(in srgb, var(--disk-accent) 12%, var(--color-glass)); }
.disk-progress i { display: block; height: 100%; border-radius: inherit; background: var(--disk-accent); }
.disk-capacity { margin-top: 5px; color: var(--color-muted); font-size: 10px; }

.activity-timeline { padding: 12px 16px 18px; }
.timeline-track { position: relative; display: grid; align-content: start; gap: 8px; min-width: 0; }
.timeline-track::before {
  content: '';
  position: absolute;
  top: 16px;
  bottom: 16px;
  left: 50%;
  width: 2px;
  border-radius: 999px;
  background: linear-gradient(var(--color-rule), color-mix(in srgb, var(--color-accent) 35%, var(--color-rule)), var(--color-rule));
  transform: translateX(-50%);
}
.timeline-event {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 42px minmax(0, 1fr);
  align-items: center;
  min-width: 0;
  min-height: 54px;
}
.timeline-event.is-online .timeline-content { grid-column: 1; border-color: color-mix(in srgb, var(--color-success) 28%, var(--color-rule)); background: color-mix(in srgb, var(--color-success) 5%, var(--color-glass-subtle)); }
.timeline-event.is-offline .timeline-content { grid-column: 3; border-color: color-mix(in srgb, var(--color-danger) 28%, var(--color-rule)); background: color-mix(in srgb, var(--color-danger) 5%, var(--color-glass-subtle)); }
.timeline-marker { display: grid; grid-column: 2; grid-row: 1; place-items: center; width: 30px; height: 30px; justify-self: center; z-index: 1; border: 3px solid var(--color-paper-2); border-radius: 50%; }
.timeline-marker i { display: grid; width: 24px; height: 24px; place-items: center; color: var(--color-status-solid-text); font-size: 13px; font-style: normal; font-weight: 800; border-radius: 50%; }
.timeline-marker.good i { background: var(--color-success); }
.timeline-marker.bad i { color: var(--color-danger-action-text); background: var(--color-danger-action-bg); }
.timeline-content { display: grid; grid-template-columns: 24px auto minmax(0, 1fr) auto; grid-row: 1; align-items: center; gap: 8px; min-width: 0; padding: 8px 10px; border: 1px solid var(--color-rule); border-radius: 10px; }
.timeline-content strong, .timeline-content small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.timeline-content strong { font-size: 11px; }
.timeline-content small { color: var(--color-muted); font-size: 9px; }
.timeline-content time { color: var(--color-muted); font-size: 9px; font-variant-numeric: tabular-nums; white-space: nowrap; }

@media (max-width: 1180px) {
  .resource-overview-grid { grid-template-rows: 420px 340px; gap: 18px; }
  .adapter-row.has-wifi { grid-template-columns: 30px minmax(150px, .8fr) minmax(210px, 1fr) auto; }
  .wifi-metric { padding: 0 8px; }
  .compact-item-copy { display: grid; gap: 2px; }
  .compact-item-copy small { margin-left: 0; }
}
@media (max-width: 980px) {
  .resource-overview-grid {
    grid-template-columns: 1fr;
    grid-template-rows: none;
  }
  .devices-surface, .interface-surface, .disk-surface, .activity-surface { grid-column: 1; grid-row: auto; }
  .devices-surface, .interface-surface { height: min(500px, 70vh); }
  .disk-surface, .activity-surface { height: min(364px, 60vh); }
}
@media (max-width: 680px) {
  .device-columns { grid-template-columns: 1fr; gap: 8px; }
  .timeline-event { grid-template-columns: minmax(0, 1fr) 34px minmax(0, 1fr); }
  .timeline-content { grid-template-columns: 18px minmax(0, 1fr); gap: 4px; padding: 7px; }
  .timeline-content small { display: none; }
  .timeline-content time { grid-column: 1 / -1; font-size: 8px; }
  .adapter-row.has-wifi { grid-template-columns: 30px minmax(0, 1fr) auto; }
  .adapter-row.has-wifi .wifi-metrics { grid-column: 2 / -1; padding-top: 8px; border-top: 1px solid var(--color-rule); border-left: 0; }
  .resource-panel-head { grid-template-columns: 38px max-content minmax(0, 1fr); min-height: 68px; padding: 12px 14px; }
  .resource-panel-icon { width: 36px; height: 36px; }
  .resource-panel-head h3 { font-size: 16px; }
}
@media (max-width: 1120px) { .service-columns { grid-template-columns: repeat(2, minmax(0, 1fr)); }.service-group:nth-child(odd) { border-left: 0; }.service-group:nth-child(n + 3) { border-top: 1px solid var(--color-rule); }.agent-hero { grid-template-columns: 1fr auto; }.fleet-summary { grid-column: 1 / -1; padding: 16px 0 0; border-top: 1px solid var(--color-rule); border-left: 0; } }
@media (max-width: 900px) { .system-monitor-grid { grid-template-columns: 1fr; }.monitor-primary-column { grid-template-columns: 1fr 1fr; grid-template-rows: auto; }.monitor-secondary-column { grid-template-columns: 1fr 1fr; grid-template-rows: auto; }.load-monitor-card { grid-column: 1 / -1; } }
@media (max-width: 760px) { .dashboard-head { align-items: stretch; flex-direction: column; }.head-actions, .agent-picker { width: 100%; }.agent-picker { flex: 1; }.agent-picker select { width: 100%; min-width: 0; }.agent-hero { grid-template-columns: 1fr; padding: 22px; }.health-summary { padding-top: 16px; border-top: 1px solid var(--color-rule); }.fleet-summary { grid-column: auto; }.service-columns, .monitor-primary-column, .monitor-secondary-column { grid-template-columns: 1fr; }.load-monitor-card { grid-column: auto; }.service-group + .service-group { border-top: 1px solid var(--color-rule); border-left: 0; }.metric-card { min-height: 108px; }.service-group { padding: 14px 16px; }.system-monitor-grid { padding: 12px; }.load-dials { gap: 8px; }.io-values > div { grid-template-columns: 24px 60px 1fr; } }
@media (max-width: 420px) { .fleet-summary { flex-direction: column; gap: 12px; }.agent-identity { align-items: flex-start; }.agent-line { align-items: flex-start; flex-direction: column; gap: 4px; } }
/* Server-synced dashboard layout editor and the shared 12-column card grid. */
.layout-add-button {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 44px;
  padding: 0 13px;
  color: var(--color-accent-text);
  font-size: 11px;
  font-weight: 700;
  border: 1px solid color-mix(in srgb, var(--color-accent) 42%, var(--color-rule));
  border-radius: 11px;
  background: color-mix(in srgb, var(--color-accent) 14%, transparent);
  cursor: pointer;
  white-space: nowrap;
}
.layout-add-button:hover,
.layout-add-button:focus-visible { border-color: var(--color-accent); }
.layout-add-button:focus-visible { outline: 2px solid var(--color-focus); outline-offset: 2px; }
.layout-add-button:active { transform: translateY(1px); }
.layout-add-button:disabled { opacity: .55; cursor: not-allowed; }
.layout-add-button svg { width: 16px; fill: none; stroke: currentColor; stroke-width: 1.7; }
.unsaved-chip { padding: 4px 9px; color: var(--color-warning-text); font-size: 10px; font-weight: 700; border-radius: 999px; background: color-mix(in srgb, var(--color-warning) 12%, transparent); }
.custom-dashboard-grid { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); align-items: stretch; gap: 18px; }
.dashboard-card-shell { position: relative; min-width: 0; height: auto; margin: 0 !important; align-self: stretch; transition: opacity var(--dur-micro) var(--ease-out), transform var(--dur-micro) var(--ease-out); }
.insight-card {
  --insight-color: var(--color-accent);
  --insight-text-color: var(--color-accent-text);
  display: grid;
  align-content: center;
  min-width: 0;
  min-height: 126px;
  padding: 18px 20px;
  border: 1px solid color-mix(in srgb, var(--insight-color) 25%, var(--color-rule));
  border-radius: var(--radius-card);
  background: color-mix(in srgb, var(--insight-color) 5%, var(--color-glass));
  box-shadow: var(--shadow-card);
}
.insight-card.is-good { --insight-color: var(--color-success); --insight-text-color: var(--color-success-text); }
.insight-card.is-warn { --insight-color: var(--color-warning); --insight-text-color: var(--color-warning-text); }
.insight-card.is-bad { --insight-color: var(--color-danger); --insight-text-color: var(--color-danger-text); }
.insight-card > span { color: var(--color-muted); font-size: 10px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
.insight-card strong { margin-top: 7px; color: var(--insight-text-color); font-size: 28px; font-variant-numeric: tabular-nums; }
.insight-card p { margin: 4px 0 0; color: var(--color-muted); font-size: 10px; }
.availability-attribution { display: flex; flex-wrap: wrap; align-items: baseline; gap: 1px 6px; }
.availability-attribution .attribution-link { color: var(--insight-text-color); font-weight: 750; font-variant-numeric: tabular-nums; }
.availability-attribution .attribution-link:hover { text-decoration: underline; }
.availability-attribution .mono { color: var(--insight-text-color); font-weight: 700; }
.empty-layout-state { margin-top: 18px; padding: 48px 20px; }
.empty-layout-state p { margin: 0 0 10px; color: var(--color-muted); }
@media (max-width: 900px) {
  /* Everything collapses to a single stacked column; a tall card drops its
     second row so it becomes an ordinary full-width card and never overlaps. */
  .dashboard-card-shell { grid-column: 1 / -1 !important; grid-row: auto !important; }
  .trend-summary-card.is-tall { min-height: 390px; }
  .trend-summary-card.is-tall :deep(.dashboard-trend-chart.chart) { height: 255px; flex: none; }
}
.direct-layout-toolbar {
  position: sticky;
  top: max(10px, env(safe-area-inset-top));
  z-index: 900;
  pointer-events: none;
  display: flex;
  align-items: center;
  gap: 16px;
  margin: -8px 0 20px;
  padding: 12px 14px;
  border: 1px solid color-mix(in srgb, var(--color-accent) 35%, var(--color-rule));
  border-radius: 14px;
  background: var(--color-glass);
  box-shadow: var(--shadow-float);
  backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
}
.direct-layout-toolbar > div:first-child { display: flex; align-items: center; gap: 10px; min-width: 0; }
.direct-layout-toolbar p { margin: 0; color: var(--color-muted); font-size: 11px; }
.direct-layout-toolbar > .err { margin-left: auto; }
.direct-layout-actions { display: flex; gap: 8px; margin-left: auto; pointer-events: auto; }
.layout-presets {
  margin: -8px 0 20px;
  padding: 20px;
  border: 1px solid var(--color-rule);
  border-radius: 18px;
  background: var(--color-paper-2);
  box-shadow: var(--shadow-card);
}
.layout-presets-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 16px; }
.layout-presets-head h3 { font-size: 20px; }
.layout-presets-head p { margin: 4px 0 0; color: var(--color-muted); font-size: 11px; }
.layout-mode-chip {
  flex: none;
  padding: 5px 10px;
  color: var(--color-accent-text);
  font-size: 10px;
  font-weight: 700;
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-accent) 14%, transparent);
}
.layout-mode-chip.custom { color: var(--color-muted); background: var(--color-glass-subtle); }
.layout-preset-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.layout-preset-option {
  display: grid;
  grid-template-columns: 108px minmax(0, 1fr) 24px;
  align-items: center;
  gap: 14px;
  min-width: 0;
  padding: 14px;
  color: var(--color-ink);
  text-align: left;
  border: 1px solid var(--color-rule);
  border-radius: 15px;
  background: var(--color-glass-subtle);
  cursor: pointer;
  transition: transform var(--dur-micro) var(--ease-out);
}
.layout-preset-option:hover { border-color: color-mix(in srgb, var(--color-accent) 58%, var(--color-rule)); transform: translateY(-1px); }
.layout-preset-option:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }
.layout-preset-option.selected {
  border-color: color-mix(in srgb, var(--color-accent) 68%, var(--color-rule));
  background: color-mix(in srgb, var(--color-accent) 7%, var(--color-glass-subtle));
}
.layout-preset-preview {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  grid-auto-rows: 10px;
  gap: 4px;
  min-height: 52px;
  padding: 8px;
  border: 1px solid color-mix(in srgb, var(--color-accent) 18%, var(--color-rule));
  border-radius: 10px;
  background: var(--color-glass);
}
.layout-preset-preview i { border-radius: 3px; background: color-mix(in srgb, var(--color-accent) 54%, var(--color-glass-subtle)); }
.layout-preset-preview.simple i:first-child,
.layout-preset-preview.professional i:first-child { grid-column: 1 / -1; }
.layout-preset-preview.simple i:nth-child(6) { grid-column: 1 / -1; }
.layout-preset-preview.professional i:nth-child(6),
.layout-preset-preview.professional i:nth-child(9) { grid-column: span 2; }
.layout-preset-copy { display: grid; min-width: 0; }
.layout-preset-copy strong { font-size: 13px; }
.layout-preset-copy small { margin-top: 5px; color: var(--color-muted); font-size: 10px; line-height: 1.45; }
.layout-preset-check {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  color: var(--color-primary-action-text);
  font-size: 12px;
  font-weight: 800;
  border-radius: 50%;
  background: var(--color-primary-action-bg);
}
.widget-catalog {
  position: relative;
  z-index: 1;
  width: 100%;
  max-height: min(560px, 70vh);
  margin: -8px 0 20px;
  padding: 20px;
  overflow: auto;
  color: var(--color-ink);
  border: 1px solid color-mix(in srgb, var(--color-accent) 38%, var(--color-rule));
  border-radius: 18px;
  background: var(--color-paper-2);
  box-shadow: var(--shadow-card);
}
.widget-catalog-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 16px; }
.widget-catalog-head h3 { font-size: 20px; }
.widget-catalog-head p { margin: 4px 0 0; color: var(--color-muted); font-size: 11px; }
.widget-catalog-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.widget-option { display: flex; align-items: center; gap: 12px; min-width: 0; padding: 12px; border: 1px solid var(--color-rule); border-radius: 14px; background: var(--color-glass-subtle); }
.widget-preview { display: flex; align-items: center; gap: 11px; min-width: 0; flex: 1; }
.widget-preview > div { display: grid; min-width: 0; }
.widget-preview strong { overflow: hidden; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.widget-preview small { margin-top: 3px; color: var(--color-muted); font-size: 9px; }
.widget-preview-icon { display: grid; grid-template-columns: repeat(2, 12px); gap: 3px; padding: 8px; flex: none; border-radius: 9px; background: color-mix(in srgb, var(--color-accent) 14%, transparent); }
.widget-preview-icon i { width: 12px; height: 9px; border-radius: 2px; background: color-mix(in srgb, var(--color-accent) 62%, transparent); }
.widget-preview-icon.monitor i { border-radius: 50%; }
.widget-option > .btn { flex: none; }
.catalog-empty { padding: 48px 20px; color: var(--color-muted); text-align: center; }
.dashboard-card-shell[data-layout-editing] {
  outline: 2px solid color-mix(in srgb, var(--color-accent) 52%, transparent);
  outline-offset: 2px;
  cursor: grab;
  user-select: none;
}
.dashboard-card-shell[data-layout-editing] > :not(.dashboard-card-controls) { pointer-events: none; }
.dashboard-card-shell[data-dragging] { opacity: .38; transform: scale(.985); }
@media (max-width: 680px) {
  .direct-layout-toolbar { align-items: stretch; flex-direction: column; }
  .direct-layout-actions { width: 100%; margin-left: 0; }
  .layout-presets-head { align-items: stretch; flex-direction: column; }
  .layout-mode-chip { align-self: flex-start; }
  .layout-preset-grid { grid-template-columns: 1fr; }
  .layout-preset-option { grid-template-columns: 84px minmax(0, 1fr) 24px; }
  .widget-catalog-grid { grid-template-columns: 1fr; }
}
/* Action-oriented overview cards. */
.overview-summary-card, .trend-summary-card { min-height: 250px; padding: 20px; }
.overview-summary-card.has-problem { border-color: color-mix(in srgb, var(--color-danger) 28%, var(--color-rule)); }
.overview-summary-card.is-clear { border-color: color-mix(in srgb, var(--color-success) 22%, var(--color-rule)); }
.summary-card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 18px; }
.summary-card-head h3 { margin-top: 4px; font-size: 18px; }
.summary-clear-state { display: grid; place-items: center; min-height: 150px; color: var(--color-muted); text-align: center; }
.summary-clear-state strong { display: grid; place-items: center; width: 44px; height: 44px; margin-bottom: 8px; color: var(--color-success-text); border-radius: 50%; background: color-mix(in srgb, var(--color-success) 12%, transparent); font-size: 22px; }
.summary-list { display: grid; gap: 8px; }
.summary-list-row { display: grid; grid-template-columns: 9px minmax(0, 1fr) auto; align-items: center; gap: 10px; padding: 10px 11px; border-radius: 11px; background: var(--color-glass-subtle); }
.summary-list-row time { color: var(--color-muted); font-size: 10px; white-space: nowrap; }
.summary-row-copy { display: grid; min-width: 0; }
.summary-row-copy strong, .summary-row-copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.summary-row-copy strong { font-size: 12px; }
.summary-row-copy small { margin-top: 3px; color: var(--color-muted); font-size: 10px; }
.severity-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--color-muted); }
.severity-dot.severity-critical { background: var(--color-danger); box-shadow: 0 0 0 4px color-mix(in srgb, var(--color-danger) 12%, transparent); }
.severity-dot.severity-error { background: var(--color-danger); }
.severity-dot.severity-warn { background: var(--color-warning); }
.severity-dot.severity-info { background: var(--color-accent); }
.offline-impact { margin: -5px 0 12px; padding: 7px 10px; color: var(--color-danger-text); border-radius: 9px; background: color-mix(in srgb, var(--color-danger) 9%, transparent); font-size: 10px; }
.health-count-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.health-count { display: grid; padding: 14px; border-radius: 12px; background: var(--color-glass-subtle); }
.health-count strong { font-size: 25px; line-height: 1; }
.health-count span { margin-top: 7px; color: var(--color-muted); font-size: 10px; }
.health-count.good strong { color: var(--color-success-text); }.health-count.bad strong { color: var(--color-danger-text); }.health-count.warn strong { color: var(--color-warning-text); }.health-count.muted strong { color: var(--color-muted); }
.trend-summary-card { display: flex; flex-direction: column; min-height: 390px; }
/* 2×2 tall variant: fills two grid rows and lets its chart grow into the extra
   height instead of leaving a gap under a fixed-height chart. */
.trend-summary-card.is-tall { min-height: clamp(520px, 42vw, 620px); }
.trend-summary-card.is-tall :deep(.dashboard-trend-chart.chart) { height: auto; flex: 1 1 auto; min-height: 320px; }
.trend-summary-card.is-tall .summary-empty { flex: 1; }
.card-source-note { margin: -12px 0 14px; color: var(--color-muted); font-size: 10px; line-height: 1.5; word-break: break-word; }
.trend-stat-row { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-bottom: 4px; }
.trend-stat-row > div { display: grid; padding: 10px 12px; border-radius: 11px; background: var(--color-glass-subtle); }
.trend-stat-row span { color: var(--color-muted); font-size: 9px; text-transform: uppercase; }
.trend-stat-row strong { margin-top: 4px; font-size: 19px; }
.trend-stat-row strong small { color: var(--color-muted); font-size: 10px; font-weight: 500; }
:deep(.dashboard-trend-chart.chart) { height: 255px; }
:deep(.dashboard-trend-chart.compact-chart.chart) { height: 225px; }
.summary-empty { display: grid; place-items: center; min-height: 230px; color: var(--color-muted); font-size: 11px; }
.freshness-card, .wifi-summary-card { align-items: stretch; min-height: 150px; }
.freshness-content, .wifi-summary-content { display: grid; align-content: center; min-width: 0; width: 100%; }
.freshness-content > span, .wifi-summary-content > span { color: var(--color-muted); font-size: 10px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
.freshness-content > strong, .wifi-summary-content > strong { margin-top: 8px; overflow: hidden; color: var(--color-ink); font-size: 22px; text-overflow: ellipsis; white-space: nowrap; }
.freshness-content > b, .wifi-summary-content > b { margin-top: 5px; font-size: 13px; font-weight: 650; }
.freshness-content > small, .wifi-summary-content > small { margin-top: 6px; color: var(--color-muted); font-size: 10px; }
.wifi-summary-content > b small { font-size: 10px; font-weight: 500; }
.traffic-live-row { display: flex; flex-wrap: wrap; gap: 8px 16px; color: var(--color-muted); font-size: 10px; }
.traffic-live-row span { display: flex; align-items: center; gap: 5px; }
.traffic-live-row strong { color: var(--color-ink); }
.traffic-live-row i { width: 7px; height: 7px; border-radius: 50%; }.rx-dot { background: var(--color-info); }.tx-dot { background: var(--color-accent); }
.incident-stat-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.incident-stat-grid > div { display: grid; padding: 14px 10px; border-radius: 12px; background: var(--color-glass-subtle); text-align: center; }
.incident-stat-grid strong { font-size: 25px; }.incident-stat-grid span { margin-top: 6px; color: var(--color-muted); font-size: 9px; }
.incident-layer { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 14px 0 0; padding-top: 12px; color: var(--color-muted); border-top: 1px solid var(--color-rule); font-size: 10px; }
.incident-layer strong { color: var(--color-ink); font-size: 12px; }
@media (max-width: 760px) {
  .trend-stat-row { grid-template-columns: 1fr; }
  .trend-summary-card { min-height: 440px; }
  .traffic-live-row { display: grid; }
}
.monitor-target-card { position: relative; min-height: 190px; overflow: hidden; }
.missing-target-card { display: grid; align-content: center; min-height: 190px; padding: 22px; color: var(--color-muted); }
.missing-target-card strong { color: var(--color-warning-text); }
.missing-target-card p { margin: 6px 0 0; font-size: 11px; }
.target-card-drawer-backdrop { position: fixed; inset: 0; z-index: 1100; display: flex; justify-content: flex-end; background: var(--color-backdrop); backdrop-filter: blur(var(--space-3xs)); -webkit-backdrop-filter: blur(var(--space-3xs)); }
.target-card-drawer { display: flex; flex-direction: column; width: min(420px, 94vw); height: 100%; padding: 24px; overflow-y: auto; border-left: 1px solid var(--color-rule-2); background: var(--color-glass-strong); box-shadow: var(--shadow-float); backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate)); -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate)); }
.target-card-drawer > header { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.target-card-drawer > header h3 { margin-top: 4px; font-size: 20px; }
.target-card-drawer > header button { width: 44px; height: 44px; color: var(--color-muted); border: 1px solid var(--color-rule); border-radius: var(--radius-input); background: var(--color-glass); font-size: 22px; cursor: pointer; }
.target-card-drawer > header button:hover { color: var(--color-ink); background: var(--color-glass-hover); }
.target-card-drawer > header button:focus-visible { outline: 2px solid var(--color-focus); outline-offset: 2px; }
.target-card-drawer > header button:active { transform: translateY(1px); }
.target-card-form { display: grid; gap: 16px; margin-top: 28px; }
.target-card-form label { display: grid; gap: 7px; }
.target-card-form label > span, .target-card-preview > span { color: var(--color-muted); font-size: 10px; font-weight: 750; letter-spacing: .08em; text-transform: uppercase; }
.target-card-form select { width: 100%; min-height: 42px; background: var(--color-glass); }
.target-card-form > p { margin: -7px 0 0; color: var(--color-muted); font-size: 10px; }
.target-card-form > p.is-limit { color: var(--color-warning-text); }
.target-card-preview { display: grid; gap: 9px; margin-top: 26px; }
.target-card-preview :deep(.target-card-body) { border: 1px solid var(--color-rule); border-radius: 14px; background: var(--color-glass); }
.target-card-drawer > footer { display: flex; justify-content: flex-end; gap: 10px; margin-top: auto; padding-top: 28px; }
.target-card-drawer > footer .btn { min-width: 110px; }
@media (max-width: 1120px) {
  .head-actions { flex-wrap: wrap; justify-content: flex-end; }
}
</style>

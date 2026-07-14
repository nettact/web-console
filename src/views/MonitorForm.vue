<script setup lang="ts">
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { api, type ProbeTarget, type ProbeParams, type Rule, type Channel, type AgentGroup, type SaveWarning } from '../api'
import ComboInput from '../components/ComboInput.vue'

const { t: tr } = useI18n()
const route = useRoute()
const router = useRouter()

const SITE = 'site_default'
const editingId = computed(() => (route.params.id as string) || '')
// The host flow has its own create route so it can open without the type
// dropdown and seed a whole-machine anchor (target "host") straight away.
const isNewHost = computed(() => route.path.endsWith('/new-host'))

const all = ref<ProbeTarget[]>([])
const form = reactive<ProbeTarget>(blank())
if (isNewHost.value) { form.kind = 'host'; form.target = 'host' }
// Quick-add prefill: the Live Connections page links here with kind/target[/port]
// to seed a new monitor. This only sets initial form values — it never saves —
// and applies to an ordinary create alone, never edit and never the host flow.
if (!editingId.value && !isNewHost.value) applyQueryPrefill()

// Read the route query for initial values, tolerating out-of-contract input.
// Accepts only kind tcp/icmp with a non-empty target; a port is honored solely
// for a resulting TCP monitor and only in 1-65535. Array (repeated) query values
// are rejected. No generic HTTP/DNS/NAT prefill.
function queryStr(v: unknown): string {
  return typeof v === 'string' ? v : ''
}
function applyQueryPrefill() {
  const kind = queryStr(route.query.kind)
  if (kind !== 'tcp' && kind !== 'icmp') return
  const target = queryStr(route.query.target)
  if (!target) return
  form.kind = kind
  form.target = target
  if (kind === 'tcp') {
    const port = Number(queryStr(route.query.port))
    if (Number.isInteger(port) && port >= 1 && port <= 65535) {
      if (!form.params) form.params = {}
      form.params.port = port
    }
  }
}

// A "系统状态" (host) target is not a probe: host.* metrics are emitted by the
// agent itself (when granted the matching host.* permissions); this target is
// purely a server-side alerting anchor whose `target` string must equal the
// metric series' target — "host" for CPU/memory/load, or a mount point for disk.
// So the host flow hides the type dropdown and swaps the free-text target for a
// guided subject selector.
const isHostMode = computed(() => form.kind === 'host')
// A gateway target probes the agent's own gateway (resolved from the chosen NIC,
// or the default NIC when none is given), so it has no user-entered target — the
// NIC selection lives in params.interface. Like host mode, it hides the free-text
// target field and shows a guided input instead.
const isGatewayMode = computed(() => form.kind === 'gateway')
// Whole-machine (target "host"), a specific disk partition (target = mount
// point), or Wi-Fi (target "*", the anchor for every wireless adapter). Selecting
// "whole" pins target to "host"; "wifi" pins it to "*"; "disk" clears it so the
// user types the mount point, which must match what the agent reports (e.g. "C:").
const hostSubject = computed<'whole' | 'disk' | 'wifi'>({
  get: () => (form.target === 'host' ? 'whole' : form.target === '*' ? 'wifi' : 'disk'),
  set: (v) => { form.target = v === 'whole' ? 'host' : v === 'wifi' ? '*' : '' },
})
const headersText = ref('')
const error = ref('')
const saved = ref(false)
const busy = ref(false)
// Save warnings for THIS monitor: in-scope agents that cannot run it under their
// current permission policy (per-agent, from the set-targets response).
const saveWarning = ref<SaveWarning | null>(null)
const notFound = ref(false)
// Guards a destructive save: setTargets is a full reconcile, so saving before the
// existing target list has loaded would delete every other monitor.
const loaded = ref(false)

function blank(): ProbeTarget {
  return { kind: 'icmp', name: '', target: '', params: {}, enabled: true, all_agents: true, group_ids: [] }
}

// Agent groups for the scope selector. A target is either broadcast to all agents
// (all_agents=true) or limited to the selected groups.
const groups = ref<AgentGroup[]>([])
// Scope radio bound to the boolean flag so the two states stay in sync.
const scope = computed<'all' | 'groups'>({
  get: () => (form.all_agents ? 'all' : 'groups'),
  set: (v) => { form.all_agents = v === 'all' },
})
function toggleGroup(id: string) {
  const ids = form.group_ids || (form.group_ids = [])
  const i = ids.indexOf(id)
  if (i >= 0) ids.splice(i, 1)
  else ids.push(id)
}

// HTTP is a single type: an empty keyword means a plain availability check; a
// non-empty keyword adds body-content validation. Placeholder helpers for the
// DNS resolver server/port depend on the selected resolver protocol.
const dnsProto = computed(() => form.params?.resolver_protocol || '')
const resolverServerPlaceholder = computed(() =>
  dnsProto.value === 'doh' ? 'https://cloudflare-dns.com/dns-query'
  : dnsProto.value === 'dot' ? '1.1.1.1 / dns.google'
  : '1.1.1.1',
)
const resolverPortPlaceholder = computed(() => (dnsProto.value === 'dot' ? '853' : '53'))

// Suggested public STUN servers for the NAT monitor, offered as a pickable list on
// the (still free-text) server field. A value may include a port (host:port);
// without one the agent uses the transport's default STUN port (3478 for UDP/TCP,
// 5349 for TLS/DTLS). Not all public servers implement RFC 5780 OTHER-ADDRESS, so
// behavior discovery may be inconclusive.
const STUN_PRESETS = [
  'stun.hot-chilli.net',
  'stun.fitauto.ru',
  'stun.internetcalls.com',
  'stun.voip.aebc.com',
  'stun.voipbuster.com',
  'stun.voipstunt.com',
  'stun.miwifi.com',
]

function placeholderFor(kind: string): string {
  if (kind === 'dns') return 'example.com'
  if (kind === 'http') return 'https://example.com'
  if (kind === 'tcp') return 'example.com'
  if (kind === 'nat') return 'stun.example.com'
  return '1.1.1.1'
}

async function loadAll() {
  try {
    ;[all.value, channels.value, groups.value] = await Promise.all([
      api.listTargets(SITE),
      api.channels(),
      api.agentGroups(SITE),
    ])
  } catch (e) {
    // Leave loaded=false so Save stays disabled — reconciling against an empty
    // list would wipe every existing monitor.
    error.value = String((e as Error).message || e)
    return
  }
  all.value.forEach((x) => { if (!x.params) x.params = {} })
  loaded.value = true
  if (editingId.value) {
    const found = all.value.find((x) => x.id === editingId.value)
    if (!found) { notFound.value = true; return }
    Object.assign(form, JSON.parse(JSON.stringify(found)))
    if (!form.params) form.params = {}
    if (form.kind === 'nat' && !form.params.nat_transport) form.params.nat_transport = 'udp'
    headersText.value = headersToText(form.params.headers)
    await loadRules()
  }
}

function headersToText(h?: Record<string, string>): string {
  if (!h) return ''
  return Object.entries(h).map(([k, v]) => `${k}: ${v}`).join('\n')
}
function textToHeaders(s: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of s.split('\n')) {
    const idx = line.indexOf(':')
    if (idx < 0) continue
    const k = line.slice(0, idx).trim()
    const v = line.slice(idx + 1).trim()
    if (k) out[k] = v
  }
  return out
}

// Drop blank/NaN scalars and empty maps so Go never receives "" for an int field.
function cleanParams(p: ProbeParams | undefined): ProbeParams {
  const out: Record<string, unknown> = {}
  if (p) {
    for (const [k, v] of Object.entries(p)) {
      if (v === '' || v === null || v === undefined) continue
      if (typeof v === 'number' && Number.isNaN(v)) continue
      if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length === 0) continue
      out[k] = v
    }
  }
  return out as ProbeParams
}

async function save() {
  if (!loaded.value) return // never reconcile against a list that failed to load
  // Gateway targets carry no user-entered target (the server normalizes it to
  // "gateway"); every other kind needs one.
  if (!isGatewayMode.value && !form.target.trim()) { error.value = tr('mform.targetRequired'); return }
  busy.value = true
  saved.value = false
  error.value = ''
  saveWarning.value = null
  try {
    if (form.kind === 'http') form.params!.headers = textToHeaders(headersText.value)
    const target = isGatewayMode.value ? 'gateway' : form.target.trim()
    const current: ProbeTarget = { ...form, target, params: cleanParams(form.params) }
    // Rebuild the full set (setTargets is a full reconcile), upserting this one.
    const others = all.value.filter((x) => x.id && x.id !== form.id)
      .map((x) => ({ ...x, params: cleanParams(x.params) }))
    // Snapshot existing ids so a newly created monitor (which gets a fresh id not
    // in this set) is identified unambiguously, even if it duplicates another
    // monitor's kind/target/name.
    const beforeIds = new Set(others.map((x) => x.id))
    const payload = [...others, current]
    const res = await api.setTargets(SITE, payload)
    // Reload so a freshly-created monitor gets its server-assigned id (needed to
    // configure alarm rules); locate it by id (edit) or the one new id (create).
    all.value = await api.listTargets(SITE)
    all.value.forEach((x) => { if (!x.params) x.params = {} })
    const match = form.id
      ? all.value.find((x) => x.id === form.id)
      : all.value.find((x) => x.id && !beforeIds.has(x.id))
    if (match) {
      form.id = match.id
      if (!editingId.value && match.id) router.replace(`/monitoring/${match.id}/edit`)
      // Persist in-form alarm-rule edits before reloading, so the primary Save
      // saves the whole form. Otherwise loadRules() overwrites the user's
      // rule-card edits with the server's original values (the revert bug).
      await persistRules()
      await loadRules()
    }
    // Surface the save-time warning for THIS monitor (which in-scope agents cannot
    // run it and why), so a mixed-capability save is visible immediately.
    saveWarning.value = res.warnings.find((wgn) => wgn.monitor_id === form.id) ?? null
    // Only now, after the target AND its rules have persisted, mark saved — so a
    // failed rule save surfaces the error without a misleading "saved" indicator.
    saved.value = true
  } catch (e) {
    error.value = String((e as Error).message || e)
  } finally {
    busy.value = false
  }
}

// ---- alarm rules (验证/通知) ----
const channels = ref<Channel[]>([])
const rules = ref<Rule[]>([])

// A Preset is a plain-language alarm condition. It hides the raw metric +
// comparator + threshold model behind a friendly label. `fixed` presets are
// on/off failures (no number to enter); the rest compare a measured value
// (`unit`, seeded from `def`) against a user-entered threshold.
// `scale` bridges a user-friendly display unit and the raw metric unit: the
// entered/shown value is in `unit`, the stored threshold is value × scale (e.g.
// network is stored bytes/s but entered as MB/s with scale 1048576). Omit → 1.
type Preset = { key: string; label: string; metric: string; comparator: string; fixed?: number; unit?: string; def?: number; scale?: number }
const MIB = 1024 * 1024 // matches the dashboard's base-1024 byte formatting
const CONDITION_PRESETS: Record<string, Preset[]> = {
  icmp: [
    { key: 'down', label: 'mform.condDown', metric: 'probe.icmp.loss_pct', comparator: 'gte', fixed: 100 },
    { key: 'loss', label: 'mform.condLoss', metric: 'probe.icmp.loss_pct', comparator: 'gt', unit: '%', def: 50 },
    { key: 'rtt', label: 'mform.condLatency', metric: 'probe.icmp.rtt_ms', comparator: 'gt', unit: 'ms', def: 200 },
  ],
  dns: [
    { key: 'fail', label: 'mform.condResolveFail', metric: 'probe.dns.ok', comparator: 'lt', fixed: 1 },
    { key: 'slow', label: 'mform.condResolveSlow', metric: 'probe.dns.resolve_ms', comparator: 'gt', unit: 'ms', def: 500 },
  ],
  http: [
    { key: 'down', label: 'mform.condUnavailable', metric: 'probe.http.ok', comparator: 'lt', fixed: 1 },
    { key: 'slow', label: 'mform.condLatency', metric: 'probe.http.latency_ms', comparator: 'gt', unit: 'ms', def: 1000 },
  ],
  tcp: [
    { key: 'down', label: 'mform.condConnectFail', metric: 'probe.tcp.ok', comparator: 'lt', fixed: 1 },
    { key: 'slow', label: 'mform.condConnectSlow', metric: 'probe.tcp.connect_ms', comparator: 'gt', unit: 'ms', def: 1000 },
  ],
  // Framed by outcome, not NAT jargon: the NAT type already summarizes mapping +
  // filtering, so we only surface what a user actually feels — symmetric NAT breaks
  // P2P (games/calls/remote access), and a failed probe means no NAT info at all.
  nat: [
    { key: 'p2p', label: 'mform.condNatP2P', metric: 'probe.nat.type', comparator: 'gte', fixed: 5 },
    { key: 'probefail', label: 'mform.condNatProbeFail', metric: 'probe.nat.ok', comparator: 'lt', fixed: 1 },
  ],
}
// Host presets depend on the chosen subject: whole-machine metrics live on the
// "host" series (CPU/memory), disk usage on the per-mount series, and Wi-Fi on the
// per-adapter wifi.* series (anchored at target "*"). Splitting them this way
// guarantees a rule's metric always matches the anchor's target string, so the
// condition can actually fire.
const HOST_PRESETS: Record<'whole' | 'disk' | 'wifi', Preset[]> = {
  whole: [
    { key: 'cpu', label: 'mform.condCpu', metric: 'host.cpu.pct', comparator: 'gt', unit: '%', def: 90 },
    { key: 'mem', label: 'mform.condMem', metric: 'host.mem.pct', comparator: 'gt', unit: '%', def: 90 },
    { key: 'load1', label: 'mform.condLoad1', metric: 'host.load.1m', comparator: 'gt', unit: '', def: 4 },
    { key: 'load5', label: 'mform.condLoad5', metric: 'host.load.5m', comparator: 'gt', unit: '', def: 4 },
    { key: 'load15', label: 'mform.condLoad15', metric: 'host.load.15m', comparator: 'gt', unit: '', def: 4 },
    { key: 'netrx', label: 'mform.condNetRx', metric: 'host.net.rx_bps', comparator: 'gt', unit: 'MB/s', def: 100, scale: MIB },
    { key: 'nettx', label: 'mform.condNetTx', metric: 'host.net.tx_bps', comparator: 'gt', unit: 'MB/s', def: 100, scale: MIB },
  ],
  disk: [
    { key: 'disk', label: 'mform.condDisk', metric: 'host.disk.pct', comparator: 'gt', unit: '%', def: 90 },
  ],
  // Wi-Fi presets use strict less-than on the wifi.* metrics: disconnected is an
  // on/off failure (fixed 1); low signal/quality compare an editable threshold
  // (dBm is negative — a "lower" reading means a weaker signal).
  wifi: [
    { key: 'disconnected', label: 'mform.condWifiDown', metric: 'wifi.up', comparator: 'lt', fixed: 1 },
    { key: 'signal', label: 'mform.condWifiSignal', metric: 'wifi.signal_dbm', comparator: 'lt', unit: 'dBm', def: -70 },
    { key: 'quality', label: 'mform.condWifiQuality', metric: 'wifi.quality_pct', comparator: 'lt', unit: '%', def: 60 },
  ],
}
function presetsForKind(kind: string): Preset[] {
  if (kind === 'host') return HOST_PRESETS[hostSubject.value]
  return CONDITION_PRESETS[kind] || CONDITION_PRESETS.icmp
}
// Reverse-map a stored rule to its preset (by metric; fixed presets also match on
// comparator). Falls back to the first preset so an unrecognized rule still shows.
function presetKeyOf(r: Rule): string {
  const list = presetsForKind(form.kind)
  const p = list.find((x) => x.metric === r.metric_kind && (x.fixed == null || x.comparator === r.comparator))
  return (p || list[0]).key
}
function presetByKey(key: string): Preset | undefined {
  return presetsForKind(form.kind).find((p) => p.key === key)
}
function applyPreset(r: Rule, key: string) {
  const p = presetByKey(key)
  if (!p) return
  r.metric_kind = p.metric
  r.comparator = p.comparator
  r.threshold = p.fixed != null ? p.fixed : (p.def ?? 0) * (p.scale ?? 1)
}
// The stored threshold is always in the raw metric unit; the editor shows/edits
// it in the preset's display unit (threshold ÷ scale).
function thresholdDisplay(r: Rule): number {
  const s = presetByKey(presetKeyOf(r))?.scale ?? 1
  return s === 1 ? r.threshold : r.threshold / s
}
function setThreshold(r: Rule, v: number) {
  const s = presetByKey(presetKeyOf(r))?.scale ?? 1
  r.threshold = (Number.isNaN(v) ? 0 : v) * s
}
function severityLabel(s: string): string {
  return tr('mform.sev_' + s)
}
// Human-readable one-line summary of a rule, shown under the controls.
function ruleSentence(r: Rule): string {
  const p = presetByKey(presetKeyOf(r))
  const cond = p ? tr(p.label) : r.metric_kind
  const val = p && p.fixed == null ? ` ${thresholdDisplay(r)}${p.unit || ''}` : ''
  return tr('mform.rulePreview', { cond: cond + val, n: r.fail_threshold, sev: severityLabel(r.severity) })
}
function layerForKind(kind: string): string {
  if (kind === 'dns') return 'dns'
  if (kind === 'http') return 'service'
  if (kind === 'tcp') return 'service'
  if (kind === 'nat') return 'wan'
  // Gateway metrics are emitted on the LAN layer, so their alerts must correlate
  // as LAN faults (not the default internet layer).
  if (kind === 'gateway') return 'lan'
  // Whole-machine and disk alerts are local faults; Wi-Fi is a wireless-layer
  // fault so the incident correlator groups and labels it accordingly.
  if (kind === 'host') return hostSubject.value === 'wifi' ? 'wireless' : 'local'
  return 'internet'
}
async function loadRules() {
  if (!form.id) return
  rules.value = await api.targetRules(form.id)
}
async function addRule() {
  if (!form.id) return
  const p = presetsForKind(form.kind)[0]
  try {
    await api.createTargetRule(form.id, {
      name: `${form.name || form.target} ${tr('monitoring.ruleNameSuffix')}`,
      metric_kind: p.metric, comparator: p.comparator,
      threshold: p.fixed != null ? p.fixed : (p.def ?? 0),
      fail_threshold: 3, severity: 'error', layer: layerForKind(form.kind), channel_ids: [],
    })
    await loadRules()
  } catch (e) {
    error.value = String((e as Error).message || e)
  }
}
// Serialize a rule card's current values for the update API. Shared by the
// per-rule Save button and the primary Save (which persists every rule).
function rulePayload(r: Rule): Partial<Rule> {
  return {
    name: r.name, metric_kind: r.metric_kind, comparator: r.comparator,
    threshold: Number(r.threshold), fail_threshold: Number(r.fail_threshold),
    for_seconds: Number(r.for_seconds || 0), layer: r.layer, severity: r.severity,
    channel_ids: r.channel_ids || [], enabled: r.enabled,
  }
}
async function saveRule(r: Rule) {
  await api.updateRule(r.id, rulePayload(r))
  await loadRules()
}
// Persist every rule card's edits at once. Used by the primary Save so a single
// click saves the whole form (target + its alarm rules); leaves reloading to the
// caller. Without this, save()'s loadRules() would clobber unsaved rule edits.
async function persistRules() {
  await Promise.all(rules.value.filter((r) => r.id).map((r) => api.updateRule(r.id, rulePayload(r))))
}
async function delRule(r: Rule) {
  await api.deleteRule(r.id)
  await loadRules()
}
function toggleChannel(r: Rule, id: string) {
  const ids = r.channel_ids || (r.channel_ids = [])
  const i = ids.indexOf(id)
  if (i >= 0) ids.splice(i, 1)
  else ids.push(id)
}
function channelLabel(c: Channel): string {
  return c.name || (c.type === 'webhook' ? c.config.url : c.config.to) || c.type
}

// Ensure params exist on kind change, and drop the http-only keyword when leaving
// http so a stale keyword can't misclassify the monitor.
watch(() => form.kind, (k) => {
  if (!form.params) form.params = {}
  if (k !== 'http') {
    form.params.keyword = ''
    form.params.keyword_invert = false
  }
  // Default the NAT transport so the select shows a concrete value (UDP) rather
  // than an empty/placeholder state.
  if (k === 'nat' && !form.params.nat_transport) form.params.nat_transport = 'udp'
})

onMounted(loadAll)
</script>

<template>
  <main class="page">
    <div class="page-head">
      <h2>{{ isHostMode ? (editingId ? tr('mform.hostEditTitle') : tr('mform.hostNewTitle')) : (editingId ? tr('mform.editTitle') : tr('mform.newTitle')) }}</h2>
      <p class="sub">{{ isHostMode ? tr('mform.hostSub') : tr('mform.sub') }}</p>
    </div>
    <p v-if="error" class="err">{{ error }}</p>

    <p v-if="notFound" class="hint">{{ tr('mform.notFound') }}
      <router-link to="/monitoring">{{ tr('mform.back') }}</router-link>
    </p>

    <template v-else>
      <p v-if="isHostMode" class="host-intro">{{ tr('mform.hostIntro') }}</p>
      <section class="panel">
        <div class="panel-head"><h3>{{ tr('mform.secGeneral') }}</h3></div>
        <div class="form-grid">
          <label class="field" v-if="!isHostMode">
            <span>{{ tr('mform.monitorType') }}</span>
            <select v-model="form.kind">
              <option value="icmp">{{ tr('mform.typeIcmp') }}</option>
              <option value="http">{{ tr('mform.typeHttp') }}</option>
              <option value="tcp">{{ tr('mform.typeTcp') }}</option>
              <option value="dns">{{ tr('mform.typeDns') }}</option>
              <option value="nat">{{ tr('mform.typeNat') }}</option>
              <option value="gateway">{{ tr('mform.typeGateway') }}</option>
            </select>
          </label>
          <label class="field">
            <span>{{ tr('mform.displayName') }}</span>
            <input v-model="form.name" :placeholder="tr('mform.displayNamePlaceholder')" />
          </label>
          <!-- host: guided subject selector instead of a free-text target -->
          <template v-if="isHostMode">
            <label class="field">
              <span>{{ tr('mform.hostSubject') }}</span>
              <!-- Locked once rules exist: rules bind to this anchor's target, so
                   switching the subject would silently orphan every rule (e.g. a
                   host.cpu.pct rule left pointing at a disk mount never matches). -->
              <select v-model="hostSubject" :disabled="rules.length > 0">
                <option value="whole">{{ tr('mform.hostSubjectWhole') }}</option>
                <option value="disk">{{ tr('mform.hostSubjectDisk') }}</option>
                <option value="wifi">{{ tr('mform.hostSubjectWifi') }}</option>
              </select>
            </label>
            <label class="field" v-if="hostSubject === 'disk'">
              <span>{{ tr('mform.hostMountLabel') }}</span>
              <input v-model="form.target" :placeholder="tr('mform.hostMountPlaceholder')" />
            </label>
            <p class="hint tiny wide" v-if="rules.length">{{ tr('mform.hostSubjectLocked') }}</p>
            <p class="hint tiny wide" v-else-if="hostSubject === 'disk'">{{ tr('mform.hostMountHint') }}</p>
            <p class="hint tiny wide" v-else-if="hostSubject === 'wifi'">{{ tr('mform.hostWifiHint') }}</p>
          </template>
          <!-- gateway: no free-text target — pick an optional NIC, else default -->
          <template v-else-if="isGatewayMode">
            <label class="field wide">
              <span>{{ tr('mform.interface') }}</span>
              <input v-model="form.params!.interface" :placeholder="tr('mform.interfacePlaceholder')" />
            </label>
            <p class="hint tiny wide">{{ tr('mform.interfaceHint') }}</p>
          </template>
          <label class="field wide" v-else>
            <span>{{ form.kind === 'http' ? tr('mform.url') : (form.kind === 'nat' ? tr('mform.stunServer') : (form.kind === 'tcp' || form.kind === 'dns' ? tr('mform.hostname') : tr('mform.target'))) }}</span>
            <ComboInput v-if="form.kind === 'nat'" v-model="form.target" :options="STUN_PRESETS" :placeholder="placeholderFor('nat')" />
            <input v-else v-model="form.target" :placeholder="placeholderFor(form.kind)" />
          </label>
          <label class="field" v-if="form.kind === 'tcp'">
            <span>{{ tr('mform.port') }}</span>
            <input type="number" v-model.number="form.params!.port" placeholder="443" />
          </label>
          <div class="field wide" v-if="form.kind === 'http'">
            <span>{{ tr('mform.keyword') }}</span>
            <input v-model="form.params!.keyword" :placeholder="tr('mform.keywordOptional')" />
            <label class="inline-check">
              <input type="checkbox" v-model="form.params!.keyword_invert" />
              <span>{{ tr('mform.keywordInvert') }}</span>
            </label>
          </div>
          <label class="field" v-if="!isHostMode">
            <span>{{ tr('mform.interval') }}</span>
            <input type="number" v-model.number="form.params!.interval_seconds" :placeholder="tr('monitoring.default')" />
          </label>
          <label class="field" v-if="form.kind !== 'host'">
            <span>{{ tr('mform.timeout') }}</span>
            <input type="number" v-model.number="form.params!.timeout_ms" :placeholder="tr('monitoring.default')" />
          </label>
          <label class="field check">
            <input type="checkbox" v-model="form.enabled" /><span>{{ tr('mform.enabled') }}</span>
          </label>
        </div>
      </section>

      <!-- Scope: which agents this monitor applies to. For probes it limits which
           agents run the probe (downlink); for host anchors it limits which agents'
           system-status metrics the alert evaluates against. -->
      <section class="panel">
        <div class="panel-head"><h3>{{ tr('mform.secScope') }}</h3></div>
        <p class="hint panel-hint">{{ isHostMode ? tr('mform.scopeHintHost') : tr('mform.scopeHint') }}</p>
        <div class="panel-body">
          <label class="scope-opt">
            <input type="radio" value="all" v-model="scope" />
            <span>{{ tr('mform.scopeAll') }}</span>
          </label>
          <label class="scope-opt">
            <input type="radio" value="groups" v-model="scope" />
            <span>{{ tr('mform.scopeGroups') }}</span>
          </label>
          <div v-if="scope === 'groups'" class="group-pick">
            <p v-if="!groups.length" class="hint tiny">{{ tr('mform.noGroupsHint') }}
              <router-link to="/agents">{{ tr('mform.manageGroups') }}</router-link>
            </p>
            <label v-for="g in groups" :key="g.id" class="group-chip">
              <input type="checkbox" :checked="(form.group_ids || []).includes(g.id)" @change="toggleGroup(g.id)" />
              <span>{{ g.name }}</span>
              <em>{{ tr('mform.groupAgentCount', { n: g.agent_ids.length }) }}</em>
            </label>
            <p v-if="groups.length && !(form.group_ids || []).length" class="hint tiny warn">{{ tr('mform.scopeEmptyWarn') }}</p>
          </div>
        </div>
      </section>

      <!-- Advanced / per-type -->
      <section class="panel" v-if="form.kind === 'icmp' || form.kind === 'gateway' || form.kind === 'dns' || form.kind === 'tcp'">
        <div class="panel-head"><h3>{{ tr('mform.secAdvanced') }}</h3></div>
        <div class="form-grid">
          <template v-if="form.kind === 'icmp' || form.kind === 'gateway'">
            <label class="field"><span>{{ tr('mform.packetCount') }}</span><input type="number" v-model.number="form.params!.packet_count" placeholder="3" /></label>
            <label class="field"><span>{{ tr('mform.packetSize') }}</span><input type="number" v-model.number="form.params!.packet_size" placeholder="56" /></label>
            <label class="field"><span>{{ tr('mform.perPingTimeout') }}</span><input type="number" v-model.number="form.params!.timeout_ms" placeholder="2000" /></label>
            <label class="field"><span>{{ tr('mform.globalTimeout') }}</span><input type="number" v-model.number="form.params!.global_timeout_ms" placeholder="10000" /></label>
          </template>
          <template v-else-if="form.kind === 'dns'">
            <label class="field">
              <span>{{ tr('mform.resolverProtocol') }}</span>
              <select v-model="form.params!.resolver_protocol">
                <option value="">{{ tr('mform.dnsSystem') }}</option>
                <option value="udp">UDP</option>
                <option value="tcp">TCP</option>
                <option value="dot">DoT (DNS over TLS)</option>
                <option value="doh">DoH (DNS over HTTPS)</option>
              </select>
            </label>
            <label class="field"><span>{{ tr('mform.resolverServer') }}</span><input v-model="form.params!.resolver_server" :placeholder="resolverServerPlaceholder" /></label>
            <label class="field" v-if="dnsProto !== 'doh'"><span>{{ tr('mform.resolverPort') }}</span><input type="number" v-model.number="form.params!.resolver_port" :placeholder="resolverPortPlaceholder" /></label>
            <label class="field">
              <span>{{ tr('mform.recordType') }}</span>
              <select v-model="form.params!.record_type">
                <option value="">A/AAAA</option><option value="A">A</option><option value="AAAA">AAAA</option>
                <option value="CNAME">CNAME</option><option value="MX">MX</option><option value="TXT">TXT</option><option value="NS">NS</option>
              </select>
            </label>
            <p class="hint tiny wide">{{ tr('mform.resolverServerHint') }}</p>
          </template>
          <template v-else-if="form.kind === 'tcp'">
            <label class="field check"><input type="checkbox" v-model="form.params!.tls" /><span>{{ tr('mform.tcpTls') }}</span></label>
            <label class="field check" v-if="form.params!.tls"><input type="checkbox" v-model="form.params!.ignore_tls" /><span>{{ tr('mform.ignoreTls') }}</span></label>
          </template>
        </div>
      </section>

      <!-- HTTP options -->
      <section class="panel" v-if="form.kind === 'http'">
        <div class="panel-head"><h3>{{ tr('mform.secHttp') }}</h3></div>
        <div class="form-grid">
          <label class="field">
            <span>{{ tr('mform.method') }}</span>
            <select v-model="form.params!.method">
              <option value="">GET</option><option value="GET">GET</option><option value="HEAD">HEAD</option>
              <option value="POST">POST</option><option value="PUT">PUT</option><option value="PATCH">PATCH</option><option value="DELETE">DELETE</option>
            </select>
          </label>
          <label class="field"><span>{{ tr('mform.acceptedStatuses') }}</span><input v-model="form.params!.accepted_statuses" placeholder="200-299,301" /></label>
          <label class="field"><span>{{ tr('mform.maxRedirects') }}</span><input type="number" v-model.number="form.params!.max_redirects" placeholder="10" /></label>
          <label class="field" v-if="form.params!.keyword"><span>{{ tr('mform.maxResponseBytes') }}</span><input type="number" v-model.number="form.params!.max_response_bytes" placeholder="1024" /></label>
          <label class="field check"><input type="checkbox" v-model="form.params!.ignore_tls" /><span>{{ tr('mform.ignoreTls') }}</span></label>
          <p class="hint tiny wide">{{ tr('mform.acceptedStatusesHint') }}</p>
          <label class="field wide"><span>{{ tr('mform.requestHeaders') }}</span><textarea v-model="headersText" rows="3" placeholder="X-Api-Key: abc"></textarea></label>
          <label class="field wide"><span>{{ tr('mform.requestBody') }}</span><textarea v-model="form.params!.body" rows="3" placeholder='{"key":"value"}'></textarea></label>
        </div>
      </section>

      <!-- NAT options -->
      <section class="panel" v-if="form.kind === 'nat'">
        <div class="panel-head"><h3>{{ tr('mform.secNat') }}</h3></div>
        <div class="form-grid">
          <label class="field">
            <span>{{ tr('mform.natTransport') }}</span>
            <select v-model="form.params!.nat_transport">
              <option value="udp">UDP</option>
              <option value="tcp">TCP</option>
              <option value="tls">TLS</option>
              <option value="dtls">DTLS</option>
            </select>
          </label>
          <label class="field check" v-if="form.params!.nat_transport === 'tls'">
            <input type="checkbox" v-model="form.params!.ignore_tls" /><span>{{ tr('mform.ignoreTls') }}</span>
          </label>
          <label class="field wide" v-if="!form.params!.nat_transport || form.params!.nat_transport === 'udp'">
            <span>{{ tr('mform.natServer2') }}</span>
            <ComboInput :model-value="form.params!.stun_server2 || ''" @update:model-value="form.params!.stun_server2 = $event" :options="STUN_PRESETS" placeholder="stun2.example.com:3478" />
          </label>
          <p class="hint tiny wide">{{ tr('mform.natHint') }}</p>
          <p class="hint tiny wide" v-if="!form.params!.nat_transport || form.params!.nat_transport === 'udp'">{{ tr('mform.natServer2Hint') }}</p>
        </div>
      </section>

      <!-- Validation / notifications -->
      <section class="panel">
        <div class="panel-head"><h3>{{ tr('mform.secValidation') }}</h3></div>
        <p class="hint panel-hint">{{ tr('mform.validationHint') }}</p>
        <p class="hint panel-hint" v-if="form.kind === 'nat'">{{ tr('mform.natRuleHint') }}</p>
        <div class="panel-body">
          <p v-if="!form.id" class="hint tiny">{{ tr('mform.saveFirstForRules') }}</p>
          <template v-else>
            <button class="link-btn" @click="addRule">{{ tr('monitoring.newRule') }}</button>
            <div v-if="!rules.length" class="hint tiny">{{ tr('monitoring.noRulesHint', { kind: form.kind.toUpperCase() }) }}</div>
            <div v-for="r in rules" :key="r.id" class="rule-card">
              <div class="rule-head">
                <input v-model="r.name" class="rule-name" :placeholder="tr('mform.ruleName')" />
                <label class="inline"><input type="checkbox" v-model="r.enabled" />{{ tr('monitoring.enable') }}</label>
              </div>
              <div class="rule-cond">
                <span class="lead">{{ tr('mform.when') }}</span>
                <select :value="presetKeyOf(r)" @change="applyPreset(r, ($event.target as HTMLSelectElement).value)">
                  <option v-for="p in presetsForKind(form.kind)" :key="p.key" :value="p.key">{{ tr(p.label) }}</option>
                </select>
                <template v-if="presetByKey(presetKeyOf(r))?.fixed == null">
                  <input type="number" step="any" :value="thresholdDisplay(r)" @input="setThreshold(r, ($event.target as HTMLInputElement).valueAsNumber)" class="num" />
                  <span class="unit">{{ presetByKey(presetKeyOf(r))?.unit }}</span>
                </template>
                <label class="inline">{{ tr('monitoring.consecutive') }}<input type="number" v-model.number="r.fail_threshold" class="num sm" />{{ tr('monitoring.times') }}</label>
                <span class="lead">{{ tr('mform.thenNotify') }}</span>
                <select v-model="r.severity" class="sev">
                  <option value="info">{{ tr('mform.sev_info') }}</option>
                  <option value="warn">{{ tr('mform.sev_warn') }}</option>
                  <option value="error">{{ tr('mform.sev_error') }}</option>
                  <option value="critical">{{ tr('mform.sev_critical') }}</option>
                </select>
              </div>
              <p class="rule-preview">{{ ruleSentence(r) }}</p>
              <div class="rule-line channels">
                <span class="chan-label">{{ tr('monitoring.notifyChannels') }}</span>
                <span v-if="!channels.length" class="hint tiny">{{ tr('monitoring.noChannelHint') }}</span>
                <label v-for="c in channels" :key="c.id" class="chan">
                  <input type="checkbox" :checked="(r.channel_ids || []).includes(c.id)" @change="toggleChannel(r, c.id)" />
                  {{ channelLabel(c) }}
                </label>
                <span class="spacer"></span>
                <button class="link-btn" @click="saveRule(r)">{{ tr('common.save') }}</button>
                <button class="link-btn danger" @click="delRule(r)">{{ tr('common.delete') }}</button>
              </div>
            </div>
          </template>
        </div>
      </section>

      <div class="form-foot">
        <router-link to="/monitoring" class="btn">{{ tr('mform.cancel') }}</router-link>
        <button class="btn btn-primary" :disabled="busy || !loaded" @click="save">{{ busy ? tr('mform.saving') : tr('mform.save') }}</button>
        <span v-if="saved" class="ok">{{ tr('mform.saved') }}</span>
      </div>

      <div v-if="saveWarning" class="card save-warn">
        <h4>{{ tr('mform.saveWarnTitle') }}</h4>
        <p class="hint">{{ tr('mform.saveWarnIntro', { blocked: saveWarning.affected_agents, capable: saveWarning.capable_agents }) }}</p>
        <ul class="warn-list">
          <li v-for="a in saveWarning.blocked_agents" :key="a.agent_id">
            <span class="warn-agent">{{ a.agent_name || a.agent_id }}</span>
            <span class="warn-state">{{ tr(`monitorState.${a.status}`) }}</span>
            <span v-if="a.missing_permissions.length" class="warn-perms mono">{{ a.missing_permissions.join(', ') }}</span>
          </li>
        </ul>
        <p v-if="saveWarning.capable_agent_list.length" class="warn-capable">
          <span class="warn-capable-label">{{ tr('mform.saveWarnCapableLabel') }}</span>
          <span class="warn-capable-names">{{ saveWarning.capable_agent_list.map((a) => a.agent_name || a.agent_id).join(', ') }}</span>
        </p>
      </div>
    </template>
  </main>
</template>

<style scoped>.page { max-width: 860px; }
.save-warn {
  margin-top: 14px;
  padding: 14px 16px;
  border-left: 3px solid var(--warn, #fbbf24);
}
.save-warn h4 { margin: 0 0 4px; font-size: 14px; }
.warn-list { margin: 8px 0 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 6px; }
.warn-list li { display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; font-size: 13px; }
.warn-agent { font-weight: 600; color: var(--text); }
.warn-state { color: #fca5a5; font-size: 12px; }
.warn-perms { color: var(--text-dim); font-size: 12px; }
.warn-capable { margin: 10px 0 0; font-size: 12.5px; display: flex; gap: 8px; flex-wrap: wrap; align-items: baseline; }
.warn-capable-label { font-weight: 600; color: var(--text); }
.warn-capable-names { color: var(--text-dim); }
.host-intro {
  margin: 0 0 16px;
  padding: 11px 14px;
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--text-dim);
  background: var(--primary-soft, var(--surface-2));
  border: 1px solid var(--border);
  border-left: 3px solid var(--primary);
  border-radius: var(--radius-sm);
}
.panel { margin-bottom: 18px; }
.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px 18px;
  padding: 14px 18px;
}
.field { display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: var(--text-dim); }
.field.wide { grid-column: 1 / -1; }
.field.check { flex-direction: row; align-items: center; gap: 8px; }
.inline-check { display: inline-flex; align-items: center; gap: 6px; margin-top: 6px; font-size: 12.5px; color: var(--text-dim); }
.inline-check input { width: auto; }
.field input[type='text'],
.field input:not([type]),
.field input[type='number'],
.field select,
.field textarea { width: 100%; }
.field textarea { resize: vertical; font-family: inherit; }
.panel-hint { margin: 0 18px 6px; }
.panel-body { padding: 8px 18px 16px; }
.rule-card { border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 10px 12px; margin: 10px 0; background: var(--surface); }
.rule-head { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
.rule-head .rule-name { flex: 1; }
.rule-cond { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 13px; color: var(--text-dim); }
.rule-cond .lead { color: var(--text-dim); }
.rule-cond .unit { margin-left: -4px; color: var(--text-dim); }
.rule-cond .sev { min-width: 84px; }
.rule-preview { margin: 8px 0 0; font-size: 12px; color: var(--text-dim); }
.rule-line { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.rule-line.channels { margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--border); }
.rule-name { min-width: 130px; }
.inline { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--text-dim); }
.chan-label { font-size: 12.5px; color: var(--text-dim); }
.chan { display: inline-flex; gap: 4px; align-items: center; font-size: 12.5px; }
.spacer { flex: 1; }
.cmp { padding: 6px 8px; }
.num { width: 80px; padding: 6px 8px; }
.num.sm { width: 62px; }
.tiny { font-size: 11.5px; margin: 4px 0 0; }
.tiny.warn { color: var(--warn, #b26b00); }
.scope-opt { display: flex; align-items: center; gap: 8px; font-size: 13px; margin: 4px 0; }
.scope-opt input { width: auto; }
.group-pick { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--border); }
.group-chip { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; padding: 4px 8px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); }
.group-chip input { width: auto; }
.group-chip em { font-style: normal; color: var(--text-dim); font-size: 11px; }
.form-foot { display: flex; align-items: center; gap: 12px; padding: 4px 0 20px; }
</style>

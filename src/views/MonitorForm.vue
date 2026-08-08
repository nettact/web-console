<script setup lang="ts">
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import {
  api,
  type DetectionProfile,
  type DetectionSettingsInput,
  type Channel,
  type HostDetection,
  type MonitorGroup,
  type ProbeParams,
  type ProbeTarget,
  type Proxy,
  type SaveWarning,
  type SmartSensitivity,
} from '../api'
import ComboInput from '../components/ComboInput.vue'
import { pushToast } from '../toasts'
import { LEADING_SCHEME, paramsRangeError, retargetForKind, targetError } from '../lib/targetValidation'
import { profileRounds } from '../lib/detection'
import {
  anyProxyCapable,
  proxyDisabledWarning,
  proxyUnusableReason,
  usableProxies,
} from '../lib/proxyCapability'

const { t: tr } = useI18n()
const route = useRoute()
const router = useRouter()

const SITE = 'site_default'
const editingId = computed(() => (route.params.id as string) || '')
// The host flow has its own create route so it can open without the type
// dropdown and seed a whole-machine anchor (target "host") straight away.
const isNewHost = computed(() => route.path.endsWith('/new-host'))

const all = ref<ProbeTarget[]>([])
// Monitor groups: a target must belong to exactly one. The scope/merge policy now
// lives on the group, so this form no longer configures Agent scope or alert rules.
const groups = ref<MonitorGroup[]>([])
const form = reactive<ProbeTarget>(blank())
if (isNewHost.value) {
  form.kind = 'host'
  form.target = 'host'
}
// Quick-add prefill: the Live Connections page links here with kind/target[/port]
// to seed a new monitor. This only sets initial form values — it never saves.
if (!editingId.value && !isNewHost.value) applyQueryPrefill()

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

const isHostMode = computed(() => form.kind === 'host')
const isGatewayMode = computed(() => form.kind === 'gateway')
// icmp and gateway share the ping cycle, so they share its params — including
// timeout_ms, which for them means "per echo", not "per request". They get the
// labelled per-ping field in the advanced panel instead of the generic timeout.
const isPingMode = computed(() => form.kind === 'icmp' || form.kind === 'gateway')
const headersText = ref('')
const error = ref('')
const saved = ref(false)
const busy = ref(false)
// Save warnings for THIS monitor: in-scope agents that cannot run it under their
// current permission policy (per-agent, from the set-targets response).
const saveWarning = ref<SaveWarning | null>(null)
const notFound = ref(false)
// Whether the site has any notification channel at all. Empty is legal — faults
// are still recorded — but the save confirmation says so instead of leaving the
// user to assume something was sent.
const hasChannels = ref(true)
// Guards a destructive save: setTargets is a full reconcile, so saving before the
// existing target list has loaded would delete every other monitor.
const loaded = ref(false)

function blank(): ProbeTarget {
  return { group_id: '', kind: 'icmp', name: '', target: '', params: {}, enabled: true, proxy_id: '' }
}

// ---- egress proxy ----
// A monitor may be pinned to one site proxy. The picker only appears for kinds a
// proxy can actually carry, and only offers proxies whose transport can carry THIS
// kind (protocol/config/proxy.go's capability matrix, mirrored in
// lib/proxyCapability.ts) — offering an option the server rejects and the agent
// refuses to run would be worse than not offering it.
const proxies = ref<Proxy[]>([])
// The panel also stays visible whenever a pin EXISTS, even if the current kind/params
// can no longer use one. Otherwise clearing a DNS monitor's resolver server hid the
// only control that could unpin it while the save stayed blocked — a dead end the user
// could escape only by restoring settings they were deliberately changing.
const showProxy = computed(() => anyProxyCapable(form.kind, form.params) || !!form.proxy_id)
const proxyOptions = computed(() => usableProxies(proxies.value, form.kind, form.params))
const selectedProxy = computed(() => proxies.value.find((p) => p.id === form.proxy_id))
// A selection can be invalidated by an edit elsewhere on this form (switching the
// kind, changing the resolver protocol or NAT transport) or by the proxy being
// disabled since. Say which, rather than letting the option quietly disappear.
const proxyProblemKey = computed(() => proxyUnusableReason(selectedProxy.value, form.kind, form.params))
// A disabled pin is a WARNING, not an error: the server accepts it and the agent fails
// the monitor closed by design, so it must not block unrelated edits to the monitor.
const proxyWarningKey = computed(() => proxyDisabledWarning(selectedProxy.value))

// Every <select> needs its bound param to hold a real option value: an undefined
// binding matches no <option>, so the browser renders a blank row instead of the
// first choice. Seed the per-kind selects with their first option ('' means the
// leading "system default" entry, which cleanParams drops before saving).
const KIND_SELECT_DEFAULTS: Record<string, Record<string, string>> = {
  dns: { resolver_protocol: '', record_type: '' },
  http: { method: '' },
  nat: { nat_transport: 'udp' },
}

function applyKindDefaults() {
  if (!form.params) form.params = {}
  const defaults = KIND_SELECT_DEFAULTS[form.kind]
  if (!defaults) return
  const params = form.params as Record<string, unknown>
  for (const [key, value] of Object.entries(defaults)) {
    // A stored '' is a real choice only where '' IS the seeded default — that is
    // the leading "system default" <option>. Where the default is a concrete value
    // the select has no empty option at all, so an existing '' (e.g. a NAT monitor
    // saved without a transport) matches nothing and renders a blank row; seed it.
    const unset = params[key] === undefined || params[key] === null || (params[key] === '' && value !== '')
    if (unset) params[key] = value
  }
}

// ---- built-in detection sensitivity ----
// Every enabled target gets an availability detector; there is no off switch by
// design. The only tunables are how many consecutive rounds confirm a fault and
// how many confirm the recovery, plus the loss threshold for ICMP/gateway.
// host targets carry no such detector, so the whole block is hidden for them.
//
// Smart detection (ALERT-003) sits alongside it and DOES have an off switch: it
// judges a target against its own history rather than against a fixed number, so
// it makes a claim about usual behaviour rather than about whether the thing
// works. Its sensitivity is presented as three plain-language levels — the
// multipliers and round counts behind them are never shown, because they are not
// numbers anybody could calibrate by eye.
const DETECTION_PROFILES: DetectionProfile[] = ['balanced', 'fast', 'stable', 'custom']
const SMART_LEVELS: SmartSensitivity[] = ['loose', 'standard', 'sensitive']
const detection = reactive<DetectionSettingsInput>({
  profile: 'balanced',
  fail_rounds: 3,
  recover_rounds: 2,
  icmp_loss_pct: 100,
  smart_enabled: true,
  smart_sensitivity: 'standard',
})
// Server state as last seen, so an untouched form never PATCHes (and never bumps
// the settings revision) just because the target itself was saved.
const detectionBaseline = ref<DetectionSettingsInput>({ ...detection })
const detectionOpen = ref(false)
const showDetection = computed(() => form.kind !== 'host')
const showLossThreshold = computed(() => form.kind === 'icmp' || form.kind === 'gateway')
// Smart loss detection stands down once the user has stated their own loss
// tolerance, so the copy has to stop implying it is still watching.
const smartLossYielded = computed(
  () => showLossThreshold.value && detection.icmp_loss_pct !== 100,
)

function setProfile(p: DetectionProfile) {
  detection.profile = p
  const preset = profileRounds(p)
  if (preset) {
    detection.fail_rounds = preset.fail
    detection.recover_rounds = preset.recover
  }
}
function detectionChanged(): boolean {
  const b = detectionBaseline.value
  return (
    b.profile !== detection.profile ||
    b.fail_rounds !== detection.fail_rounds ||
    b.recover_rounds !== detection.recover_rounds ||
    b.icmp_loss_pct !== detection.icmp_loss_pct ||
    b.smart_enabled !== detection.smart_enabled ||
    b.smart_sensitivity !== detection.smart_sensitivity
  )
}
// The number inputs' min/max are advisory (this form saves from a button click),
// so the bounds are enforced here too.
function detectionRangeError(): string {
  if (!showDetection.value) return ''
  const ok = (v: number, min: number, max: number) => Number.isInteger(v) && v >= min && v <= max
  if (
    detection.profile === 'custom' &&
    (!ok(detection.fail_rounds, 1, 20) || !ok(detection.recover_rounds, 1, 20))
  ) {
    return tr('detection.errRounds')
  }
  if (showLossThreshold.value && !ok(detection.icmp_loss_pct, 1, 100)) return tr('detection.errLoss')
  return ''
}
async function loadDetection(id: string) {
  try {
    const d = await api.detectionSettings(id)
    detection.profile = d.profile
    detection.fail_rounds = d.fail_rounds
    detection.recover_rounds = d.recover_rounds
    detection.icmp_loss_pct = d.icmp_loss_pct
    detection.smart_enabled = d.smart_enabled
    detection.smart_sensitivity = d.smart_sensitivity
  } catch {
    // Not materialized yet — the defaults above are the ones the server applies.
  }
  detectionBaseline.value = { ...detection }
}
// Runs only after the target itself is saved, because the settings hang off its
// id (a create has no id until then).
async function saveDetection(): Promise<boolean> {  if (!showDetection.value || !form.id || !detectionChanged()) return true
  try {
    const d = await api.updateDetectionSettings(form.id, {
      profile: detection.profile,
      fail_rounds: detection.fail_rounds,
      recover_rounds: detection.recover_rounds,
      icmp_loss_pct: detection.icmp_loss_pct,
      smart_enabled: detection.smart_enabled,
      smart_sensitivity: detection.smart_sensitivity,
    })
    detection.profile = d.profile
    detection.fail_rounds = d.fail_rounds
    detection.recover_rounds = d.recover_rounds
    detection.icmp_loss_pct = d.icmp_loss_pct
    detection.smart_enabled = d.smart_enabled
    detection.smart_sensitivity = d.smart_sensitivity
    detectionBaseline.value = { ...detection }
    return true
  } catch (e) {
    error.value = tr('mform.detectionSaveErr', { err: String((e as Error).message || e) })
    return false
  }
}
// ---- system-status detection (host anchors) ----
//
// A host anchor watches the machines its monitor group covers, and the five
// families below are the whole of what it can say. Each is a sentence with two
// blanks — a level and a duration — offered as bounded presets, because the
// presets are the answer for almost everyone and a free number field invites
// thresholds nobody can calibrate. "Custom" reveals the raw field for the rest.
//
// All five rows are visible at once rather than tucked behind a disclosure: this
// IS the editor for a host monitor, and a primary editor nobody opens is a
// feature nobody has.
//
// Network is the exception on every count: off by default, no preset levels, and
// its two directions set independently — a home link's upstream saturates long
// before its downstream does, and no universal Mbps figure exists to suggest.
const PCT_PRESETS = [80, 90, 95]
const DURATION_PRESETS = [60, 300, 900]
const LOAD_PRESETS = [1.5, 2, 3]

type HostFamilyKey = 'cpu' | 'mem' | 'load' | 'net' | 'disk'

const hostDet = reactive<HostDetection>({
  target_id: '',
  cpu: { enabled: true, pct: 90, duration_s: 300 },
  mem: { enabled: true, pct: 90, duration_s: 300 },
  load: { enabled: true, per_core: 2, duration_s: 300 },
  net: { enabled: false, rx_mbps: null, tx_mbps: null, duration_s: 300 },
  disk: { enabled: true, pct: 90 },
  revision: 1,
})
// Server state as last seen, so an untouched form never PATCHes — and never
// bumps the revision that resets every running streak — just because the anchor
// itself was saved.
const hostDetBaseline = ref('')
// Whether the anchor's stored thresholds are actually in hand. A NEW anchor has
// none to fetch, so the defaults above are the truth and it starts ready; an
// EDIT has to wait, because the panel is bound to those defaults until the
// response lands and both editing and saving against them would be editing and
// saving values the operator never chose.
const hostDetReady = ref(!editingId.value)
const hostDetError = ref('')
// Which rows have their level/duration escaped into a free number field. Purely
// presentational: the stored value is the same either way.
const hostCustom = reactive<Record<string, boolean>>({})

function hostSnapshot(): string {
  return JSON.stringify([hostDet, hostNetRaw])
}
function hostDetChanged(): boolean {
  return hostSnapshot() !== hostDetBaseline.value
}
// A preset select shows "custom" whenever the stored value is not one of the
// offered ones, so an anchor configured through the API renders honestly instead
// of silently snapping to the nearest preset.
function hostPresetMode(key: HostFamilyKey, field: 'pct' | 'per_core' | 'duration_s', presets: number[]): boolean {
  const id = `${key}.${field}`
  if (hostCustom[id]) return false
  const v = (hostDet[key] as Record<string, unknown>)[field]
  return typeof v === 'number' && presets.includes(v)
}
function hostSetCustom(key: HostFamilyKey, field: string, on: boolean) {
  hostCustom[`${key}.${field}`] = on
}

// Durations are seconds on the wire and minutes on screen. A raw 30–3600 second
// box is exactly the kind of unit the UI conventions say to humanize, and it
// reads badly next to presets that already say "5 min". A quarter-minute step
// keeps the whole accepted range reachable (30s is 0.5).
function hostDurationMinutes(key: HostFamilyKey): number {
  return Math.round(((hostDet[key] as { duration_s: number }).duration_s / 60) * 100) / 100
}
function setHostDurationMinutes(key: HostFamilyKey, minutes: number) {
  const s = Math.round(Number(minutes) * 60)
  ;(hostDet[key] as { duration_s: number }).duration_s = Number.isFinite(s) ? s : 0
}

// Mirrors the server's ranges so a value it would reject is reported here, next
// to the field that caused it, instead of after a round trip.
// Only ENABLED families are validated. A family that is switched off has its
// controls hidden, so refusing to save because of a value inside one would point
// at a field the user cannot see — and the value is not going to be judged
// against anything anyway.
function hostRangeError(): string {
  if (!isHostMode.value) return ''
  const pct = (v: number) => Number.isFinite(v) && v > 0 && v <= 100
  const dur = (v: number) => Number.isInteger(v) && v >= 30 && v <= 3600
  for (const f of [hostDet.cpu, hostDet.mem] as const) {
    if (!f.enabled) continue
    if (!pct(f.pct)) return tr('mform.hostDet.errPct')
    if (!dur(f.duration_s)) return tr('mform.hostDet.errDuration')
  }
  if (hostDet.disk.enabled && !pct(hostDet.disk.pct)) return tr('mform.hostDet.errPct')
  if (hostDet.load.enabled) {
    const v = hostDet.load.per_core
    if (!(Number.isFinite(v) && v > 0 && v <= 100)) return tr('mform.hostDet.errLoad')
    if (!dur(hostDet.load.duration_s)) return tr('mform.hostDet.errDuration')
  }
  if (hostDet.net.enabled) {
    if (hostNetRawInvalid(hostNetRaw.rx) || hostNetRawInvalid(hostNetRaw.tx)) {
      return tr('mform.hostDet.errNetRate')
    }
    // Enabling the family with neither direction set would be an alert the form
    // shows as on and the server treats as off.
    if (!hostNetRate(hostNetRaw.rx) && !hostNetRate(hostNetRaw.tx)) {
      return tr('mform.hostDet.errNetDirection')
    }
    if (!dur(hostDet.net.duration_s)) return tr('mform.hostDet.errDuration')
  }
  return ''
}

// The Mbps fields are held as the raw strings the user typed, not as numbers.
// Coercing on input would turn "0" and "-5" into null — the same value a blank
// field has — so validation would see a perfectly valid one-direction setup and
// the save would succeed while silently discarding what was on screen. The
// conversion happens once, on the way into the PATCH.
const hostNetRaw = reactive({ rx: '', tx: '' })

// A blank field means "do not alert on this direction", which is null on the
// wire — not 0, which would be a threshold every link is always above.
function hostNetRate(raw: string): number | null {
  const s = String(raw ?? '').trim()
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}
// "" is a deliberate blank; anything else has to be a positive number.
function hostNetRawInvalid(raw: string): boolean {
  const s = String(raw ?? '').trim()
  if (!s) return false
  const n = Number(s)
  return !Number.isFinite(n) || n <= 0
}

function applyHostDetection(d: HostDetection) {
  hostDet.target_id = d.target_id
  hostDet.cpu = { ...d.cpu }
  hostDet.mem = { ...d.mem }
  hostDet.load = { ...d.load }
  hostDet.net = { ...d.net }
  hostDet.disk = { ...d.disk }
  hostDet.revision = d.revision
  hostDet.updated_at = d.updated_at
  hostNetRaw.rx = d.net.rx_mbps == null ? '' : String(d.net.rx_mbps)
  hostNetRaw.tx = d.net.tx_mbps == null ? '' : String(d.net.tx_mbps)
  // Anything the server holds that is not one of our presets opens its row's
  // custom field, so the number stays visible and editable.
  hostSetCustom('cpu', 'pct', !PCT_PRESETS.includes(d.cpu.pct))
  hostSetCustom('mem', 'pct', !PCT_PRESETS.includes(d.mem.pct))
  hostSetCustom('disk', 'pct', !PCT_PRESETS.includes(d.disk.pct))
  hostSetCustom('load', 'per_core', !LOAD_PRESETS.includes(d.load.per_core))
  hostSetCustom('cpu', 'duration_s', !DURATION_PRESETS.includes(d.cpu.duration_s))
  hostSetCustom('mem', 'duration_s', !DURATION_PRESETS.includes(d.mem.duration_s))
  hostSetCustom('load', 'duration_s', !DURATION_PRESETS.includes(d.load.duration_s))
  hostSetCustom('net', 'duration_s', !DURATION_PRESETS.includes(d.net.duration_s))
  hostDetBaseline.value = hostSnapshot()
  hostDetReady.value = true
  hostDetError.value = ''
}

async function loadHostDetection(id: string) {
  try {
    applyHostDetection(await api.hostDetection(id))
    hostDetReady.value = true
  } catch (e) {
    // NOT "not materialized yet": the endpoint answers an unconfigured anchor
    // with the defaults, so a rejection here is a real read failure (401, 500,
    // a dropped connection). Treating it as a successful default snapshot would
    // show every family at 90%/5min and then, on the first edit, PATCH those
    // invented values over whatever the operator had actually stored. Say so and
    // keep the panel out of use instead.
    hostDetError.value = tr('mform.hostDet.loadErr', { err: String((e as Error).message || e) })
  }
}

// Written only once the anchor's id exists, exactly like the probe sensitivity.
async function saveHostDetection(): Promise<boolean> {
  if (!isHostMode.value || !form.id || !hostDetChanged()) return true
  try {
    applyHostDetection(
      await api.updateHostDetection(form.id, {
        cpu: { ...hostDet.cpu },
        mem: { ...hostDet.mem },
        load: { ...hostDet.load },
        net: {
          ...hostDet.net,
          rx_mbps: hostNetRate(hostNetRaw.rx),
          tx_mbps: hostNetRate(hostNetRaw.tx),
        },
        disk: { ...hostDet.disk },
      }),
    )
    return true
  } catch (e) {
    error.value = tr('mform.hostDet.saveErr', { err: String((e as Error).message || e) })
    return false
  }
}

// The families this anchor is actually watching, for the summary line and the
// post-save toast.
const hostEnabledFamilies = computed<HostFamilyKey[]>(() =>
  (['cpu', 'mem', 'load', 'net', 'disk'] as HostFamilyKey[]).filter((k) => hostDet[k].enabled),
)

const defaultGroupId = computed(() => groups.value.find((g) => g.is_default)?.id || '')

const dnsProto = computed(() => form.params?.resolver_protocol || '')
const resolverServerPlaceholder = computed(() =>
  dnsProto.value === 'doh'
    ? 'https://cloudflare-dns.com/dns-query'
    : dnsProto.value === 'dot'
      ? '1.1.1.1 / dns.google'
      : '1.1.1.1',
)
const resolverPortPlaceholder = computed(() => (dnsProto.value === 'dot' ? '853' : '53'))

const STUN_PRESETS = [
  'stun.hot-chilli.net',
  'stun.fitauto.ru',
  'stun.internetcalls.com',
  'stun.voip.aebc.com',
  'stun.voipbuster.com',
  'stun.voipstunt.com',
  'stun.miwifi.com',
]

// An HTTP monitor's target is a URL and the agent can only dial http/https. A
// scheme-less address ("www.example.com") is what an address bar accepts but what
// the probe rejects outright, so mirror the server's normalization here — on blur
// and again before submit — to keep the value the user sees identical to the one
// that gets probed.
// Only a LEADING scheme means "already schemed": a "://" further along belongs to
// the path or query ("example.com/login?next=https://idp"), and treating that as
// schemed would submit a URL the probe cannot dial.
function httpURL(raw: string): string {
  const s = raw.trim()
  if (!s || LEADING_SCHEME.test(s)) return s
  return `https://${s}`
}
function normalizeTargetURL() {
  if (form.kind === 'http') form.target = httpURL(form.target)
}

// Live shape check for the target field, mirroring the server's rules so a value
// the probe could only fail on is reported HERE, not after a save round trip and
// a cycle of red "probe failed" with a generic error class. Empty is left to the
// existing "target required" guard so the field is not red before it is typed in.
const targetErrorKey = computed(() => {
  if (isHostMode.value || isGatewayMode.value || !form.target.trim()) return ''
  return targetError(form.kind, form.kind === 'http' ? httpURL(form.target) : form.target)
})
const targetErrorText = computed(() => (targetErrorKey.value ? tr(targetErrorKey.value) : ''))

function placeholderFor(kind: string): string {
  if (kind === 'dns') return 'example.com'
  if (kind === 'http') return 'https://example.com'
  if (kind === 'tcp') return 'example.com'
  if (kind === 'nat') return 'stun.example.com'
  return '1.1.1.1'
}

async function loadAll() {
  let chans: Channel[] = []
  try {
    ;[all.value, groups.value, chans, proxies.value] = await Promise.all([
      api.listTargets(SITE),
      api.monitorGroups(SITE),
      api.channels(),
      api.proxies(SITE),
    ])
  } catch (e) {
    // Leave loaded=false so Save stays disabled — reconciling against an empty
    // list would wipe every existing monitor.
    error.value = String((e as Error).message || e)
    return
  }
  hasChannels.value = chans.length > 0
  all.value.forEach((x) => {
    if (!x.params) x.params = {}
  })
  loaded.value = true
  if (editingId.value) {
    const found = all.value.find((x) => x.id === editingId.value)
    if (!found) {
      notFound.value = true
      return
    }
    Object.assign(form, JSON.parse(JSON.stringify(found)))
    applyKindDefaults()
    headersText.value = headersToText(form.params!.headers)
    if (showDetection.value) await loadDetection(editingId.value)
    if (isHostMode.value) await loadHostDetection(editingId.value)
    return
  }
  if (!form.group_id) {
    // New target: honor an explicit ?group= (from a group's "add target" link),
    // otherwise land it in the site default group.
    const q = queryStr(route.query.group)
    form.group_id = groups.value.some((g) => g.id === q) ? q : defaultGroupId.value
  }
  // The kind watcher can't cover a kind set during setup (query prefill / new-host).
  applyKindDefaults()
}

function headersToText(h?: Record<string, string>): string {
  if (!h) return ''
  return Object.entries(h)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')
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
  if (!form.group_id) {
    error.value = tr('mform.groupRequired')
    return
  }
  // Gateway targets carry no user-entered target (the server normalizes it to
  // "gateway"); every other kind needs one.
  if (!isGatewayMode.value && !form.target.trim()) {
    error.value = tr('mform.targetRequired')
    return
  }
  // A target whose SHAPE is wrong for the kind (a URL in a DNS monitor, a port in
  // a TCP host…) can never probe successfully. The server rejects it too; failing
  // here keeps the message next to the field that caused it.
  normalizeTargetURL()
  if (targetErrorKey.value) {
    error.value = targetErrorText.value
    return
  }
  // The inputs' min/max are advisory: this form saves from a button click, so the
  // browser never runs constraint validation. Check the ranges for real.
  const range = paramsRangeError(form.kind, form.params as Record<string, unknown> | undefined)
  if (range) {
    error.value = tr('mform.errParamRange', { field: tr(range.labelKey), min: range.min, max: range.max })
    return
  }
  const detErr = detectionRangeError()
  if (detErr) {
    error.value = detErr
    return
  }
  // Saving a host anchor whose thresholds never loaded would PATCH the panel's
  // defaults over the stored ones, so the save is refused rather than narrowed.
  if (isHostMode.value && !hostDetReady.value) {
    error.value = hostDetError.value || tr('mform.hostDet.loading')
    return
  }
  const hostErr = hostRangeError()
  if (hostErr) {
    error.value = hostErr
    return
  }
  // An unhonorable proxy pin is rejected by the server (and would make the monitor
  // un-runnable rather than direct), so it is caught here where the field that caused
  // it is visible.
  if (proxyProblemKey.value) {
    error.value = tr(proxyProblemKey.value, { name: selectedProxy.value?.name ?? '' })
    return
  }
  busy.value = true
  saved.value = false
  error.value = ''
  saveWarning.value = null
  try {
    if (form.kind === 'http') form.params!.headers = textToHeaders(headersText.value)
    normalizeTargetURL()
    const target = isGatewayMode.value ? 'gateway' : form.target.trim()
    const current: ProbeTarget = { ...form, target, params: cleanParams(form.params) }
    // Rebuild the full set (setTargets is a full reconcile), upserting this one.
    const others = all.value
      .filter((x) => x.id && x.id !== form.id)
      .map((x) => ({ ...x, params: cleanParams(x.params) }))
    // Snapshot existing ids so a newly created monitor (which gets a fresh id not
    // in this set) is identified unambiguously.
    const beforeIds = new Set(others.map((x) => x.id))
    const payload = [...others, current]
    const res = await api.setTargets(SITE, payload)
    // Reload so a freshly-created monitor gets its server-assigned id; locate it by
    // id (edit) or the one new id (create).
    all.value = await api.listTargets(SITE)
    all.value.forEach((x) => {
      if (!x.params) x.params = {}
    })
    const match = form.id
      ? all.value.find((x) => x.id === form.id)
      : all.value.find((x) => x.id && !beforeIds.has(x.id))
    if (match) form.id = match.id
    saved.value = true
    // Sensitivity hangs off the target's id, so it is written only once that id
    // exists — right after the target itself was saved.
    const detectionOK = await saveDetection()
    // Same reason, same moment: the thresholds hang off the anchor's id.
    const hostOK = await saveHostDetection()
    // A save-time finding keeps the form open so the user sees it: which in-scope
    // agents cannot run this monitor, or a sensitivity write that failed. A clean
    // save goes straight back to the list, with the outcome carried in a toast.
    const warning = res.warnings.find((wgn) => wgn.monitor_id === form.id) ?? null
    saveWarning.value = warning
    if (!warning && detectionOK && hostOK) {
      pushToast({
        tone: 'info',
        title: tr('mform.saved'),
        body: showDetection.value
          ? tr('mform.savedDetectionOn', { fail: detection.fail_rounds, recover: detection.recover_rounds })
          : hostEnabledFamilies.value.length
            ? tr('mform.hostDet.savedOn', {
                families: hostEnabledFamilies.value.map((k) => tr(`monitoring.hostFam.${k}`)).join(' · '),
              })
            : tr('mform.hostDet.savedOff'),
      })
      if ((showDetection.value || hostEnabledFamilies.value.length > 0) && !hasChannels.value) {
        pushToast({ tone: 'warn', title: tr('mform.savedNoChannels') })
      }
      router.push('/monitoring')
      return
    }
    // Keep the URL on the monitor that was just created, so a reload re-opens it.
    if (!editingId.value && form.id) router.replace(`/monitoring/${form.id}/edit`)
  } catch (e) {
    error.value = String((e as Error).message || e)
  } finally {
    busy.value = false
  }
}

// Ensure params exist on kind change, carry the target across into the shape the
// new kind needs, and drop the http-only keyword when leaving http so a stale
// keyword can't misclassify the monitor.
watch(
  () => form.kind,
  (k, prev) => {
    if (!form.params) form.params = {}
    if (k !== 'http') {
      form.params.keyword = ''
      form.params.keyword_invert = false
    }
    // Switching the kind keeps whatever was in the target field — which is how a
    // URL ends up in a DNS monitor that can then only fail. Convert it (a URL
    // becomes its hostname); anything unconvertible stays put and the inline
    // error names it.
    form.target = retargetForKind(form.target, prev, k)
    applyKindDefaults()
    // A kind with no proxy support at all (gateway, host) cannot keep a pin: the
    // server would reject the save, and the picker is no longer shown to clear it by
    // hand. A pin that is merely now-incapable is LEFT in place so proxyProblemKey
    // can explain it — silently dropping the user's choice is worse than naming it.
    if (!showProxy.value) form.proxy_id = ''
  },
)

onMounted(loadAll)
</script>

<template>
  <main class="page config-page" aria-labelledby="monitor-form-title">
    <div class="page-head config-head">
      <h2 id="monitor-form-title">{{ isHostMode ? (editingId ? tr('mform.hostEditTitle') : tr('mform.hostNewTitle')) : (editingId ? tr('mform.editTitle') : tr('mform.newTitle')) }}</h2>
      <p class="sub">{{ isHostMode ? tr('mform.hostSub') : tr('mform.sub') }}</p>
    </div>
    <p v-if="error" class="err" role="alert">{{ error }}</p>

    <p v-if="notFound" class="hint">
      {{ tr('mform.notFound') }}
      <router-link to="/monitoring">{{ tr('mform.back') }}</router-link>
    </p>

    <template v-else>
      <div class="config-canvas">
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
          <!-- host: nothing to point at. A host anchor watches the whole machine
               of every Agent its monitor group covers, so what it watches is
               chosen in the system-status panel below, not here. -->
          <p class="hint tiny wide" v-if="isHostMode">{{ tr('mform.hostScopeHint') }}</p>
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
            <input v-else v-model="form.target" :placeholder="placeholderFor(form.kind)" :class="{ invalid: !!targetErrorKey }" @blur="normalizeTargetURL" />
            <small v-if="targetErrorText" class="field-err">{{ targetErrorText }}</small>
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
          <label class="field" v-if="form.kind !== 'host' && !isPingMode">
            <span>{{ tr('mform.timeout') }}</span>
            <input type="number" v-model.number="form.params!.timeout_ms" :placeholder="tr('monitoring.default')" />
          </label>
          <label class="field check">
            <input type="checkbox" v-model="form.enabled" /><span>{{ tr('mform.enabled') }}</span>
          </label>
        </div>
      </section>

      <!-- Advanced / per-type -->
      <section class="panel" v-if="form.kind === 'icmp' || form.kind === 'gateway' || form.kind === 'dns' || form.kind === 'tcp'">
        <div class="panel-head"><h3>{{ tr('mform.secAdvanced') }}</h3></div>
        <div class="form-grid">
          <template v-if="isPingMode">
            <!-- min/max mirror the server bounds (server-core/api/probevalidate.go)
                 so the browser blocks the obvious garbage before a round trip.
                 Placeholders are the real agent defaults for an empty field:
                 protocol/config.DefaultPingCount (5), the 13-byte "nettact-probe"
                 payload marker, DefaultPingEchoTimeout (1s), and the derived cycle
                 deadline max(interval, count×perEcho) = 10s at those defaults. -->
            <label class="field"><span>{{ tr('mform.packetCount') }}</span><input type="number" min="0" max="100" v-model.number="form.params!.packet_count" placeholder="5" /></label>
            <label class="field"><span>{{ tr('mform.packetSize') }}</span><input type="number" min="0" max="65500" v-model.number="form.params!.packet_size" placeholder="13" /></label>
            <label class="field"><span>{{ tr('mform.perPingTimeout') }}</span><input type="number" min="0" max="300000" v-model.number="form.params!.timeout_ms" placeholder="1000" /></label>
            <label class="field"><span>{{ tr('mform.globalTimeout') }}</span><input type="number" min="0" max="300000" v-model.number="form.params!.global_timeout_ms" placeholder="10000" /></label>
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
            <label class="field" v-if="dnsProto !== 'doh'"><span>{{ tr('mform.resolverPort') }}</span><input type="number" min="0" max="65535" v-model.number="form.params!.resolver_port" :placeholder="resolverPortPlaceholder" /></label>
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
          <label class="field"><span>{{ tr('mform.maxRedirects') }}</span><input type="number" min="-1" max="20" v-model.number="form.params!.max_redirects" placeholder="10" /></label>
          <label class="field" v-if="form.params!.keyword"><span>{{ tr('mform.maxResponseBytes') }}</span><input type="number" min="0" max="10485760" v-model.number="form.params!.max_response_bytes" placeholder="1024" /></label>
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

      <!-- Egress proxy: shown only for kinds a proxy can carry. It sits with the
           connection settings rather than after the detection panel, because it is
           part of HOW the probe runs, not of how a fault is confirmed. The dropdown
           offers only proxies whose transport can carry THIS kind; a pin the agent
           cannot honor fails the monitor closed rather than dialing directly, which
           is why an invalidated selection is explained, not silently dropped. -->
      <section class="panel" v-if="showProxy">
        <div class="panel-head"><h3>{{ tr('mform.secProxy') }}</h3></div>
        <p class="hint panel-hint">{{ tr('mform.proxyHint') }}</p>
        <div class="panel-body">
          <label class="field group-field">
            <span>{{ tr('mform.proxy') }}</span>
            <select v-model="form.proxy_id">
              <option value="">{{ tr('mform.proxyNone') }}</option>
              <option v-for="p in proxyOptions" :key="p.id" :value="p.id">
                {{ p.name }} · {{ tr(`proxies.type_${p.type}`) }}
              </option>
              <!-- Keep an invalidated selection visible so the inline explanation below
                   has something to point at; saving it is blocked. -->
              <option
                v-if="selectedProxy && !proxyOptions.some((p) => p.id === selectedProxy!.id)"
                :value="selectedProxy.id"
              >
                {{ selectedProxy.name }} · {{ tr(`proxies.type_${selectedProxy.type}`) }}
              </option>
            </select>
            <small v-if="proxyProblemKey" class="field-err">
              {{ tr(proxyProblemKey, { name: selectedProxy?.name ?? '' }) }}
            </small>
            <small v-else-if="proxyWarningKey" class="field-warn">
              {{ tr(proxyWarningKey, { name: selectedProxy?.name ?? '' }) }}
            </small>
          </label>
          <p class="hint tiny" v-if="!proxyOptions.length && !selectedProxy">
            {{ tr('mform.proxyNoneUsable') }}
            <router-link to="/proxies/new">{{ tr('mform.proxyCreate') }}</router-link>
          </p>
          <p class="hint tiny" v-else>
            {{ tr('mform.proxyManageHint') }}
            <router-link to="/proxies">{{ tr('mform.proxyManage') }}</router-link>
          </p>
          <p class="hint tiny" v-if="form.proxy_id && !proxyProblemKey">{{ tr('mform.proxyFailClosed') }}</p>
        </div>
      </section>


      <!-- Detection sensitivity is available for every supported
           probe type. Fault recording itself is not configurable: only the
           confirmation and recovery thresholds can be tuned. -->
      <section class="panel" v-if="showDetection">
        <div class="panel-head"><h3>{{ tr('mform.detectionTitle') }}</h3></div>
        <p class="hint panel-hint det-summary">
          {{ tr('mform.detectionSummary', { fail: detection.fail_rounds, recover: detection.recover_rounds }) }}
        </p>
        <!-- Smart detection sits OUTSIDE the advanced disclosure: it is a primary
             choice about what the product will tell you, not a tuning knob, and
             hiding it would mean nobody ever discovers it. -->
        <div class="panel-body smart-body">
          <label class="check-row">
            <input type="checkbox" v-model="detection.smart_enabled" />
            <span class="check-text">
              <strong>{{ tr('detection.smartTitle') }}</strong>
              <em class="hint tiny">{{ tr('detection.smartHint') }}</em>
            </span>
          </label>
          <template v-if="detection.smart_enabled">
            <div class="profile-list smart-list">
              <label v-for="s in SMART_LEVELS" :key="s" class="profile-opt">
                <input type="radio" :value="s" v-model="detection.smart_sensitivity" />
                <span class="profile-name">{{ tr(`detection.smart_${s}`) }}</span>
                <em class="profile-desc">{{ tr(`detection.smartDesc_${s}`) }}</em>
              </label>
            </div>
            <p class="hint tiny">{{ tr('detection.smartLearning') }}</p>
            <p class="hint tiny" v-if="smartLossYielded">{{ tr('detection.smartLossYielded') }}</p>
          </template>
        </div>
        <details class="advanced" :open="detectionOpen">
          <summary @click.prevent="detectionOpen = !detectionOpen">{{ tr('mform.detectionAdvanced') }}</summary>
          <div class="det-body">
            <p class="hint tiny">{{ tr('detection.hint') }}</p>
            <div class="profile-list">
              <label v-for="p in DETECTION_PROFILES" :key="p" class="profile-opt">
                <input type="radio" :value="p" v-model="detection.profile" @change="setProfile(p)" />
                <span class="profile-name">{{ tr(`detection.profile_${p}`) }}</span>
                <em class="profile-desc">{{ tr(`detection.profileDesc_${p}`) }}</em>
              </label>
            </div>
            <div class="form-grid det-grid" v-if="detection.profile === 'custom'">
              <label class="field">
                <span>{{ tr('detection.failRounds') }}</span>
                <input type="number" min="1" max="20" v-model.number="detection.fail_rounds" />
              </label>
              <label class="field">
                <span>{{ tr('detection.recoverRounds') }}</span>
                <input type="number" min="1" max="20" v-model.number="detection.recover_rounds" />
              </label>
            </div>
            <div class="form-grid det-grid" v-if="showLossThreshold">
              <label class="field">
                <span>{{ tr('detection.lossPct') }}</span>
                <input type="number" min="1" max="100" v-model.number="detection.icmp_loss_pct" />
                <small class="hint tiny">{{ tr('detection.lossHint') }}</small>
              </label>
            </div>
          </div>
        </details>
      </section>

      <!-- System-status detection: the whole of what a host anchor does. Every
           family is visible at once — this IS the editor, and an editor behind a
           disclosure is a feature nobody finds. -->
      <section class="panel" v-if="isHostMode">
        <div class="panel-head"><h3>{{ tr('mform.hostDet.title') }}</h3></div>
        <p class="hint panel-hint">{{ tr('mform.hostDet.intro') }}</p>
        <!-- Until the anchor's stored thresholds are in hand the panel is bound to
             the defaults, so editing it would edit values nobody chose and saving
             it would write them over the real ones. -->
        <p v-if="hostDetError" class="hint panel-hint err">{{ hostDetError }}</p>
        <p v-else-if="!hostDetReady" class="hint panel-hint">{{ tr('mform.hostDet.loading') }}</p>
        <div v-else class="panel-body host-det">
          <!-- CPU / memory: the same sentence with a different noun. -->
          <div v-for="fam in (['cpu', 'mem'] as const)" :key="fam" class="host-row">
            <label class="check-row">
              <input type="checkbox" v-model="hostDet[fam].enabled" />
              <span class="check-text"><strong>{{ tr(`mform.hostDet.${fam}Title`) }}</strong></span>
            </label>
            <p class="host-sentence" v-if="hostDet[fam].enabled">
              <span>{{ tr(`mform.hostDet.${fam}Lead`) }}</span>
              <select
                v-if="hostPresetMode(fam, 'pct', PCT_PRESETS)"
                :value="hostDet[fam].pct"
                @change="(e) => {
                  const v = (e.target as HTMLSelectElement).value
                  if (v === 'custom') hostSetCustom(fam, 'pct', true)
                  else hostDet[fam].pct = Number(v)
                }"
              >
                <option v-for="p in PCT_PRESETS" :key="p" :value="p">{{ p }}%</option>
                <option value="custom">{{ tr('mform.hostDet.custom') }}</option>
              </select>
              <span v-else class="host-custom">
                <input type="number" min="1" max="100" v-model.number="hostDet[fam].pct" /><span>%</span>
              </span>
              <span>{{ tr('mform.hostDet.forLead') }}</span>
              <select
                v-if="hostPresetMode(fam, 'duration_s', DURATION_PRESETS)"
                :value="hostDet[fam].duration_s"
                @change="(e) => {
                  const v = (e.target as HTMLSelectElement).value
                  if (v === 'custom') hostSetCustom(fam, 'duration_s', true)
                  else hostDet[fam].duration_s = Number(v)
                }"
              >
                <option v-for="d in DURATION_PRESETS" :key="d" :value="d">
                  {{ tr('mform.hostDet.minutes', { n: d / 60 }) }}
                </option>
                <option value="custom">{{ tr('mform.hostDet.custom') }}</option>
              </select>
              <span v-else class="host-custom">
                <input
                  type="number" min="0.5" max="60" step="0.5"
                  :value="hostDurationMinutes(fam)"
                  @input="(e) => setHostDurationMinutes(fam, Number((e.target as HTMLInputElement).value))"
                />
                <span>{{ tr('mform.hostDet.minutesUnit') }}</span>
              </span>
            </p>
          </div>

          <!-- Load is per core, so one setting reads correctly on any machine. -->
          <div class="host-row">
            <label class="check-row">
              <input type="checkbox" v-model="hostDet.load.enabled" />
              <span class="check-text">
                <strong>{{ tr('mform.hostDet.loadTitle') }}</strong>
                <em class="hint tiny">{{ tr('mform.hostDet.loadHint') }}</em>
              </span>
            </label>
            <p class="host-sentence" v-if="hostDet.load.enabled">
              <span>{{ tr('mform.hostDet.loadLead') }}</span>
              <select
                v-if="hostPresetMode('load', 'per_core', LOAD_PRESETS)"
                :value="hostDet.load.per_core"
                @change="(e) => {
                  const v = (e.target as HTMLSelectElement).value
                  if (v === 'custom') hostSetCustom('load', 'per_core', true)
                  else hostDet.load.per_core = Number(v)
                }"
              >
                <option v-for="p in LOAD_PRESETS" :key="p" :value="p">{{ p }}</option>
                <option value="custom">{{ tr('mform.hostDet.custom') }}</option>
              </select>
              <span v-else class="host-custom">
                <input type="number" min="0.1" max="100" step="0.1" v-model.number="hostDet.load.per_core" />
              </span>
              <span>{{ tr('mform.hostDet.loadPerCore') }}</span>
              <span>{{ tr('mform.hostDet.forLead') }}</span>
              <select
                v-if="hostPresetMode('load', 'duration_s', DURATION_PRESETS)"
                :value="hostDet.load.duration_s"
                @change="(e) => {
                  const v = (e.target as HTMLSelectElement).value
                  if (v === 'custom') hostSetCustom('load', 'duration_s', true)
                  else hostDet.load.duration_s = Number(v)
                }"
              >
                <option v-for="d in DURATION_PRESETS" :key="d" :value="d">
                  {{ tr('mform.hostDet.minutes', { n: d / 60 }) }}
                </option>
                <option value="custom">{{ tr('mform.hostDet.custom') }}</option>
              </select>
              <span v-else class="host-custom">
                <input
                  type="number" min="0.5" max="60" step="0.5"
                  :value="hostDurationMinutes('load')"
                  @input="(e) => setHostDurationMinutes('load', Number((e.target as HTMLInputElement).value))"
                />
                <span>{{ tr('mform.hostDet.minutesUnit') }}</span>
              </span>
            </p>
          </div>

          <!-- Disk covers every partition the Agent reports, judged one by one. -->
          <div class="host-row">
            <label class="check-row">
              <input type="checkbox" v-model="hostDet.disk.enabled" />
              <span class="check-text">
                <strong>{{ tr('mform.hostDet.diskTitle') }}</strong>
                <em class="hint tiny">{{ tr('mform.hostDet.diskHint') }}</em>
              </span>
            </label>
            <p class="host-sentence" v-if="hostDet.disk.enabled">
              <span>{{ tr('mform.hostDet.diskLead') }}</span>
              <select
                v-if="hostPresetMode('disk', 'pct', PCT_PRESETS)"
                :value="hostDet.disk.pct"
                @change="(e) => {
                  const v = (e.target as HTMLSelectElement).value
                  if (v === 'custom') hostSetCustom('disk', 'pct', true)
                  else hostDet.disk.pct = Number(v)
                }"
              >
                <option v-for="p in PCT_PRESETS" :key="p" :value="p">{{ p }}%</option>
                <option value="custom">{{ tr('mform.hostDet.custom') }}</option>
              </select>
              <span v-else class="host-custom">
                <input type="number" min="1" max="100" v-model.number="hostDet.disk.pct" /><span>%</span>
              </span>
            </p>
          </div>

          <!-- Network: off by default and free-numeric, because the right figure
               depends on a link speed nothing here can know. Blank = that
               direction is not watched. -->
          <div class="host-row">
            <label class="check-row">
              <input type="checkbox" v-model="hostDet.net.enabled" />
              <span class="check-text">
                <strong>{{ tr('mform.hostDet.netTitle') }}</strong>
                <em class="hint tiny">{{ tr('mform.hostDet.netHint') }}</em>
              </span>
            </label>
            <template v-if="hostDet.net.enabled">
              <div class="form-grid host-net-grid">
                <label class="field">
                  <span>{{ tr('mform.hostDet.netRx') }}</span>
                  <!-- text, not number: a number input coerces through v-model, and
                       "0" or "-5" would arrive here already indistinguishable from a
                       blank field — which is exactly the value this must preserve
                       until validation has had a look at it. -->
                  <input
                    type="text" inputmode="decimal" :placeholder="tr('mform.hostDet.netBlank')"
                    v-model="hostNetRaw.rx" :class="{ invalid: hostNetRawInvalid(hostNetRaw.rx) }"
                  />
                </label>
                <label class="field">
                  <span>{{ tr('mform.hostDet.netTx') }}</span>
                  <!-- text, not number: a number input coerces through v-model, and
                       "0" or "-5" would arrive here already indistinguishable from a
                       blank field — which is exactly the value this must preserve
                       until validation has had a look at it. -->
                  <input
                    type="text" inputmode="decimal" :placeholder="tr('mform.hostDet.netBlank')"
                    v-model="hostNetRaw.tx" :class="{ invalid: hostNetRawInvalid(hostNetRaw.tx) }"
                  />
                </label>
              </div>
              <p class="host-sentence">
                <span>{{ tr('mform.hostDet.forLead') }}</span>
                <select
                  v-if="hostPresetMode('net', 'duration_s', DURATION_PRESETS)"
                  :value="hostDet.net.duration_s"
                  @change="(e) => {
                    const v = (e.target as HTMLSelectElement).value
                    if (v === 'custom') hostSetCustom('net', 'duration_s', true)
                    else hostDet.net.duration_s = Number(v)
                  }"
                >
                  <option v-for="d in DURATION_PRESETS" :key="d" :value="d">
                    {{ tr('mform.hostDet.minutes', { n: d / 60 }) }}
                  </option>
                  <option value="custom">{{ tr('mform.hostDet.custom') }}</option>
                </select>
                <span v-else class="host-custom">
                  <input
                    type="number" min="0.5" max="60" step="0.5"
                    :value="hostDurationMinutes('net')"
                    @input="(e) => setHostDurationMinutes('net', Number((e.target as HTMLInputElement).value))"
                  />
                  <span>{{ tr('mform.hostDet.minutesUnit') }}</span>
                </span>
              </p>
            </template>
          </div>

          <p class="hint tiny" v-if="!hostEnabledFamilies.length">{{ tr('mform.hostDet.allOff') }}</p>
        </div>
      </section>

      <!-- Monitor group is the final settings panel for every target type. A
           target belongs to exactly one group, which owns the Agent execution
           scope and incident-merge policy shared by all its targets. -->
      <section class="panel">
        <div class="panel-head"><h3>{{ tr('mform.secGroup') }}</h3></div>
        <p class="hint panel-hint">{{ tr('mform.groupHint') }}</p>
        <div class="panel-body">
          <label class="field group-field">
            <span>{{ tr('mform.monitorGroup') }}</span>
            <select v-model="form.group_id">
              <option value="" disabled>{{ tr('mform.groupPick') }}</option>
              <option v-for="g in groups" :key="g.id" :value="g.id">
                {{ g.name }}<template v-if="g.is_default"> · {{ tr('monitoring.defaultTag') }}</template>
              </option>
            </select>
          </label>
          <p class="hint tiny">
            {{ tr('mform.groupManageHint') }}
            <router-link to="/monitoring/groups/new">{{ tr('mform.groupCreate') }}</router-link>
          </p>
        </div>
      </section>

      <div class="form-foot">
        <router-link to="/monitoring" class="btn">{{ tr('mform.cancel') }}</router-link>
        <button class="btn btn-primary" :disabled="busy || !loaded" @click="save">{{ busy ? tr('mform.saving') : tr('mform.save') }}</button>
        <span v-if="saved" class="ok">{{ tr('mform.saved') }}</span>
      </div>

      <p v-if="saved && showDetection" class="hint saved-note" role="status" aria-live="polite">
        {{ tr('mform.savedDetectionOn', { fail: detection.fail_rounds, recover: detection.recover_rounds }) }}
        <template v-if="!hasChannels"> {{ tr('mform.savedNoChannels') }}</template>
      </p>

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
      </div>

    </template>
  </main>
</template>

<style scoped>
/* Hallmark · designed-as-app · design-system: design.md · page: Monitor form */
.config-canvas {
  width: 100%;
}
.config-head h2 {
  font-family: var(--font-display);
  letter-spacing: -0.028em;
}
.save-warn {
  margin-top: var(--space-sm);
  padding: var(--space-sm);
  border-color: var(--color-warning);
  background: var(--color-glass-subtle);
  box-shadow: none;
}
/* Shape error on the target field: the value can never probe successfully. */
.field input.invalid {
  border-color: var(--color-danger);
}
.field-err {
  margin-top: 4px;
  color: var(--color-danger-text);
  font-size: 11.5px;
}
/* A warning the save does not block — visually distinct from .field-err so a
   disabled-but-valid proxy pin does not read as an error. */
.field-warn {
  margin-top: 4px;
  color: var(--color-warning-text);
  font-size: 11.5px;
}
.save-warn h4 {
  margin: 0 0 4px;
  font-size: 14px;
}
.warn-list {
  margin: 8px 0 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.warn-list li {
  display: flex;
  gap: 10px;
  align-items: baseline;
  flex-wrap: wrap;
  font-size: 13px;
}
.warn-agent {
  font-weight: 600;
  color: var(--text);
}
.warn-state {
  color: var(--color-danger-text);
  font-size: 12px;
}
.warn-perms {
  color: var(--text-dim);
  font-size: 12px;
}
.warn-capable {
  margin: 10px 0 0;
  font-size: 12.5px;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: baseline;
}
.warn-capable-label {
  font-weight: 600;
  color: var(--text);
}
.warn-capable-names {
  color: var(--text-dim);
}
.host-intro {
  margin: 0 0 var(--space-sm);
  padding: var(--space-xs) var(--space-sm);
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--color-ink-2);
  background: var(--color-glass-subtle);
  border: var(--rule-hair) solid var(--color-rule);
  border-radius: var(--radius-input);
}
.panel {
  margin-bottom: var(--space-md);
  background: var(--color-glass);
  border-color: var(--color-rule);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-card);
  backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
}
.panel-head {
  min-height: 52px;
  border-bottom-color: var(--color-rule);
}
.panel-head h3 {
  font-family: var(--font-display);
  letter-spacing: -0.018em;
}
.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px 18px;
  padding: 14px 18px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  color: var(--text-dim);
}
.form-grid > .wide {
  grid-column: 1 / -1;
}
.field.check {
  flex-direction: row;
  align-items: center;
  gap: 8px;
}
.group-field {
  max-width: 420px;
}
.group-field select {
  width: 100%;
}
.inline-check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
  font-size: 12.5px;
  color: var(--text-dim);
}
.inline-check input {
  width: auto;
}
.field input[type='text'],
.field input:not([type]),
.field input[type='number'],
.field select,
.field textarea {
  width: 100%;
}
.field textarea {
  resize: vertical;
  font-family: inherit;
}
.panel-hint {
  margin: 0 18px 6px;
  padding-top: 8px;
}
.panel-body {
  padding: 8px 18px 16px;
}
.det-summary {
  padding-bottom: 8px;
  color: var(--text);
}
.smart-body {
  padding-top: 0;
  padding-bottom: 12px;
}
.check-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  min-height: 44px;
  font-size: 13px;
  color: var(--text);
}
.check-row input {
  width: auto;
  margin-top: 3px;
}
.check-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.check-text em {
  font-style: normal;
}
.smart-list {
  margin-top: 2px;
  padding-inline-start: 22px;
}
/* System-status rows. Each is a toggle plus a sentence that wraps as a sentence
   does, so a narrow window breaks between words rather than clipping a control. */
.host-det {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-top: 4px;
  padding-bottom: 14px;
}
.host-row + .host-row {
  border-top: 1px solid var(--border);
  padding-top: 6px;
}
.host-sentence {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin: 0 0 8px;
  padding-inline-start: 22px;
  font-size: 13px;
  color: var(--text);
}
.host-sentence select {
  width: auto;
  min-width: 92px;
}
.host-custom {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.host-custom input {
  width: 88px;
}
.host-net-grid {
  padding: 2px 0 0 22px;
}
.advanced {
  border-top: 1px solid var(--border);
}
.advanced summary {
  cursor: pointer;
  padding: 10px 18px;
  min-height: 44px;
  font-size: 13px;
  color: var(--color-ink-2);
  user-select: none;
}
.advanced summary:focus-visible,
.profile-opt:has(input:focus-visible) {
  outline: var(--rule-fine) solid var(--color-focus);
  outline-offset: var(--space-3xs);
}
.det-body {
  padding: 4px 18px 16px;
}
.det-grid {
  padding: 12px 0 0;
}
.profile-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 10px;
}
.profile-opt {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 13px;
  color: var(--text);
  min-height: 44px;
  padding-inline: var(--space-2xs);
  border-radius: var(--radius-xs);
}
.profile-opt input {
  width: auto;
}
.profile-name {
  font-weight: 600;
}
.profile-desc {
  font-style: normal;
  font-size: 11.5px;
  color: var(--text-dim);
}
.saved-note {
  margin: -12px 0 18px;
  font-size: 12.5px;
}
.tiny {
  font-size: 11.5px;
  margin: 4px 0 0;
}
.form-foot {
  display: flex;
  align-items: center;
  gap: 12px;
  position: sticky;
  bottom: var(--space-sm);
  z-index: var(--z-sticky);
  margin: var(--space-sm) 0 var(--space-md);
  padding: var(--space-xs);
  border: var(--rule-hair) solid var(--color-rule);
  border-radius: var(--radius-card);
  background: var(--color-glass-strong);
  box-shadow: var(--shadow-float);
  backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
}

@media (max-width: 768px) {
  .form-grid,
  .det-grid {
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-sm);
  }
  .form-grid > .wide {
    grid-column: auto;
  }
  .panel-head,
  .form-grid,
  .panel-body,
  .det-body {
    padding-inline: var(--space-sm);
  }
  .panel-hint {
    margin-inline: var(--space-sm);
  }
  .form-foot {
    position: static;
  }
}

@media (max-width: 414px) {
  .form-foot {
    align-items: stretch;
    flex-direction: column;
  }
  .form-foot .btn {
    width: 100%;
  }
  .group-field {
    max-width: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .form-foot {
    transition-duration: var(--dur-micro);
  }
}
</style>

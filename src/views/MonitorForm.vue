<script setup lang="ts">
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { api, type ProbeTarget, type ProbeParams, type MonitorGroup, type RuleCleanup, type SaveWarning } from '../api'
import ComboInput from '../components/ComboInput.vue'
import { useMetricMeta } from '../composables/useMetricMeta'
import { LEADING_SCHEME, paramsRangeError, retargetForKind, targetError } from '../lib/targetValidation'

const { t: tr } = useI18n()
const { metricLabel } = useMetricMeta()
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
const hostSubject = computed<'whole' | 'disk' | 'wifi'>({
  get: () => (form.target === 'host' ? 'whole' : form.target === '*' ? 'wifi' : 'disk'),
  set: (v) => {
    form.target = v === 'whole' ? 'host' : v === 'wifi' ? '*' : ''
  },
})
const headersText = ref('')
const error = ref('')
const saved = ref(false)
const busy = ref(false)
// Save warnings for THIS monitor: in-scope agents that cannot run it under their
// current permission policy (per-agent, from the set-targets response).
const saveWarning = ref<SaveWarning | null>(null)
// Alert conditions this save dropped because the monitor's kind changed. Until
// they are reconfigured the monitor probes something no alarm watches, so this is
// shown as prominently as the permission warning above.
const ruleCleanups = ref<RuleCleanup[]>([])
const notFound = ref(false)
// Guards a destructive save: setTargets is a full reconcile, so saving before the
// existing target list has loaded would delete every other monitor.
const loaded = ref(false)

function blank(): ProbeTarget {
  return { group_id: '', kind: 'icmp', name: '', target: '', params: {}, enabled: true }
}

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

// The monitor-type labels live on the kind <select> (mform.typeIcmp, …); reuse
// them so a report about a kind change names the same words the user picked.
function kindLabel(kind: string): string {
  return kind ? tr(`mform.type${kind.charAt(0).toUpperCase()}${kind.slice(1)}`) : kind
}

function placeholderFor(kind: string): string {
  if (kind === 'dns') return 'example.com'
  if (kind === 'http') return 'https://example.com'
  if (kind === 'tcp') return 'example.com'
  if (kind === 'nat') return 'stun.example.com'
  return '1.1.1.1'
}

async function loadAll() {
  try {
    ;[all.value, groups.value] = await Promise.all([api.listTargets(SITE), api.monitorGroups(SITE)])
  } catch (e) {
    // Leave loaded=false so Save stays disabled — reconciling against an empty
    // list would wipe every existing monitor.
    error.value = String((e as Error).message || e)
    return
  }
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
  busy.value = true
  saved.value = false
  error.value = ''
  saveWarning.value = null
  ruleCleanups.value = []
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
    // The save has landed and those alert conditions are already deleted server
    // side, so publish that BEFORE the reload below — which can fail and jump to
    // catch. Re-saving would report nothing (the conditions are gone), so a lost
    // notice is lost for good. Only an existing monitor can have had conditions
    // invalidated, and its id is known here; a create has none to report.
    ruleCleanups.value = (res.rule_cleanups ?? []).filter((c) => c.monitor_id === form.id)
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
    // Two save-time findings are actionable for THIS monitor: which in-scope
    // agents cannot run it and why, and which of its alert conditions this save
    // had to drop because the monitor's kind changed. Either one keeps the form
    // open so the user sees it; a clean save goes straight back to the list.
    const warning = res.warnings.find((wgn) => wgn.monitor_id === form.id) ?? null
    if (!warning && !ruleCleanups.value.length) {
      router.push('/monitoring')
      return
    }
    saveWarning.value = warning
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
  },
)

onMounted(loadAll)
</script>

<template>
  <main class="page">
    <div class="page-head">
      <h2>{{ isHostMode ? (editingId ? tr('mform.hostEditTitle') : tr('mform.hostNewTitle')) : (editingId ? tr('mform.editTitle') : tr('mform.newTitle')) }}</h2>
      <p class="sub">{{ isHostMode ? tr('mform.hostSub') : tr('mform.sub') }}</p>
    </div>
    <p v-if="error" class="err">{{ error }}</p>

    <p v-if="notFound" class="hint">
      {{ tr('mform.notFound') }}
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
              <select v-model="hostSubject">
                <option value="whole">{{ tr('mform.hostSubjectWhole') }}</option>
                <option value="disk">{{ tr('mform.hostSubjectDisk') }}</option>
                <option value="wifi">{{ tr('mform.hostSubjectWifi') }}</option>
              </select>
            </label>
            <label class="field" v-if="hostSubject === 'disk'">
              <span>{{ tr('mform.hostMountLabel') }}</span>
              <input v-model="form.target" :placeholder="tr('mform.hostMountPlaceholder')" />
            </label>
            <p class="hint tiny wide" v-if="hostSubject === 'disk'">{{ tr('mform.hostMountHint') }}</p>
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
          <label class="field" v-if="form.kind !== 'host'">
            <span>{{ tr('mform.timeout') }}</span>
            <input type="number" v-model.number="form.params!.timeout_ms" :placeholder="tr('monitoring.default')" />
          </label>
          <label class="field check">
            <input type="checkbox" v-model="form.enabled" /><span>{{ tr('mform.enabled') }}</span>
          </label>
        </div>
      </section>

      <!-- Monitor group: a target belongs to exactly one. The group owns the Agent
           execution scope and incident-merge policy shared by all its targets. -->
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

      <!-- Advanced / per-type -->
      <section class="panel" v-if="form.kind === 'icmp' || form.kind === 'gateway' || form.kind === 'dns' || form.kind === 'tcp'">
        <div class="panel-head"><h3>{{ tr('mform.secAdvanced') }}</h3></div>
        <div class="form-grid">
          <template v-if="form.kind === 'icmp' || form.kind === 'gateway'">
            <!-- min/max mirror the server bounds (server-core/api/probevalidate.go)
                 so the browser blocks the obvious garbage before a round trip. -->
            <label class="field"><span>{{ tr('mform.packetCount') }}</span><input type="number" min="0" max="100" v-model.number="form.params!.packet_count" placeholder="3" /></label>
            <label class="field"><span>{{ tr('mform.packetSize') }}</span><input type="number" min="0" max="65500" v-model.number="form.params!.packet_size" placeholder="56" /></label>
            <label class="field"><span>{{ tr('mform.perPingTimeout') }}</span><input type="number" min="0" max="300000" v-model.number="form.params!.timeout_ms" placeholder="2000" /></label>
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

      <!-- Alert conditions dropped by a monitor-type change. Until they are
           rebuilt this monitor can fail indefinitely without raising anything. -->
      <div v-if="ruleCleanups.length" class="card save-warn rule-cleanup">
        <h4>{{ tr('mform.ruleCleanupTitle') }}</h4>
        <p class="hint">
          {{ tr('mform.ruleCleanupIntro', {
            from: kindLabel(ruleCleanups[0].old_kind),
            to: kindLabel(ruleCleanups[0].new_kind),
          }) }}
        </p>
        <ul class="warn-list">
          <li v-for="c in ruleCleanups" :key="c.rule_id">
            <span class="warn-agent">{{ c.rule_name }}</span>
            <span v-if="c.rule_deleted" class="warn-state">{{ tr('mform.ruleCleanupRuleDeleted') }}</span>
            <span class="warn-perms mono">{{ c.metrics.map((m) => metricLabel(m)).join('、') }}</span>
          </li>
        </ul>
        <p class="warn-capable">
          <router-link :to="`/monitoring/groups/${form.group_id}/edit`">{{ tr('mform.ruleCleanupAction') }}</router-link>
        </p>
      </div>
    </template>
  </main>
</template>

<style scoped>
.page {
  max-width: 860px;
}
.save-warn {
  margin-top: 14px;
  padding: 14px 16px;
  border-left: 3px solid var(--warning, #fbbf24);
}
/* Shape error on the target field: the value can never probe successfully. */
.field input.invalid {
  border-color: var(--danger, #f87171);
}
.field-err {
  margin-top: 4px;
  color: var(--danger, #f87171);
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
  color: #fca5a5;
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
.panel {
  margin-bottom: 18px;
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
.field.wide {
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
.tiny {
  font-size: 11.5px;
  margin: 4px 0 0;
}
.form-foot {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 4px 0 20px;
}
</style>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { api, type Quota, type Channel, type ServerInfo, type StorageStats } from '../api'
import WebhookChannelForm from '../components/WebhookChannelForm.vue'
import DataCleanup from '../components/DataCleanup.vue'

const { t } = useI18n()
const router = useRouter()

// Secondary navigation: the page grew too dense for one scroll, so its panels are
// split across underline tabs (same pattern as Processes.vue). All tab bodies stay
// mounted (v-show) so their one-shot on-mount loads/state persist across switches.
const tab = ref<'general' | 'notifications' | 'data'>('general')

const quota = ref<Quota | null>(null)
const stats = ref<StorageStats | null>(null)
const serverInfo = ref<ServerInfo | null>(null)
const error = ref('')

const channels = ref<Channel[]>([])
// 通知渠道按类型添加：先选类型，再展示对应表单。新增类型时在此登记即可。
// 「系统通知」仅当 server 运行于 Windows/macOS（native_notify）时才提供。
const CHANNEL_TYPES = computed(() => {
  const types = [
    { value: 'webhook', label: 'Webhook' },
    { value: 'email', label: 'Email' },
  ]
  if (serverInfo.value?.native_notify) {
    types.push({ value: 'system', label: t('settings.sysNotify') })
  }
  return types
})
const addType = ref('webhook')
// 通知渠道语言：决定该渠道推送的告警文案用中文还是英文（服务端在投递时渲染）。
const LANGS = [
  { value: 'zh', label: '中文' },
  { value: 'en', label: 'English' },
]
const email = reactive({ name: '', host: '', port: '587', from: '', to: '', username: '', password: '', lang: 'zh' })
// Webhook add/edit is delegated to WebhookChannelForm; editingId marks which
// existing channel row is expanded for editing ('' = none).
const editingId = ref('')
const system = reactive({ name: '', lang: 'zh' })

// 控制台地址：通知里深链回本事故详情页的基础 URL（如 http://localhost:12450）。
const consoleUrl = ref('')
const consoleSaved = ref(false)

// 监听地址（SETTINGS-001）：仅本机 / 局域网两种模式 + 端口，保存到 listen_addr。
// desktop 保存后立即重启内嵌 server；standalone 下次启动生效（显示待生效徽标）。
const listen = reactive({ mode: 'loopback' as 'loopback' | 'all', port: 12450 })
const listenError = ref('')
const listenSaved = ref<'' | 'pending' | 'restarting'>('')
const listenNewUrl = ref('')
const listenStatus = computed(() => serverInfo.value?.listen ?? null)

function parseListenAddr(addr: string): { mode: 'loopback' | 'all'; port: number } | null {
  const i = addr.lastIndexOf(':')
  if (i < 0) return null
  const host = addr.slice(0, i)
  const port = parseInt(addr.slice(i + 1), 10)
  if (!Number.isFinite(port)) return null
  return { mode: host === '0.0.0.0' ? 'all' : 'loopback', port }
}

function populateListen() {
  const ls = listenStatus.value
  if (!ls) return
  const parsed = parseListenAddr(ls.pending_addr || ls.effective_addr)
  if (parsed) {
    listen.mode = parsed.mode
    listen.port = parsed.port
  }
}

async function saveListen() {
  listenError.value = ''
  listenSaved.value = ''
  listenNewUrl.value = ''
  if (!Number.isInteger(listen.port) || listen.port < 1 || listen.port > 65535) {
    listenError.value = t('settings.listen.portRangeErr')
    return
  }
  const host = listen.mode === 'all' ? '0.0.0.0' : '127.0.0.1'
  try {
    const resp = await api.updateSettings({ listen_addr: `${host}:${listen.port}` })
    if (resp.listen_effect === 'restarting') {
      // 当前 origin 即将失效——在重启前的窗口内给出新地址（desktop 恒为回环）。
      listenNewUrl.value = `http://127.0.0.1:${listen.port}`
      listenSaved.value = 'restarting'
    } else if (resp.listen_effect === 'pending') {
      listenSaved.value = 'pending'
      await load()
    } else {
      listenSaved.value = 'pending'
    }
  } catch (e) {
    listenError.value = String((e as Error).message || e)
  }
}

// Incident-evidence (INCIDENT-002) and path-diagnostic (DIAG-001) tuning, backed
// by the flat settings API. Bounds mirror the server's validated ranges; time and
// size fields are presented in friendly units and converted on save. There is
// deliberately no cooldown / freshness / queue-grace / cross-fault reuse knob —
// diagnostic report reuse is governed by alert lifecycles, not a timer.
const diag = reactive({
  snapshotDeadlineS: 10, // incident_snapshot_deadline_ms / 1000
  snapshotMaxKiB: 256, // incident_snapshot_max_bytes / 1024
  diagEnabled: true, // diag_enabled
  totalTimeoutS: 120, // diag_total_timeout_ms / 1000
  maxHops: 30, // diag_max_hops
  attempts: 3, // diag_attempts_per_hop
  agentConc: 4, // diag_agent_concurrency
  globalConc: 16, // diag_global_concurrency
  resolveHops: false, // diag_resolve_hops
  retentionDays: 30, // evidence_retention_days
})
// [min, max] in the presented unit, mirroring server-core settings.IntKeys.
const BOUNDS: Record<string, [number, number]> = {
  snapshotDeadlineS: [1, 60],
  snapshotMaxKiB: [64, 1024],
  totalTimeoutS: [5, 120],
  maxHops: [1, 64],
  attempts: [1, 5],
  agentConc: [1, 16],
  globalConc: [1, 64],
  retentionDays: [1, 365],
}
const diagSaved = ref(false)
const diagError = ref('')

function populateDiag(s: Record<string, string>) {
  const num = (k: string, def: number) => {
    const v = parseInt(s[k] ?? '', 10)
    return Number.isFinite(v) ? v : def
  }
  diag.snapshotDeadlineS = Math.round(num('incident_snapshot_deadline_ms', 10000) / 1000)
  diag.snapshotMaxKiB = Math.round(num('incident_snapshot_max_bytes', 262144) / 1024)
  diag.diagEnabled = num('diag_enabled', 1) !== 0
  diag.totalTimeoutS = Math.round(num('diag_total_timeout_ms', 120000) / 1000)
  diag.maxHops = num('diag_max_hops', 30)
  diag.attempts = num('diag_attempts_per_hop', 3)
  diag.agentConc = num('diag_agent_concurrency', 4)
  diag.globalConc = num('diag_global_concurrency', 16)
  diag.resolveHops = num('diag_resolve_hops', 0) !== 0
  diag.retentionDays = num('evidence_retention_days', 30)
}
function diagInRange(): boolean {
  return Object.entries(BOUNDS).every(([k, [min, max]]) => {
    const v = (diag as unknown as Record<string, number>)[k]
    return Number.isFinite(v) && v >= min && v <= max
  })
}
async function saveDiag() {
  diagError.value = ''
  if (!diagInRange()) {
    diagError.value = t('settings.diag.rangeErr')
    return
  }
  try {
    await api.updateSettings({
      incident_snapshot_deadline_ms: String(diag.snapshotDeadlineS * 1000),
      incident_snapshot_max_bytes: String(diag.snapshotMaxKiB * 1024),
      diag_enabled: diag.diagEnabled ? '1' : '0',
      diag_total_timeout_ms: String(diag.totalTimeoutS * 1000),
      diag_max_hops: String(diag.maxHops),
      diag_attempts_per_hop: String(diag.attempts),
      diag_agent_concurrency: String(diag.agentConc),
      diag_global_concurrency: String(diag.globalConc),
      diag_resolve_hops: diag.resolveHops ? '1' : '0',
      evidence_retention_days: String(diag.retentionDays),
    })
    diagSaved.value = true
    setTimeout(() => (diagSaved.value = false), 2000)
  } catch (e) {
    diagError.value = String((e as Error).message || e)
  }
}

// Agent connectivity alerts (AGENT-002): enable + grace/recovery/stale timings +
// severity + which channels the offline/recovery notifications go to.
const agentAlert = reactive({
  enabled: true,
  graceS: 60, // agent_alert_grace_seconds
  recoverS: 30, // agent_alert_recover_seconds
  staleS: 120, // agent_status_stale_seconds
  severity: '', // agent_alert_severity ('' = warn)
  channelIds: [] as string[], // agent_alert_channel_ids ([] = all enabled)
})
const AGENT_ALERT_BOUNDS: Record<string, [number, number]> = {
  graceS: [15, 3600],
  recoverS: [5, 600],
  staleS: [30, 3600],
}
const AGENT_SEVERITIES = ['', 'info', 'warn', 'error', 'critical']
const agentAlertSaved = ref(false)
const agentAlertError = ref('')

function populateAgentAlert(s: Record<string, string>) {
  const num = (k: string, def: number) => {
    const v = parseInt(s[k] ?? '', 10)
    return Number.isFinite(v) ? v : def
  }
  agentAlert.enabled = num('agent_alert_enabled', 1) !== 0
  agentAlert.graceS = num('agent_alert_grace_seconds', 60)
  agentAlert.recoverS = num('agent_alert_recover_seconds', 30)
  agentAlert.staleS = num('agent_status_stale_seconds', 120)
  agentAlert.severity = s['agent_alert_severity'] ?? ''
  try {
    const ids = JSON.parse(s['agent_alert_channel_ids'] || '[]')
    agentAlert.channelIds = Array.isArray(ids) ? ids : []
  } catch {
    agentAlert.channelIds = []
  }
}
function toggleAlertChannel(id: string) {
  const i = agentAlert.channelIds.indexOf(id)
  if (i >= 0) agentAlert.channelIds.splice(i, 1)
  else agentAlert.channelIds.push(id)
}
async function saveAgentAlert() {
  agentAlertError.value = ''
  const inRange = Object.entries(AGENT_ALERT_BOUNDS).every(([k, [min, max]]) => {
    const v = (agentAlert as unknown as Record<string, number>)[k]
    return Number.isFinite(v) && v >= min && v <= max
  })
  if (!inRange) {
    agentAlertError.value = t('settings.agentAlert.rangeErr')
    return
  }
  try {
    await api.updateSettings({
      agent_alert_enabled: agentAlert.enabled ? '1' : '0',
      agent_alert_grace_seconds: String(agentAlert.graceS),
      agent_alert_recover_seconds: String(agentAlert.recoverS),
      agent_status_stale_seconds: String(agentAlert.staleS),
      agent_alert_severity: agentAlert.severity,
      agent_alert_channel_ids: JSON.stringify(agentAlert.channelIds),
    })
    agentAlertSaved.value = true
    setTimeout(() => (agentAlertSaved.value = false), 2000)
  } catch (e) {
    agentAlertError.value = String((e as Error).message || e)
  }
}

async function load() {
  try {
    const [q, s, ch, si, settings] = await Promise.all([
      api.quota(), api.stats(), api.channels(), api.serverInfo(), api.settings(),
    ])
    quota.value = q
    stats.value = s
    channels.value = ch
    serverInfo.value = si
    // Prefill with the current origin when unset, so the field always shows a
    // concrete, saveable value instead of only the placeholder (which looks like
    // a value but saves empty). Entering the console also auto-sets it (see auth).
    consoleUrl.value = settings['console_base_url'] || window.location.origin
    populateDiag(settings)
    populateAgentAlert(settings)
    populateListen()
  } catch (e) {
    error.value = String((e as Error).message || e)
  }
}
async function saveConsoleUrl() {
  try {
    await api.updateSettings({ console_base_url: consoleUrl.value.trim() })
    consoleSaved.value = true
    setTimeout(() => (consoleSaved.value = false), 2000)
  } catch (e) {
    error.value = String((e as Error).message || e)
  }
}
// WebhookChannelForm performs the create/update itself (so it can surface
// failures inline); the parent only closes the editor and refreshes the list.
async function onWebhookSaved() {
  editingId.value = ''
  await load()
}
// Apply a channel to every alert rule at once. Confirmed because it edits all rules.
const applyingId = ref('')
const applyMsg = ref('')
async function applyChannelToAll(c: Channel) {
  if (!confirm(t('settings.applyAll.confirm', { name: c.name || c.type }))) return
  applyingId.value = c.id
  applyMsg.value = ''
  try {
    const r = await api.applyChannelToAll(c.id)
    applyMsg.value = t('settings.applyAll.done', { count: r.updated })
  } catch (e) {
    error.value = String((e as Error).message || e)
  } finally {
    applyingId.value = ''
  }
}
async function addEmail() {
  if (!email.host || !email.from || !email.to) return
  const { name, ...cfg } = email
  await api.createChannel(name || 'Email', 'email', { ...cfg })
  await load()
}
async function addSystem() {
  await api.createChannel(system.name || 'System', 'system', { lang: system.lang })
  system.name = ''
  await load()
}
async function toggleChannel(c: Channel) {
  await api.updateChannel(c.id, { name: c.name, enabled: !c.enabled })
  await load()
}
async function renameChannel(c: Channel) {
  await api.updateChannel(c.id, { name: c.name, enabled: c.enabled })
}
async function removeChannel(id: string) {
  await api.deleteChannel(id)
  await load()
}
// Config summary shown in the channel table's Config column.
function channelConfigLabel(c: Channel): string {
  if (c.type === 'webhook') return `${c.config.method || 'POST'} ${c.config.url || ''}`.trim()
  if (c.type === 'system') return t('settings.sysNotifyConfig')
  return `${c.config.from} → ${c.config.to} @ ${c.config.host}`
}
onMounted(load)
</script>

<template>
  <main class="page">
    <div class="page-head">
      <h2>{{ t('settings.title') }}</h2>
      <p class="sub">{{ t('settings.sub') }}</p>
    </div>

    <div class="tabs" role="tablist">
      <button
        class="tab" role="tab"
        :class="{ active: tab === 'general' }" :aria-selected="tab === 'general'"
        @click="tab = 'general'"
      >
        {{ t('settings.tabs.general') }}
      </button>
      <button
        class="tab" role="tab"
        :class="{ active: tab === 'notifications' }" :aria-selected="tab === 'notifications'"
        @click="tab = 'notifications'"
      >
        {{ t('settings.tabs.notifications') }}
        <span class="count">{{ channels.length }}</span>
      </button>
      <button
        class="tab" role="tab"
        :class="{ active: tab === 'data' }" :aria-selected="tab === 'data'"
        @click="tab = 'data'"
      >
        {{ t('settings.tabs.data') }}
      </button>
    </div>

    <p v-if="error" class="err">{{ error }}</p>

    <div v-show="tab === 'general'">
    <section class="panel">
      <div class="panel-head"><h3>{{ t('setup.settingsTitle') }}</h3></div>
      <div class="panel-body">
        <p class="hint">{{ t('setup.settingsHint') }}</p>
        <div class="row field-row">
          <button class="btn btn-primary" @click="router.push('/onboarding')">{{ t('setup.settingsReopen') }}</button>
        </div>
      </div>
    </section>

    <section class="panel">
      <div class="panel-head"><h3>{{ t('settings.consoleUrl') }}</h3></div>
      <div class="panel-body">
        <p class="hint">{{ t('settings.consoleUrlHint') }}</p>
        <div class="row field-row">
          <input v-model="consoleUrl" placeholder="http://localhost:12450" class="wide" />
          <button class="btn btn-primary" @click="saveConsoleUrl">{{ t('common.save') }}</button>
          <span v-if="consoleSaved" class="hint saved">✓ {{ t('common.saved') }}</span>
        </div>
      </div>
    </section>

    <section class="panel" v-if="listenStatus">
      <div class="panel-head"><h3>{{ t('settings.listen.title') }}</h3></div>
      <div class="panel-body">
        <p class="hint">{{ t('settings.listen.hint') }}</p>
        <p class="hint listen-status">
          {{ t('settings.listen.effective') }}: <span class="mono">{{ listenStatus.effective_addr }}</span>
          <span v-if="listenStatus.pending_addr" class="badge pending-badge">
            {{ listenStatus.pending_addr }} — {{ t('settings.listen.pendingBadge') }}
          </span>
        </p>
        <p v-if="listenStatus.fallback_from" class="warn-box">
          {{ t('settings.listen.fallbackWarn', { addr: listenStatus.fallback_from }) }}
        </p>
        <p v-if="listenStatus.overrides_flag" class="hint">{{ t('settings.listen.overridesFlag') }}</p>
        <div class="listen-modes">
          <label class="toggle-row">
            <input type="radio" value="loopback" v-model="listen.mode" />
            <span>{{ t('settings.listen.loopback') }}</span>
          </label>
          <label class="toggle-row">
            <input type="radio" value="all" v-model="listen.mode" />
            <span>{{ t('settings.listen.all') }}</span>
          </label>
        </div>
        <div v-if="listen.mode === 'all'" class="warn-box">
          {{ t('settings.listen.lanWarning') }}
          <template v-if="listenStatus.desktop"> {{ t('settings.listen.lanWarningDesktop') }}</template>
        </div>
        <div class="row field-row">
          <label class="knob-label">{{ t('settings.listen.port') }}</label>
          <input type="number" v-model.number="listen.port" min="1" max="65535" step="1" class="port-in" />
          <button class="btn btn-primary" @click="saveListen">{{ t('common.save') }}</button>
        </div>
        <p v-if="listen.port < 1024 && serverInfo && serverInfo.os !== 'windows'" class="hint">
          {{ t('settings.listen.lowPortHint') }}
        </p>
        <p v-if="listenSaved === 'pending'" class="hint saved">✓ {{ t('settings.listen.pendingSaved') }}</p>
        <p v-if="listenSaved === 'restarting'" class="hint saved">
          ✓ {{ t('settings.listen.restarting') }}
          <a :href="listenNewUrl" class="mono">{{ listenNewUrl }}</a>
        </p>
        <p v-if="listenError" class="err inline">{{ listenError }}</p>
      </div>
    </section>

    <section class="panel">
      <div class="panel-head"><h3>{{ t('settings.evidence.title') }}</h3></div>
      <div class="panel-body">
        <p class="hint">{{ t('settings.evidence.hint') }}</p>
        <div class="knob-grid">
          <label class="knob">
            <span class="knob-label">{{ t('settings.evidence.snapshotDeadline') }}</span>
            <span class="knob-input">
              <input type="number" v-model.number="diag.snapshotDeadlineS" min="1" max="60" step="1" />
              <span class="unit">{{ t('settings.unit.seconds') }}</span>
            </span>
            <span class="knob-help hint">{{ t('settings.evidence.snapshotDeadlineHelp') }}</span>
          </label>
          <label class="knob">
            <span class="knob-label">{{ t('settings.evidence.snapshotMax') }}</span>
            <span class="knob-input">
              <input type="number" v-model.number="diag.snapshotMaxKiB" min="64" max="1024" step="64" />
              <span class="unit">KiB</span>
            </span>
            <span class="knob-help hint">{{ t('settings.evidence.snapshotMaxHelp') }}</span>
          </label>
          <label class="knob">
            <span class="knob-label">{{ t('settings.evidence.retention') }}</span>
            <span class="knob-input">
              <input type="number" v-model.number="diag.retentionDays" min="1" max="365" step="1" />
              <span class="unit">{{ t('settings.unit.days') }}</span>
            </span>
            <span class="knob-help hint">{{ t('settings.evidence.retentionHelp') }}</span>
          </label>
        </div>
      </div>
    </section>

    <section class="panel">
      <div class="panel-head"><h3>{{ t('settings.diag.title') }}</h3></div>
      <div class="panel-body">
        <p class="hint">{{ t('settings.diag.hint') }}</p>
        <label class="toggle-row">
          <input type="checkbox" v-model="diag.diagEnabled" />
          <span>{{ t('settings.diag.enable') }}</span>
          <span class="hint">{{ t('settings.diag.enableHelp') }}</span>
        </label>
        <div class="knob-grid">
          <label class="knob">
            <span class="knob-label">{{ t('settings.diag.totalTimeout') }}</span>
            <span class="knob-input">
              <input type="number" v-model.number="diag.totalTimeoutS" min="5" max="120" step="1" :disabled="!diag.diagEnabled" />
              <span class="unit">{{ t('settings.unit.seconds') }}</span>
            </span>
            <span class="knob-help hint">{{ t('settings.diag.totalTimeoutHelp') }}</span>
          </label>
          <label class="knob">
            <span class="knob-label">{{ t('settings.diag.maxHops') }}</span>
            <span class="knob-input">
              <input type="number" v-model.number="diag.maxHops" min="1" max="64" step="1" :disabled="!diag.diagEnabled" />
              <span class="unit">{{ t('settings.unit.hops') }}</span>
            </span>
            <span class="knob-help hint">{{ t('settings.diag.maxHopsHelp') }}</span>
          </label>
          <label class="knob">
            <span class="knob-label">{{ t('settings.diag.attempts') }}</span>
            <span class="knob-input">
              <input type="number" v-model.number="diag.attempts" min="1" max="5" step="1" :disabled="!diag.diagEnabled" />
              <span class="unit">{{ t('settings.unit.perHop') }}</span>
            </span>
            <span class="knob-help hint">{{ t('settings.diag.attemptsHelp') }}</span>
          </label>
          <label class="knob">
            <span class="knob-label">{{ t('settings.diag.agentConc') }}</span>
            <span class="knob-input">
              <input type="number" v-model.number="diag.agentConc" min="1" max="16" step="1" :disabled="!diag.diagEnabled" />
              <span class="unit">{{ t('settings.unit.perAgent') }}</span>
            </span>
            <span class="knob-help hint">{{ t('settings.diag.agentConcHelp') }}</span>
          </label>
          <label class="knob">
            <span class="knob-label">{{ t('settings.diag.globalConc') }}</span>
            <span class="knob-input">
              <input type="number" v-model.number="diag.globalConc" min="1" max="64" step="1" :disabled="!diag.diagEnabled" />
              <span class="unit">{{ t('settings.unit.global') }}</span>
            </span>
            <span class="knob-help hint">{{ t('settings.diag.globalConcHelp') }}</span>
          </label>
        </div>
        <label class="toggle-row">
          <input type="checkbox" v-model="diag.resolveHops" :disabled="!diag.diagEnabled" />
          <span>{{ t('settings.diag.resolveHops') }}</span>
          <span class="hint">{{ t('settings.diag.resolveHopsHelp') }}</span>
        </label>
      </div>
      <div class="panel-foot">
        <button class="btn btn-primary" @click="saveDiag">{{ t('common.save') }}</button>
        <span v-if="diagSaved" class="hint saved">✓ {{ t('common.saved') }}</span>
        <span v-if="diagError" class="err inline">{{ diagError }}</span>
      </div>
    </section>
    </div><!-- /general -->

    <div v-show="tab === 'notifications'">
    <section class="panel">
      <div class="panel-head"><h3>{{ t('settings.channels') }}</h3><span class="count">{{ channels.length }}</span></div>
      <div class="panel-body">
        <p class="hint">{{ t('settings.channelsHint') }}</p>

        <div class="type-tabs" role="tablist">
          <span class="type-label">{{ t('settings.addChannelType') }}</span>
          <button
            v-for="ct in CHANNEL_TYPES" :key="ct.value"
            class="type-tab" :class="{ active: addType === ct.value }"
            @click="addType = ct.value">
            {{ ct.label }}
          </button>
        </div>

        <div v-if="addType === 'webhook'" class="wh-add">
          <WebhookChannelForm mode="add" @saved="onWebhookSaved" />
        </div>

        <div v-else-if="addType === 'email'" class="row field-row wrap">
          <b class="ftag">Email</b>
          <input v-model="email.name" :placeholder="t('settings.namePlaceholder')" class="tiny-name" />
          <input v-model="email.host" :placeholder="t('settings.smtpHost')" />
          <input v-model="email.port" :placeholder="t('settings.port')" class="tiny" />
          <input v-model="email.from" :placeholder="t('settings.from')" />
          <input v-model="email.to" :placeholder="t('settings.to')" />
          <input v-model="email.username" :placeholder="t('settings.usernameOpt')" />
          <input v-model="email.password" type="password" :placeholder="t('settings.passwordOpt')" />
          <select v-model="email.lang" :title="t('settings.langLabel')">
            <option v-for="l in LANGS" :key="l.value" :value="l.value">{{ l.label }}</option>
          </select>
          <button class="btn btn-primary" @click="addEmail">{{ t('settings.addBtn') }}</button>
        </div>

        <div v-else-if="addType === 'system'" class="row field-row">
          <b class="ftag">{{ t('settings.sysNotify') }}</b>
          <input v-model="system.name" :placeholder="t('settings.namePlaceholder')" class="tiny-name" />
          <select v-model="system.lang" :title="t('settings.langLabel')">
            <option v-for="l in LANGS" :key="l.value" :value="l.value">{{ l.label }}</option>
          </select>
          <span class="hint">{{ t('settings.sysNotifyHint') }}</span>
          <button class="btn btn-primary" @click="addSystem">{{ t('settings.addBtn') }}</button>
        </div>
        <p v-if="applyMsg" class="hint saved">✓ {{ applyMsg }}</p>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>{{ t('settings.thName') }}</th><th>{{ t('settings.thType') }}</th><th>{{ t('settings.thConfig') }}</th><th class="center">{{ t('settings.thEnabled') }}</th><th></th></tr></thead>
          <tbody>
            <tr v-if="!channels.length"><td colspan="5" class="hint">{{ t('settings.noChannels') }}</td></tr>
            <template v-for="c in channels" :key="c.id">
              <tr>
                <td><input v-model="c.name" class="name-in" @blur="renameChannel(c)" /></td>
                <td><span class="badge neutral">{{ c.type }}</span></td>
                <td class="mono">{{ channelConfigLabel(c) }}</td>
                <td class="center"><input type="checkbox" :checked="c.enabled" @change="toggleChannel(c)" /></td>
                <td class="row-actions">
                  <button
                    v-if="c.type === 'webhook'" class="link-btn"
                    @click="editingId = editingId === c.id ? '' : c.id">
                    {{ editingId === c.id ? t('settings.webhook.cancel') : t('settings.webhook.edit') }}
                  </button>
                  <button class="link-btn" :disabled="applyingId === c.id" @click="applyChannelToAll(c)">
                    {{ t('settings.applyAll.btn') }}
                  </button>
                  <button class="link-btn danger" @click="removeChannel(c.id)">{{ t('common.delete') }}</button>
                </td>
              </tr>
              <tr v-if="editingId === c.id" class="wh-edit-row">
                <td colspan="5">
                  <WebhookChannelForm
                    mode="edit"
                    :channel-id="c.id"
                    :enabled="c.enabled"
                    :initial-name="c.name"
                    :initial-config="c.config"
                    @saved="onWebhookSaved"
                    @cancel="editingId = ''"
                  />
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </section>

    <section class="panel">
      <div class="panel-head"><h3>{{ t('settings.agentAlert.title') }}</h3></div>
      <div class="panel-body">
        <p class="hint">{{ t('settings.agentAlert.hint') }}</p>
        <label class="toggle-row">
          <input type="checkbox" v-model="agentAlert.enabled" />
          <span>{{ t('settings.agentAlert.enable') }}</span>
        </label>
        <div class="knob-grid">
          <label class="knob">
            <span class="knob-label">{{ t('settings.agentAlert.grace') }}</span>
            <span class="knob-input">
              <input type="number" v-model.number="agentAlert.graceS" min="15" max="3600" step="1" :disabled="!agentAlert.enabled" />
              <span class="unit">{{ t('settings.unit.seconds') }}</span>
            </span>
            <span class="knob-help hint">{{ t('settings.agentAlert.graceHelp') }}</span>
          </label>
          <label class="knob">
            <span class="knob-label">{{ t('settings.agentAlert.recover') }}</span>
            <span class="knob-input">
              <input type="number" v-model.number="agentAlert.recoverS" min="5" max="600" step="1" :disabled="!agentAlert.enabled" />
              <span class="unit">{{ t('settings.unit.seconds') }}</span>
            </span>
            <span class="knob-help hint">{{ t('settings.agentAlert.recoverHelp') }}</span>
          </label>
          <label class="knob">
            <span class="knob-label">{{ t('settings.agentAlert.stale') }}</span>
            <span class="knob-input">
              <input type="number" v-model.number="agentAlert.staleS" min="30" max="3600" step="1" />
              <span class="unit">{{ t('settings.unit.seconds') }}</span>
            </span>
            <span class="knob-help hint">{{ t('settings.agentAlert.staleHelp') }}</span>
          </label>
          <label class="knob">
            <span class="knob-label">{{ t('settings.agentAlert.severity') }}</span>
            <span class="knob-input">
              <select v-model="agentAlert.severity" :disabled="!agentAlert.enabled">
                <option v-for="sv in AGENT_SEVERITIES" :key="sv" :value="sv">
                  {{ sv === '' ? t('settings.agentAlert.sevDefault') : t(`mform.sev_${sv}`) }}
                </option>
              </select>
            </span>
            <span class="knob-help hint">{{ t('settings.agentAlert.severityHelp') }}</span>
          </label>
        </div>
        <div class="alert-channels">
          <span class="knob-label">{{ t('settings.agentAlert.channels') }}</span>
          <p class="hint tiny">{{ t('settings.agentAlert.channelsHint') }}</p>
          <div v-if="!channels.length" class="hint tiny">{{ t('settings.noChannels') }}</div>
          <label v-for="c in channels" :key="c.id" class="member-chip">
            <input type="checkbox" :checked="agentAlert.channelIds.includes(c.id)" :disabled="!agentAlert.enabled" @change="toggleAlertChannel(c.id)" />
            <span>{{ c.name || c.type }}</span>
          </label>
        </div>
        <div class="row field-row">
          <button class="btn btn-primary" @click="saveAgentAlert">{{ t('common.save') }}</button>
          <span v-if="agentAlertSaved" class="hint saved">✓ {{ t('common.saved') }}</span>
        </div>
        <p v-if="agentAlertError" class="err inline">{{ agentAlertError }}</p>
      </div>
    </section>
    </div><!-- /notifications -->

    <div v-show="tab === 'data'">
      <div class="stat-grid">
        <div class="stat" v-if="quota">
          <div class="label">{{ t('settings.agentQuota') }}</div>
          <div class="value">{{ quota.used }}<span class="unit">/ {{ quota.max === 0 ? '∞' : quota.max }}</span></div>
          <div class="foot">{{ t('settings.agentQuotaFoot') }}</div>
        </div>
        <template v-if="stats">
          <div class="stat">
            <div class="label">Series</div>
            <div class="value">{{ stats.series }}</div>
            <div class="foot">{{ t('settings.seriesFoot') }}</div>
          </div>
          <div class="stat">
            <div class="label">{{ t('settings.rawSamples') }}</div>
            <div class="value">{{ stats.samples }}</div>
            <div class="foot">{{ t('settings.rawSamplesFoot') }}</div>
          </div>
          <div class="stat">
            <div class="label">{{ t('settings.rollup') }}</div>
            <div class="value rollup">{{ stats.rollup_1m }}<span class="sep">·</span>{{ stats.rollup_1h }}<span
                class="sep">·</span>{{ stats.rollup_1d }}</div>
            <div class="foot">{{ t('settings.rollupFoot') }}</div>
          </div>
        </template>
      </div>
      <p class="hint storage-note" v-if="stats">
        {{ t('settings.storageNote') }}
      </p>

      <DataCleanup />
    </div>
  </main>
</template>

<style scoped>
.page {
  max-width: 900px;
}
.tabs {
  display: flex;
  gap: 6px;
  margin-bottom: 18px;
  border-bottom: 1px solid var(--border);
}
.tab {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
}
.tab:hover {
  color: var(--text);
}
.tab.active {
  color: var(--primary);
  border-bottom-color: var(--primary);
}
/* Neutralize the panel-head `.count` auto-margin when used as a tab badge. */
.tabs .count {
  margin-left: 2px;
}
.panel {
  margin-bottom: 20px;
}
.table-wrap {
  overflow-x: auto;
  border-top: 1px solid var(--border);
}
.count {
  margin-left: auto;
  min-width: 22px;
  padding: 1px 9px;
  border-radius: var(--radius-pill);
  font-size: 12px;
  font-weight: 600;
  color: var(--text-dim);
  background: var(--surface-2);
  border: 1px solid var(--border);
  text-align: center;
}
.panel-body {
  padding: 16px 18px;
}
.panel-body .row {
  margin: 12px 0 0;
}
.wh-add {
  margin: 12px 0 0;
}
.wh-edit-row td {
  background: var(--surface-2);
  padding: 12px 16px;
}
.row-actions {
  display: flex;
  gap: 10px;
  white-space: nowrap;
}
.rollup {
  font-size: 22px;
}
.rollup .sep {
  margin: 0 7px;
  color: var(--text-muted);
  font-weight: 400;
}
.storage-note {
  margin: -8px 0 22px;
}
.type-tabs {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 4px 0 2px;
}
.type-label {
  font-size: 13px;
  color: var(--text-dim);
  margin-right: 4px;
}
.type-tab {
  padding: 6px 16px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-dim);
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  cursor: pointer;
  transition: background 0.16s, color 0.16s, border-color 0.16s;
}
.type-tab:hover {
  color: var(--text);
}
.type-tab.active {
  color: var(--primary);
  background: var(--primary-soft);
  border-color: rgba(56, 189, 248, 0.35);
}
.field-row .ftag {
  min-width: 62px;
  font-size: 13px;
  color: var(--text-dim);
}
input {
  min-width: 140px;
}
input.wide {
  min-width: 320px;
  flex: 1;
}
input.tiny {
  min-width: 64px;
  width: 64px;
}
input.tiny-name {
  min-width: 96px;
  width: 96px;
}
.name-in {
  min-width: 120px;
}
.knob-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 16px;
  margin: 14px 0 4px;
}
.knob {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.knob-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-dim);
}
.knob-input {
  display: flex;
  align-items: center;
  gap: 8px;
}
.knob-input input {
  min-width: 96px;
  width: 110px;
}
.knob-input input:disabled {
  opacity: 0.5;
}
.knob-input .unit {
  font-size: 12px;
  color: var(--text-muted);
}
.knob-help {
  font-size: 12px;
  line-height: 1.45;
}
.toggle-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 12px 0;
  font-size: 13.5px;
}
.toggle-row input {
  min-width: 0;
}
.panel-foot {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 18px 16px;
}
.err.inline {
  padding: 6px 10px;
}
.saved {
  color: var(--success);
}
.listen-modes {
  display: flex;
  gap: 24px;
  margin: 12px 0 4px;
}
input.port-in {
  min-width: 110px;
  width: 110px;
}
.listen-modes .toggle-row {
  margin: 0;
}
.listen-status .mono {
  font-weight: 600;
}
.pending-badge {
  margin-left: 10px;
  padding: 1px 9px;
  border-radius: var(--radius-pill);
  font-size: 12px;
  color: var(--warning, #d97706);
  background: var(--surface-2);
  border: 1px solid var(--border);
}
.warn-box {
  margin: 10px 0 4px;
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 13px;
  line-height: 1.5;
  color: #92400e;
  background: rgba(251, 191, 36, 0.12);
  border: 1px solid rgba(251, 191, 36, 0.4);
}
:root.dark .warn-box,
.dark .warn-box {
  color: #fbbf24;
}
</style>

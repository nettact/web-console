<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import {
  api,
  ApiError,
  AuthError,
  type Channel,
  type EffectivePolicy,
  type MonitorGroup,
  type NotificationPolicy,
  type NotificationPolicyInput,
  type ProbeTarget,
  type Quota,
  type ServerInfo,
  type StorageStats,
} from '../api'
import { auth } from '../auth'
import { setConsoleBase } from '../consoleBaseUrl'
import { ensureUpdateNotice, setUpdateNoticeDisabled, updateNotice } from '../updateInfo'
import { pushToast } from '../toasts'
import WebhookChannelForm from '../components/WebhookChannelForm.vue'
import ChannelAddForm from '../components/ChannelAddForm.vue'
import DataCleanup from '../components/DataCleanup.vue'
import PolicyFields from '../components/PolicyFields.vue'
import InfoTip from '../components/InfoTip.vue'

const { t } = useI18n()
const router = useRouter()

const SITE = 'site_default'

// Secondary navigation: the page grew too dense for one scroll, so its panels are
// split across underline tabs (same pattern as Processes.vue). All tab bodies stay
// mounted (v-show) so their one-shot on-mount loads/state persist across switches.
const tab = ref<'general' | 'notifications' | 'data'>('general')

const quota = ref<Quota | null>(null)
const stats = ref<StorageStats | null>(null)
const serverInfo = ref<ServerInfo | null>(null)
const error = ref('')

const channels = ref<Channel[]>([])
// 添加渠道的表单（含类型选择）在 ChannelAddForm 中，与初始化引导共用。
// Webhook add/edit is delegated to WebhookChannelForm; editingId marks which
// existing channel row is expanded for editing ('' = none).
const editingId = ref('')

// 控制台地址：通知里深链回本事故详情页的基础 URL（如 http://localhost:12450）。
const consoleUrl = ref('')
const consoleSaved = ref(false)

// 账户与安全（AUTH-001）：修改当前登录用户的密码。契约：旧密码错误返回 403
// （ApiError.status===403，作字段错误展示）；会话缺失/过期返回 401（AuthError，
// 清空登录态并送回登录页）；新密码强度不符返回 400。desktop 模式下管理员密码随机
// 生成且从不展示，用户无从填写「当前密码」，故整个面板对 desktop 隐藏（见模板）。
// 强度口径与服务端一致：≥8 个 Unicode 码点且 ≤72 UTF-8 字节。
const PW_MIN = 8 // 最少码点数
const PW_MAX_BYTES = 72 // 最多 UTF-8 字节数（bcrypt 上限）
const pwCodePoints = (s: string) => [...s].length
const pwBytes = (s: string) => new TextEncoder().encode(s).length
const pw = reactive({ old: '', next: '', confirm: '' })
const pwError = ref('')
const pwSaved = ref(false)
// 前端预校验：新密码码点数达标、字节数不超限、两次一致，且当前密码已填。
const pwValid = computed(
  () =>
    pw.old.length > 0 &&
    pwCodePoints(pw.next) >= PW_MIN &&
    pwBytes(pw.next) <= PW_MAX_BYTES &&
    pw.next === pw.confirm,
)
async function savePassword() {
  pwError.value = ''
  if (pwCodePoints(pw.next) < PW_MIN) {
    pwError.value = t('settings.account.tooShort', { min: PW_MIN })
    return
  }
  if (pwBytes(pw.next) > PW_MAX_BYTES) {
    pwError.value = t('settings.account.tooLong', { max: PW_MAX_BYTES })
    return
  }
  if (pw.next !== pw.confirm) {
    pwError.value = t('settings.account.mismatch')
    return
  }
  try {
    await api.changePassword(pw.old, pw.next)
    pw.old = ''
    pw.next = ''
    pw.confirm = ''
    pwSaved.value = true
    setTimeout(() => (pwSaved.value = false), 2000)
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) {
      // 403 → 旧密码错误，作字段错误处理，不触发跳转登录。
      pwError.value = t('settings.account.wrongOld')
    } else if (e instanceof AuthError) {
      // 401 → 会话已失效：清空登录态、提示、送回登录页（与 doLogout 一致）。
      pushToast({ tone: 'warn', title: t('settings.account.sessionExpired') })
      auth.user = null
      router.push('/login')
    } else {
      pwError.value = String((e as Error).message || e)
    }
  }
}

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
  totalTimeoutS: 90, // diag_total_timeout_ms / 1000
  maxHops: 30, // diag_max_hops
  attempts: 3, // diag_attempts_per_hop
  agentConc: 4, // diag_agent_concurrency
  globalConc: 16, // diag_global_concurrency
  resolveHops: false, // diag_resolve_hops
  retentionDays: 30, // evidence_retention_days
  fluctuationRetentionDays: 30, // fluctuation_retention_days
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
  fluctuationRetentionDays: [1, 365],
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
  diag.totalTimeoutS = Math.round(num('diag_total_timeout_ms', 90000) / 1000)
  diag.maxHops = num('diag_max_hops', 30)
  diag.attempts = num('diag_attempts_per_hop', 3)
  diag.agentConc = num('diag_agent_concurrency', 4)
  diag.globalConc = num('diag_global_concurrency', 16)
  diag.resolveHops = num('diag_resolve_hops', 0) !== 0
  diag.retentionDays = num('evidence_retention_days', 30)
  diag.fluctuationRetentionDays = num('fluctuation_retention_days', 30)
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
      fluctuation_retention_days: String(diag.fluctuationRetentionDays),
    })
    diagSaved.value = true
    setTimeout(() => (diagSaved.value = false), 2000)
  } catch (e) {
    diagError.value = String((e as Error).message || e)
  }
}

// Agent connectivity DETECTION (AGENT-002). These decide whether an offline
// Agent is recorded as a fault and how long confirmation takes — not who hears
// about it. Turning detection off does not merely silence a notification: the
// fault stops being recorded at all, which is why this sits with the other
// detection settings rather than under Notifications. Severity is fixed at
// critical and routing is a notification policy; neither is set here.
const connectivity = reactive({
  enabled: true,
  graceS: 60, // agent_connectivity_grace_seconds
  recoverS: 30, // agent_connectivity_recover_seconds
})
const CONNECTIVITY_BOUNDS: Record<string, [number, number]> = {
  graceS: [15, 3600],
  recoverS: [5, 600],
}
const connectivitySaved = ref(false)
const connectivityError = ref('')

// Resource-sample freshness for the Agent list (AGENT-001). Not part of the
// detector at all — it only decides when a resource reading is labelled stale in
// the UI — so it gets its own panel rather than riding along with detection
// timings it has nothing to do with.
const agentDisplay = reactive({ staleS: 120 }) // agent_status_stale_seconds
const AGENT_DISPLAY_BOUNDS: [number, number] = [30, 3600]
const agentDisplaySaved = ref(false)
const agentDisplayError = ref('')

// Alert-storm correlation (ALERT-001). This is a NOTIFICATION decision — how
// many messages leave the building when one Agent's vantage point goes dark —
// not a detection one: every fault is still recorded and still listed either
// way. That is why it sits under Notifications rather than beside the detector
// timings.
const storm = reactive({
  threshold: 3, // incident_storm_threshold (0 = off)
  windowS: 300, // incident_storm_window_seconds
})
const STORM_BOUNDS: Record<string, [number, number]> = {
  threshold: [0, 50],
  windowS: [30, 3600],
}
const stormSaved = ref(false)
const stormError = ref('')

// LAN device retention. Discovery only ever adds devices (an Agent never reports
// a departure), so age is the only thing that removes them. `randomDays` is a
// narrowing override for randomized MACs, not an independent window: the two
// zeros mean different things (see the locale help text), which is what keeps a
// throwaway address from outliving a real one.
const deviceRetention = reactive({
  days: 7, // device_retention_days
  randomDays: 1, // device_random_mac_retention_days
})
const DEVICE_RETENTION_BOUNDS: Record<string, [number, number]> = {
  days: [0, 365],
  randomDays: [0, 365],
}
const deviceRetentionSaved = ref(false)
const deviceRetentionError = ref('')

function settingInt(s: Record<string, string>, k: string, def: number): number {
  const v = parseInt(s[k] ?? '', 10)
  return Number.isFinite(v) ? v : def
}

function populateAgentSettings(s: Record<string, string>) {
  connectivity.enabled = settingInt(s, 'agent_connectivity_enabled', 1) !== 0
  connectivity.graceS = settingInt(s, 'agent_connectivity_grace_seconds', 60)
  connectivity.recoverS = settingInt(s, 'agent_connectivity_recover_seconds', 30)
  agentDisplay.staleS = settingInt(s, 'agent_status_stale_seconds', 120)
}

function populateStorm(s: Record<string, string>) {
  storm.threshold = settingInt(s, 'incident_storm_threshold', 3)
  storm.windowS = settingInt(s, 'incident_storm_window_seconds', 300)
}

async function saveStorm() {
  stormError.value = ''
  const inRange = Object.entries(STORM_BOUNDS).every(([k, [min, max]]) => {
    const v = (storm as unknown as Record<string, number>)[k]
    return Number.isFinite(v) && v >= min && v <= max
  })
  if (!inRange) {
    stormError.value = t('settings.alertStorm.rangeErr')
    return
  }
  try {
    await api.updateSettings({
      incident_storm_threshold: String(storm.threshold),
      incident_storm_window_seconds: String(storm.windowS),
    })
    stormSaved.value = true
    setTimeout(() => (stormSaved.value = false), 2000)
  } catch (e) {
    stormError.value = String((e as Error).message || e)
  }
}

function populateDeviceRetention(s: Record<string, string>) {
  deviceRetention.days = settingInt(s, 'device_retention_days', 7)
  deviceRetention.randomDays = settingInt(s, 'device_random_mac_retention_days', 1)
}

async function saveConnectivity() {
  connectivityError.value = ''
  const inRange = Object.entries(CONNECTIVITY_BOUNDS).every(([k, [min, max]]) => {
    const v = (connectivity as unknown as Record<string, number>)[k]
    return Number.isFinite(v) && v >= min && v <= max
  })
  if (!inRange) {
    connectivityError.value = t('settings.agentConnectivity.rangeErr')
    return
  }
  try {
    await api.updateSettings({
      agent_connectivity_enabled: connectivity.enabled ? '1' : '0',
      agent_connectivity_grace_seconds: String(connectivity.graceS),
      agent_connectivity_recover_seconds: String(connectivity.recoverS),
    })
    connectivitySaved.value = true
    setTimeout(() => (connectivitySaved.value = false), 2000)
  } catch (e) {
    connectivityError.value = String((e as Error).message || e)
  }
}

async function saveAgentDisplay() {
  agentDisplayError.value = ''
  const [min, max] = AGENT_DISPLAY_BOUNDS
  if (!Number.isFinite(agentDisplay.staleS) || agentDisplay.staleS < min || agentDisplay.staleS > max) {
    agentDisplayError.value = t('settings.agentDisplay.rangeErr')
    return
  }
  try {
    await api.updateSettings({ agent_status_stale_seconds: String(agentDisplay.staleS) })
    agentDisplaySaved.value = true
    setTimeout(() => (agentDisplaySaved.value = false), 2000)
  } catch (e) {
    agentDisplayError.value = String((e as Error).message || e)
  }
}

async function saveDeviceRetention() {
  deviceRetentionError.value = ''
  const inRange = Object.entries(DEVICE_RETENTION_BOUNDS).every(([k, [min, max]]) => {
    const v = (deviceRetention as unknown as Record<string, number>)[k]
    return Number.isFinite(v) && v >= min && v <= max
  })
  if (!inRange) {
    deviceRetentionError.value = t('settings.deviceRetention.rangeErr')
    return
  }
  // The randomized-MAC window only ever NARROWS the master one. Each key passes its own
  // bounds independently, so without this a 7-day master with a 30-day random window
  // saved cleanly and left throwaway addresses outliving real devices — the opposite of
  // what the setting is for. The server clamps it too; rejecting here means the user
  // sees why instead of having their value silently altered.
  if (deviceRetention.randomDays > 0 && deviceRetention.randomDays > deviceRetention.days) {
    deviceRetentionError.value = t('settings.deviceRetention.randomNarrowErr')
    return
  }
  try {
    await api.updateSettings({
      device_retention_days: String(deviceRetention.days),
      device_random_mac_retention_days: String(deviceRetention.randomDays),
    })
    deviceRetentionSaved.value = true
    setTimeout(() => (deviceRetentionSaved.value = false), 2000)
  } catch (e) {
    deviceRetentionError.value = String((e as Error).message || e)
  }
}

// ---- notification policies ----
// A policy decides whether/when/where a RECORDED fault is announced; it never
// decides whether the fault is detected. Exactly one policy governs any target
// (group > site default, no stacking), so the preview below can show the single
// winner instead of a merged result.
const policies = ref<NotificationPolicy[]>([])
const policyGroups = ref<MonitorGroup[]>([])
const policyTargets = ref<ProbeTarget[]>([])
const policyError = ref('')
const policyBusy = ref(false)
const policySaved = ref('') // '' | 'default' | <policy id>
// Drafts are separate objects so an in-flight edit survives a channel reload.
const defaultDraft = ref<NotificationPolicyInput | null>(null)
const editingPolicyId = ref('')
const policyDraft = ref<NotificationPolicyInput | null>(null)

const defaultPolicy = computed(() => policies.value.find((p) => p.is_default) ?? null)
const overrides = computed(() => policies.value.filter((p) => !p.is_default))

function toInput(p: NotificationPolicy): NotificationPolicyInput {
  return {
    name: p.name,
    scope_kind: p.scope_kind,
    scope_id: p.scope_id,
    enabled: p.enabled,
    min_severity: p.min_severity,
    warn_delay_sec: p.warn_delay_sec,
    critical_delay_sec: p.critical_delay_sec,
    notify_recovery: p.notify_recovery,
    channel_ids: [...p.channel_ids],
  }
}

async function loadPolicies() {
  policyError.value = ''
  try {
    const [pol, grp, tgt] = await Promise.all([
      api.notificationPolicies(SITE),
      api.monitorGroups(SITE),
      api.listTargets(SITE),
    ])
    policies.value = pol
    policyGroups.value = grp
    policyTargets.value = tgt
    const def = pol.find((p) => p.is_default)
    defaultDraft.value = def ? toInput(def) : null
  } catch (e) {
    policyError.value = String((e as Error).message || e)
  }
}

async function saveDefaultPolicy() {
  const def = defaultPolicy.value
  if (!def || !defaultDraft.value) return
  policyBusy.value = true
  policyError.value = ''
  try {
    await api.updateNotificationPolicy(def.id, defaultDraft.value)
    policySaved.value = 'default'
    setTimeout(() => (policySaved.value = ''), 2000)
    await loadPolicies()
  } catch (e) {
    policyError.value = String((e as Error).message || e)
  } finally {
    policyBusy.value = false
  }
}

function toggleEditPolicy(p: NotificationPolicy) {
  if (editingPolicyId.value === p.id) {
    editingPolicyId.value = ''
    policyDraft.value = null
    return
  }
  editingPolicyId.value = p.id
  policyDraft.value = toInput(p)
}

async function saveEditedPolicy(p: NotificationPolicy) {
  if (!policyDraft.value) return
  policyBusy.value = true
  policyError.value = ''
  try {
    // The scope is not editable here: an override is created from its monitor
    // group, so it can only be retargeted there.
    await api.updateNotificationPolicy(p.id, {
      ...policyDraft.value,
      scope_kind: p.scope_kind,
      scope_id: p.scope_id,
    })
    editingPolicyId.value = ''
    policyDraft.value = null
    policySaved.value = p.id
    setTimeout(() => (policySaved.value = ''), 2000)
    await loadPolicies()
  } catch (e) {
    policyError.value = String((e as Error).message || e)
  } finally {
    policyBusy.value = false
  }
}

async function removePolicy(p: NotificationPolicy) {
  if (!confirm(t('notificationPolicy.deleteConfirm', { name: p.name }))) return
  policyBusy.value = true
  policyError.value = ''
  try {
    await api.deleteNotificationPolicy(p.id)
    if (editingPolicyId.value === p.id) {
      editingPolicyId.value = ''
      policyDraft.value = null
    }
    await loadPolicies()
  } catch (e) {
    policyError.value = String((e as Error).message || e)
  } finally {
    policyBusy.value = false
  }
}

// ---- effective-policy preview ----
const previewTargetId = ref('')
const previewBusy = ref(false)
const preview = ref<EffectivePolicy | null>(null)
async function runPreview() {
  preview.value = null
  if (!previewTargetId.value) return
  previewBusy.value = true
  policyError.value = ''
  try {
    preview.value = await api.effectiveNotificationPolicy(previewTargetId.value)
  } catch (e) {
    policyError.value = String((e as Error).message || e)
  } finally {
    previewBusy.value = false
  }
}

function scopeLabel(p: NotificationPolicy): string {
  if (p.scope_kind === 'group') {
    const g = policyGroups.value.find((x) => x.id === p.scope_id)
    return t('notificationPolicy.scopeGroup', { name: g?.name || p.scope_id })
  }
  return t('notificationPolicy.scopeSite')
}
function targetOptionLabel(tg: ProbeTarget): string {
  return `${tg.name || tg.target} · ${tg.kind}`
}
function channelsLabel(ids: string[]): string {
  if (!ids.length) return t('notificationPolicy.recordOnlyShort')
  return ids.map((id) => channels.value.find((c) => c.id === id)?.name || id).join(', ')
}
function delayLabel(sec: number): string {
  if (!sec) return t('notificationPolicy.delayImmediate')
  if (sec % 60 === 0) return t('common.durMinutes', { n: sec / 60 })
  return t('common.durSeconds', { n: sec })
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
    setConsoleBase(settings['console_base_url'] || '')
    populateDiag(settings)
    populateAgentSettings(settings)
    populateStorm(settings)
    populateDeviceRetention(settings)
    populateListen()
  } catch (e) {
    error.value = String((e as Error).message || e)
  }
}
async function saveConsoleUrl() {
  try {
    await api.updateSettings({ console_base_url: consoleUrl.value.trim() })
    // Enrollment commands read this address; publish it so an Agents page that is
    // already mounted (KeepAlive) generates the new one without a reload.
    setConsoleBase(consoleUrl.value.trim())
    consoleSaved.value = true
    setTimeout(() => (consoleSaved.value = false), 2000)
  } catch (e) {
    error.value = String((e as Error).message || e)
  }
}
// Software update. The panel exists only once the server has reported a
// successful check; the whole `update` block is absent while update checking is
// switched off. The notice switch writes a shared setting the desktop tray
// balloon reads too, so turning it off here silences that as well.
const updateInfo = computed(() => serverInfo.value?.update ?? null)
// The block is published for the agent version alone when the product check
// itself never completed — a Store install whose Store query keeps failing, say.
// Reporting "up to date" there would turn a failed check into an assurance, so
// that case says so instead. A Store install can also report an update without
// naming its version, which is the second fallback.
const updateLatestLabel = computed(() => {
  const u = updateInfo.value
  if (!u) return ''
  if (!u.product_checked) return t('update.notChecked')
  if (!u.update_available) return t('update.upToDate')
  return u.latest_version.trim() || t('update.unknownVersion')
})
const updateActionLabel = computed(() =>
  updateInfo.value?.install_type === 'store' ? t('update.openStore') : t('update.download'),
)
// The switch applies immediately (there is no Save button here), so a toast
// carries the feedback and a failed write rolls the local state back.
const updateNoticeOff = computed({
  get: () => updateNotice.noticeDisabled,
  set: (v: boolean) => void saveUpdateNotice(v),
})
async function saveUpdateNotice(v: boolean) {
  try {
    await setUpdateNoticeDisabled(v)
    pushToast({ tone: 'info', title: t('common.saved') })
  } catch (e) {
    updateNotice.noticeDisabled = !v
    pushToast({ tone: 'danger', title: String((e as Error).message || e) })
  }
}

// WebhookChannelForm performs the create/update itself (so it can surface
// failures inline); the parent only closes the editor and refreshes the list.
async function onWebhookSaved() {
  editingId.value = ''
  await load()
}
async function toggleChannel(c: Channel) {
  await api.updateChannel(c.id, { name: c.name, enabled: !c.enabled, storm_merge: c.storm_merge })
  await load()
}
// Per-channel storm merging (ALERT-001): one summary when many faults break out
// at once, or one message per fault. On by default; off suits a machine consumer
// that needs a record per incident.
async function toggleStormMerge(c: Channel) {
  await api.updateChannel(c.id, { name: c.name, enabled: c.enabled, storm_merge: !c.storm_merge })
  await load()
}
async function renameChannel(c: Channel) {
  await api.updateChannel(c.id, { name: c.name, enabled: c.enabled, storm_merge: c.storm_merge })
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
onMounted(() => {
  load()
  loadPolicies()
  // Shared with the App-level banner; a no-op once loaded.
  void ensureUpdateNotice()
})
</script>

<template>
  <main class="page settings-page">
    <div class="page-head settings-head">
      <h2>{{ t('settings.title') }}</h2>
      <p class="sub">{{ t('settings.sub') }}</p>
    </div>

    <div class="tabs settings-tabs" role="tablist" :aria-label="t('settings.title')">
      <button
        id="settings-tab-general"
        class="tab" role="tab"
        :class="{ active: tab === 'general' }" :aria-selected="tab === 'general'"
        :tabindex="tab === 'general' ? 0 : -1"
        aria-controls="settings-panel-general"
        @click="tab = 'general'"
      >
        {{ t('settings.tabs.general') }}
      </button>
      <button
        id="settings-tab-notifications"
        class="tab" role="tab"
        :class="{ active: tab === 'notifications' }" :aria-selected="tab === 'notifications'"
        :tabindex="tab === 'notifications' ? 0 : -1"
        aria-controls="settings-panel-notifications"
        @click="tab = 'notifications'"
      >
        {{ t('settings.tabs.notifications') }}
        <span class="count">{{ channels.length }}</span>
      </button>
      <button
        id="settings-tab-data"
        class="tab" role="tab"
        :class="{ active: tab === 'data' }" :aria-selected="tab === 'data'"
        :tabindex="tab === 'data' ? 0 : -1"
        aria-controls="settings-panel-data"
        @click="tab = 'data'"
      >
        {{ t('settings.tabs.data') }}
      </button>
    </div>

    <p v-if="error" class="err" role="alert">{{ error }}</p>

    <div
      v-show="tab === 'general'"
      id="settings-panel-general"
      class="preference-workspace"
      role="tabpanel"
      aria-labelledby="settings-tab-general"
    >
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

    <!-- Only rendered once a check has succeeded: the server omits `update`
         entirely while checking is switched off or has never returned. -->
    <section class="panel" v-if="updateInfo">
      <div class="panel-head"><h3>{{ t('update.settingsTitle') }}</h3></div>
      <div class="panel-body">
        <p class="hint">{{ t('update.settingsHint') }}</p>
        <p class="hint">
          {{ t('update.currentVersion') }}: <span class="mono">{{ updateInfo.current_version || '—' }}</span>
        </p>
        <p class="hint">
          {{ t('update.latestVersion') }}:
          <span :class="{ mono: updateInfo.update_available && !!updateInfo.latest_version.trim() }">
            {{ updateLatestLabel }}
          </span>
        </p>
        <div v-if="updateInfo.update_available" class="row field-row">
          <a
            class="btn btn-primary"
            :href="updateInfo.download_url"
            target="_blank"
            rel="noopener noreferrer"
          >{{ updateActionLabel }}</a>
        </div>
        <label class="toggle-row">
          <input type="checkbox" v-model="updateNoticeOff" />
          <span>{{ t('update.disableNotice') }}</span>
        </label>
        <p class="hint tiny">{{ t('update.disableNoticeHint') }}</p>
      </div>
    </section>

    <section class="panel" v-if="serverInfo && !serverInfo.listen?.desktop">
      <div class="panel-head"><h3>{{ t('settings.account.title') }}</h3></div>
      <div class="panel-body">
        <p class="hint">{{ t('settings.account.hint') }}</p>
        <div class="pw-form">
          <label class="pw-field">
            <span class="knob-label">{{ t('settings.account.current') }}</span>
            <input type="password" v-model="pw.old" autocomplete="current-password" />
          </label>
          <label class="pw-field">
            <span class="knob-label">{{ t('settings.account.new') }}</span>
            <input type="password" v-model="pw.next" autocomplete="new-password" />
          </label>
          <label class="pw-field">
            <span class="knob-label">{{ t('settings.account.confirm') }}</span>
            <input type="password" v-model="pw.confirm" autocomplete="new-password" />
          </label>
        </div>
        <p class="hint">{{ t('settings.account.rule', { min: PW_MIN, max: PW_MAX_BYTES }) }}</p>
        <div class="row field-row">
          <button class="btn btn-primary" :disabled="!pwValid" @click="savePassword">{{ t('common.save') }}</button>
          <span v-if="pwSaved" class="hint saved">✓ {{ t('settings.account.saved') }}</span>
        </div>
        <p v-if="pwError" class="err inline">{{ pwError }}</p>
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
          <label class="knob">
            <span class="knob-label">{{ t('settings.evidence.fluctuationRetention') }}</span>
            <span class="knob-input">
              <input type="number" v-model.number="diag.fluctuationRetentionDays" min="1" max="365" step="1" />
              <span class="unit">{{ t('settings.unit.days') }}</span>
            </span>
            <span class="knob-help hint">{{ t('settings.evidence.fluctuationRetentionHelp') }}</span>
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
    <!-- Detection, not notification: switching this off stops the fault being
         recorded, which is why it lives here and not under Notifications. -->
    <section class="panel">
      <div class="panel-head"><h3>{{ t('settings.agentConnectivity.title') }}</h3></div>
      <div class="panel-body">
        <p class="hint">{{ t('settings.agentConnectivity.hint') }}</p>
        <label class="toggle-row">
          <input type="checkbox" v-model="connectivity.enabled" />
          <span>{{ t('settings.agentConnectivity.enable') }}</span>
        </label>
        <p class="hint tiny">{{ t('settings.agentConnectivity.disableWarn') }}</p>
        <div class="knob-grid">
          <label class="knob">
            <span class="knob-label">{{ t('settings.agentConnectivity.grace') }}</span>
            <span class="knob-input">
              <input type="number" v-model.number="connectivity.graceS" min="15" max="3600" step="1" :disabled="!connectivity.enabled" />
              <span class="unit">{{ t('settings.unit.seconds') }}</span>
            </span>
            <span class="knob-help hint">{{ t('settings.agentConnectivity.graceHelp') }}</span>
          </label>
          <label class="knob">
            <span class="knob-label">{{ t('settings.agentConnectivity.recover') }}</span>
            <span class="knob-input">
              <input type="number" v-model.number="connectivity.recoverS" min="5" max="600" step="1" :disabled="!connectivity.enabled" />
              <span class="unit">{{ t('settings.unit.seconds') }}</span>
            </span>
            <span class="knob-help hint">{{ t('settings.agentConnectivity.recoverHelp') }}</span>
          </label>
        </div>
        <p class="hint tiny">{{ t('settings.agentConnectivity.routingNote') }}</p>
        <div class="row field-row">
          <button class="btn btn-primary" @click="saveConnectivity">{{ t('common.save') }}</button>
          <span v-if="connectivitySaved" class="hint saved">✓ {{ t('common.saved') }}</span>
        </div>
        <p v-if="connectivityError" class="err inline">{{ connectivityError }}</p>
      </div>
    </section>

    <section class="panel">
      <div class="panel-head"><h3>{{ t('settings.agentDisplay.title') }}</h3></div>
      <div class="panel-body">
        <p class="hint">{{ t('settings.agentDisplay.hint') }}</p>
        <div class="knob-grid">
          <label class="knob">
            <span class="knob-label">{{ t('settings.agentDisplay.stale') }}</span>
            <span class="knob-input">
              <input type="number" v-model.number="agentDisplay.staleS" min="30" max="3600" step="1" />
              <span class="unit">{{ t('settings.unit.seconds') }}</span>
            </span>
            <span class="knob-help hint">{{ t('settings.agentDisplay.staleHelp') }}</span>
          </label>
        </div>
        <div class="row field-row">
          <button class="btn btn-primary" @click="saveAgentDisplay">{{ t('common.save') }}</button>
          <span v-if="agentDisplaySaved" class="hint saved">✓ {{ t('common.saved') }}</span>
        </div>
        <p v-if="agentDisplayError" class="err inline">{{ agentDisplayError }}</p>
      </div>
    </section>

    </div><!-- /general -->

    <div
      v-show="tab === 'notifications'"
      id="settings-panel-notifications"
      class="preference-workspace"
      role="tabpanel"
      aria-labelledby="settings-tab-notifications"
    >
    <section class="panel">
      <div class="panel-head"><h3>{{ t('settings.channels') }}</h3><span class="count">{{ channels.length }}</span></div>
      <div class="panel-body">
        <p class="hint">{{ t('settings.channelsHint') }}</p>

        <ChannelAddForm :native-notify="serverInfo?.native_notify === true" @added="load" />
      </div>
      <div
        class="table-wrap"
        role="region"
        tabindex="0"
        :aria-label="t('settings.channels')"
      >
        <table class="data-table">
          <thead><tr><th>{{ t('settings.thName') }}</th><th>{{ t('settings.thType') }}</th><th>{{ t('settings.thConfig') }}</th><th class="center">{{ t('settings.thEnabled') }}</th><th class="center">
            {{ t('settings.thStormMerge') }}
            <InfoTip :text="t('settings.alertStorm.channelHint')" />
          </th><th></th></tr></thead>
          <tbody>
            <tr v-if="!channels.length"><td colspan="6" class="hint">{{ t('settings.noChannels') }}</td></tr>
            <template v-for="c in channels" :key="c.id">
              <tr>
                <td><input v-model="c.name" class="name-in" @blur="renameChannel(c)" /></td>
                <td><span class="badge neutral">{{ c.type }}</span></td>
                <td class="mono">{{ channelConfigLabel(c) }}</td>
                <td class="center"><input type="checkbox" :checked="c.enabled" @change="toggleChannel(c)" /></td>
                <td class="center">
                  <input
                    type="checkbox"
                    :checked="c.storm_merge"
                    :aria-label="t('settings.thStormMerge')"
                    @change="toggleStormMerge(c)"
                  />
                </td>
                <td class="row-actions">
                  <button
                    v-if="c.type === 'webhook'" class="link-btn"
                    @click="editingId = editingId === c.id ? '' : c.id">
                    {{ editingId === c.id ? t('settings.webhook.cancel') : t('settings.webhook.edit') }}
                  </button>
                  <button class="link-btn danger" @click="removeChannel(c.id)">{{ t('common.delete') }}</button>
                </td>
              </tr>
              <tr v-if="editingId === c.id" class="wh-edit-row">
                <td colspan="6">
                  <WebhookChannelForm
                    mode="edit"
                    :channel-id="c.id"
                    :enabled="c.enabled"
                    :storm-merge="c.storm_merge"
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

    <!-- Alert-storm suppression (ALERT-001). Sits under Notifications, not with
         the detector timings: it decides how many MESSAGES leave, never whether a
         fault is recorded. Every fault is in the fault centre either way. -->
    <section class="panel">
      <div class="panel-head"><h3>{{ t('settings.alertStorm.title') }}</h3></div>
      <div class="panel-body">
        <p class="hint">{{ t('settings.alertStorm.hint') }}</p>
        <div class="knobs">
          <label class="knob">
            <span class="knob-label">{{ t('settings.alertStorm.threshold') }}</span>
            <span class="knob-field">
              <input v-model.number="storm.threshold" type="number" min="0" max="50" />
              <span class="unit">{{ t('settings.alertStorm.unitFaults') }}</span>
            </span>
            <span class="knob-help hint">{{ t('settings.alertStorm.thresholdHelp') }}</span>
          </label>
          <label class="knob">
            <span class="knob-label">{{ t('settings.alertStorm.window') }}</span>
            <span class="knob-field">
              <input v-model.number="storm.windowS" type="number" min="30" max="3600" />
              <span class="unit">{{ t('settings.unit.seconds') }}</span>
            </span>
            <span class="knob-help hint">{{ t('settings.alertStorm.windowHelp') }}</span>
          </label>
        </div>
        <div class="row field-row">
          <button class="btn btn-primary" @click="saveStorm">{{ t('common.save') }}</button>
          <span v-if="stormSaved" class="hint saved">✓ {{ t('common.saved') }}</span>
        </div>
        <p v-if="stormError" class="err inline">{{ stormError }}</p>
      </div>
    </section>

    <!-- Non-blocking: no channel is a legal configuration, and detection is on
         regardless — say both plainly so it never reads as "nothing is watching". -->
    <p v-if="!channels.length" class="notice-box">{{ t('notificationPolicy.noChannelsNotice') }}</p>
    <p v-if="policyError" class="err">{{ policyError }}</p>

    <section class="panel">
      <div class="panel-head">
        <h3>{{ t('notificationPolicy.defaultTitle') }}</h3>
        <span class="badge neutral def-badge">{{ t('notificationPolicy.defaultBadge') }}</span>
      </div>
      <div class="panel-body">
        <p class="hint">{{ t('notificationPolicy.defaultHint') }}</p>
        <PolicyFields v-if="defaultDraft" v-model="defaultDraft" :channels="channels" :disabled="policyBusy" />
        <p v-else class="hint">{{ t('common.noData') }}</p>
        <div class="row field-row">
          <button class="btn btn-primary" :disabled="!defaultDraft || policyBusy" @click="saveDefaultPolicy">
            {{ t('common.save') }}
          </button>
          <span v-if="policySaved === 'default'" class="hint saved">✓ {{ t('common.saved') }}</span>
        </div>
      </div>
    </section>

    <section class="panel">
      <div class="panel-head">
        <h3>{{ t('notificationPolicy.overridesTitle') }}</h3>
        <span class="count">{{ overrides.length }}</span>
      </div>
      <div class="panel-body">
        <p class="hint">{{ t('notificationPolicy.overridesHint') }}</p>
      </div>
      <div
        class="table-wrap"
        role="region"
        tabindex="0"
        :aria-label="t('notificationPolicy.overridesTitle')"
      >
        <table class="data-table">
          <thead>
            <tr>
              <th>{{ t('notificationPolicy.thName') }}</th>
              <th>{{ t('notificationPolicy.thScope') }}</th>
              <th>{{ t('notificationPolicy.thMinSeverity') }}</th>
              <th>{{ t('notificationPolicy.thDelay') }}</th>
              <th>{{ t('notificationPolicy.thChannels') }}</th>
              <th class="center">{{ t('notificationPolicy.thRecovery') }}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!overrides.length"><td colspan="7" class="hint">{{ t('notificationPolicy.noOverrides') }}</td></tr>
            <template v-for="p in overrides" :key="p.id">
              <tr>
                <td>
                  {{ p.name }}
                  <span v-if="!p.enabled" class="badge warn">{{ t('notificationPolicy.stateDisabled') }}</span>
                </td>
                <td>{{ scopeLabel(p) }}</td>
                <td>{{ t(`mform.sev_${p.min_severity}`) }}</td>
                <td>{{ delayLabel(p.warn_delay_sec) }} / {{ delayLabel(p.critical_delay_sec) }}</td>
                <td :class="{ 'record-only': !p.channel_ids.length }">{{ channelsLabel(p.channel_ids) }}</td>
                <td class="center">
                  {{ p.notify_recovery ? t('notificationPolicy.yes') : t('notificationPolicy.no') }}
                </td>
                <td class="row-actions">
                  <button class="link-btn" @click="toggleEditPolicy(p)">
                    {{ editingPolicyId === p.id ? t('settings.webhook.cancel') : t('settings.webhook.edit') }}
                  </button>
                  <button class="link-btn danger" :disabled="policyBusy" @click="removePolicy(p)">
                    {{ t('common.delete') }}
                  </button>
                </td>
              </tr>
              <tr v-if="editingPolicyId === p.id" class="wh-edit-row">
                <td colspan="7">
                  <PolicyFields v-if="policyDraft" v-model="policyDraft" :channels="channels" :disabled="policyBusy" />
                  <p class="hint tiny">{{ t('notificationPolicy.scopeFixedHint') }}</p>
                  <div class="row field-row">
                    <button class="btn btn-primary" :disabled="policyBusy" @click="saveEditedPolicy(p)">
                      {{ t('common.save') }}
                    </button>
                    <button class="btn" :disabled="policyBusy" @click="toggleEditPolicy(p)">
                      {{ t('settings.webhook.cancel') }}
                    </button>
                    <span v-if="policySaved === p.id" class="hint saved">✓ {{ t('common.saved') }}</span>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </section>

    <section class="panel">
      <div class="panel-head"><h3>{{ t('notificationPolicy.previewTitle') }}</h3></div>
      <div class="panel-body">
        <p class="hint">{{ t('notificationPolicy.previewHint') }}</p>
        <div class="row field-row">
          <select v-model="previewTargetId" class="wide" @change="runPreview">
            <option value="">{{ t('notificationPolicy.previewPick') }}</option>
            <option v-for="tg in policyTargets" :key="tg.id" :value="tg.id">{{ targetOptionLabel(tg) }}</option>
          </select>
        </div>
        <div v-if="previewBusy" class="hint">{{ t('notificationPolicy.previewLoading') }}</div>
        <div v-else-if="preview" class="preview-box">
          <div class="sum-row">
            <span class="sum-k">{{ t('notificationPolicy.previewSource') }}</span>
            <span class="sum-v">{{ t(`notificationPolicy.source_${preview.source}`) }}</span>
          </div>
          <template v-if="preview.policy">
            <div class="sum-row">
              <span class="sum-k">{{ t('notificationPolicy.name') }}</span>
              <span class="sum-v">
                {{ preview.policy.name }}
                <em v-if="!preview.policy.enabled" class="off">{{ t('notificationPolicy.stateDisabled') }}</em>
              </span>
            </div>
            <div class="sum-row">
              <span class="sum-k">{{ t('notificationPolicy.minSeverity') }}</span>
              <span class="sum-v">{{ t(`mform.sev_${preview.policy.min_severity}`) }}</span>
            </div>
            <div class="sum-row">
              <span class="sum-k">{{ t('notificationPolicy.thDelay') }}</span>
              <span class="sum-v">
                {{ delayLabel(preview.policy.warn_delay_sec) }} / {{ delayLabel(preview.policy.critical_delay_sec) }}
              </span>
            </div>
            <div class="sum-row">
              <span class="sum-k">{{ t('notificationPolicy.notifyRecovery') }}</span>
              <span class="sum-v">
                {{ preview.policy.notify_recovery ? t('notificationPolicy.yes') : t('notificationPolicy.no') }}
              </span>
            </div>
            <div class="sum-row">
              <span class="sum-k">{{ t('notificationPolicy.channels') }}</span>
              <span class="sum-v" :class="{ 'record-only': !preview.policy.channel_ids.length }">
                {{ channelsLabel(preview.policy.channel_ids) }}
              </span>
            </div>
          </template>
          <p v-else class="hint">{{ t('notificationPolicy.previewNone') }}</p>
          <div class="sum-row" v-if="preview.chain.length">
            <span class="sum-k">{{ t('notificationPolicy.previewChain') }}</span>
            <span class="sum-v">{{ preview.chain.map((s) => t(`notificationPolicy.scope_${s}`)).join(' → ') }}</span>
          </div>
          <p class="hint tiny">{{ t('notificationPolicy.previewOneWinner') }}</p>
        </div>
      </div>
    </section>
    </div><!-- /notifications -->

    <div
      v-show="tab === 'data'"
      id="settings-panel-data"
      class="preference-workspace data-workspace"
      role="tabpanel"
      aria-labelledby="settings-tab-data"
    >
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

      <section class="panel">
        <div class="panel-head"><h3>{{ t('settings.deviceRetention.title') }}</h3></div>
        <div class="panel-body">
          <p class="hint">{{ t('settings.deviceRetention.hint') }}</p>
          <div class="knob-grid">
            <label class="knob">
              <span class="knob-label">{{ t('settings.deviceRetention.days') }}</span>
              <span class="knob-input">
                <input type="number" v-model.number="deviceRetention.days" min="0" max="365" step="1" />
                <span class="unit">{{ t('settings.unit.days') }}</span>
              </span>
              <span class="knob-help hint">{{ t('settings.deviceRetention.daysHelp') }}</span>
            </label>
            <label class="knob">
              <span class="knob-label">{{ t('settings.deviceRetention.randomDays') }}</span>
              <span class="knob-input">
                <input type="number" v-model.number="deviceRetention.randomDays" min="0" max="365" step="1" />
                <span class="unit">{{ t('settings.unit.days') }}</span>
              </span>
              <span class="knob-help hint">{{ t('settings.deviceRetention.randomDaysHelp') }}</span>
            </label>
          </div>
          <div class="row field-row">
            <button class="btn btn-primary" @click="saveDeviceRetention">{{ t('common.save') }}</button>
            <span v-if="deviceRetentionSaved" class="hint saved">✓ {{ t('common.saved') }}</span>
          </div>
          <p v-if="deviceRetentionError" class="err inline">{{ deviceRetentionError }}</p>
        </div>
      </section>

      <DataCleanup />
    </div>
  </main>
</template>

<style scoped>
/* Hallmark · designed-as-app · design-system: design.md · page: Settings */
.tabs {
  display: flex;
  gap: 6px;
  width: fit-content;
  max-width: 100%;
  margin-bottom: var(--space-md);
  padding: var(--space-3xs);
  overflow-x: auto;
  border: var(--rule-hair) solid var(--color-rule);
  border-radius: var(--radius-input);
  background: var(--color-glass-strong);
  box-shadow: var(--shadow-card);
  backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  scrollbar-width: none;
}
.tabs::-webkit-scrollbar { display: none; }
.tab {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 44px;
  padding: var(--space-2xs) var(--space-sm);
  border: none;
  background: transparent;
  color: var(--color-muted);
  border-radius: var(--radius-xs);
  font-size: var(--text-sm);
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition:
    color var(--dur-micro) var(--ease-out),
    background-color var(--dur-micro) var(--ease-out),
    transform var(--dur-micro) var(--ease-out);
}
.tab:hover,
.tab:focus-visible {
  color: var(--color-ink);
  background: var(--color-glass-hover);
}
.tab.active {
  color: var(--color-ink);
  background: var(--color-glass-hover);
  box-shadow: inset 0 0 0 var(--rule-hair) var(--color-rule-2);
}
.tab:focus-visible {
  outline: var(--rule-fine) solid var(--color-focus);
  outline-offset: var(--space-3xs);
}
.tab:active {
  transform: translateY(1px);
}
/* Neutralize the panel-head `.count` auto-margin when used as a tab badge. */
.tabs .count {
  margin-left: 2px;
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
.preference-workspace {
  width: 100%;
}
.preference-workspace > .panel:last-child {
  margin-bottom: 0;
}
.panel :deep(.panel) {
  background: var(--color-glass-subtle);
  box-shadow: none;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}
.panel-head {
  min-height: 52px;
  border-bottom-color: var(--color-rule);
}
.panel-head h3 {
  font-family: var(--font-display);
  letter-spacing: -0.018em;
}
.table-wrap {
  overflow-x: auto;
  border-top: 1px solid var(--border);
  overscroll-behavior-inline: contain;
  scrollbar-gutter: stable;
}
.table-wrap:focus-visible {
  outline: var(--rule-fine) solid var(--color-focus);
  outline-offset: calc(-1 * var(--rule-fine));
}
.data-table {
  min-width: 780px;
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
input {
  min-width: 140px;
}
input.wide {
  min-width: 320px;
  flex: 1;
}
select.wide {
  min-width: 320px;
}
.name-in {
  min-width: 120px;
}
.pw-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin: 14px 0 4px;
  max-width: 340px;
}
.pw-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.pw-field input {
  width: 100%;
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
.tiny {
  font-size: 11.5px;
  margin: 6px 0 0;
}
.def-badge {
  margin-left: auto;
}
/* Notification-policy tab */
.notice-box {
  margin: 0 0 16px;
  padding: 10px 13px;
  font-size: 13px;
  line-height: 1.55;
  color: var(--text-dim);
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-left: 3px solid var(--primary);
  border-radius: var(--radius-sm);
}
.preview-box {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px dashed var(--border);
}
.sum-row {
  display: flex;
  gap: 12px;
  align-items: baseline;
  padding: 3px 0;
  font-size: 13px;
}
.sum-k {
  flex: none;
  min-width: 132px;
  color: var(--text-dim);
}
.sum-v {
  color: var(--text);
}
.sum-v .off {
  margin-left: 8px;
  font-style: normal;
  font-size: 11.5px;
  color: var(--warning);
}
.record-only {
  color: var(--text-dim);
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

@media (max-width: 768px) {
  .settings-head {
    margin-bottom: var(--space-sm);
  }
  .settings-tabs {
    position: sticky;
    top: var(--space-xs);
    z-index: var(--z-sticky);
    width: 100%;
  }
  .settings-tabs .tab {
    flex: 1 0 auto;
  }
  .panel-body,
  .panel-head {
    padding-inline: var(--space-sm);
  }
  .knob-grid {
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-sm);
  }
  .sum-row {
    align-items: flex-start;
    flex-direction: column;
    gap: var(--space-3xs);
  }
  .sum-k {
    min-width: 0;
  }
}

@media (max-width: 414px) {
  input,
  input.wide,
  select.wide {
    min-width: 0;
    width: 100%;
    max-width: 100%;
  }
  .field-row > .btn {
    width: 100%;
  }
  .listen-modes {
    flex-direction: column;
    gap: var(--space-xs);
  }
  .row-actions {
    width: 100%;
    flex-wrap: wrap;
  }
  .panel-foot {
    align-items: stretch;
    flex-direction: column;
    padding-inline: var(--space-sm);
  }
  .panel-foot .btn {
    width: 100%;
  }
  .stat-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (prefers-reduced-motion: reduce) {
  .tab {
    transition-duration: var(--dur-micro);
  }
}
</style>

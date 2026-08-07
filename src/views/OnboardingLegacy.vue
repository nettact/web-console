<script setup lang="ts">
// First-run onboarding wizard. A full-screen bare view (rendered outside the app
// shell, like Login) that walks the user through: welcome → region select →
// recommended targets → notification channel → enroll an agent (hidden in desktop
// mode, which embeds the agent) → done. Every step is skippable and the whole flow
// is interruptible: progress is persisted server-side (src/onboarding.ts) so it
// resumes on the next login, on any device, at the saved step.
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { api, type Channel, type MonitorGroup, type ProbeTarget, type ServerInfo } from '../api'
import { onboarding, loadOnboarding, saveOnboarding } from '../onboarding'
import {
  REGIONS,
  STUN_SERVERS,
  buildSelection,
  defaultStunServer,
  detectRegion,
  isRegionID,
  presetExists,
  presetToTarget,
  type RegionID,
  type RegionPreset,
  type SelectionGroup,
} from '../lib/onboardingPresets'
import EnrollExamples from '../components/EnrollExamples.vue'
import ChannelEditor from '../components/ChannelEditor.vue'
import ChannelTypeMark from '../components/ChannelTypeMark.vue'
import { channelTypeDescriptor } from '../lib/channelTypes'
import { pushProvider } from '../lib/pushProviders'

const SITE = 'site_default'
const { t, locale } = useI18n()
const router = useRouter()

type Step = 'welcome' | 'region' | 'targets' | 'notify' | 'enroll' | 'done'

const serverInfo = ref<ServerInfo | null>(null)
const desktop = computed(() => serverInfo.value?.listen?.desktop === true)
// Whether the server can raise an OS-native toast (Windows/macOS only) — gates
// the "system" channel type.
const nativeNotify = computed(() => serverInfo.value?.native_notify === true)
// Enroll step is dropped in desktop mode (the desktop app embeds the agent).
const steps = computed<Step[]>(() => [
  'welcome',
  'region',
  'targets',
  'notify',
  ...(desktop.value ? [] : ['enroll'] as Step[]),
  'done',
])

const step = ref<Step>('welcome')
const stepIndex = computed(() => Math.max(0, steps.value.indexOf(step.value)))
const recommended = ref<RegionID | null>(null)
const selectedRegions = ref<Set<RegionID>>(new Set())
const ready = ref(false)

// Regions with the detected one (if any) pinned to the top and badged "recommended".
const orderedRegions = computed(() => {
  if (!recommended.value) return [...REGIONS]
  const rec = REGIONS.filter((r) => r.id === recommended.value)
  const rest = REGIONS.filter((r) => r.id !== recommended.value)
  return [...rec, ...rest]
})

onMounted(async () => {
  if (!onboarding.loaded) await loadOnboarding()
  try {
    serverInfo.value = await api.serverInfo()
  } catch {
    serverInfo.value = null
  }
  recommended.value = detectRegion()

  const s = onboarding.state
  if (!s) {
    // Never started: seed in_progress with the detected region pre-selected (if
    // any — local + global groups are always offered regardless).
    selectedRegions.value = recommended.value ? new Set([recommended.value]) : new Set()
    step.value = 'welcome'
    await persist('welcome')
  } else if (s.status === 'done') {
    // Re-run from Settings: restart at welcome, keep the previously chosen regions
    // exactly (including an intentionally empty selection).
    selectedRegions.value = new Set(s.regions.filter(isRegionID))
    step.value = 'welcome'
    await persist('welcome')
  } else {
    // Resume in-progress: restore the saved regions exactly (an empty set is a
    // deliberate "local checks only" choice, not an absence of one — do NOT
    // silently re-add the detected region) and the saved step if still valid.
    selectedRegions.value = new Set(s.regions.filter(isRegionID))
    const resumeStep = steps.value.includes(s.step as Step) ? (s.step as Step) : 'welcome'
    step.value = resumeStep
    // The targets/notify steps' data is normally loaded on entry from the previous
    // step; when we land on one directly (e.g. refresh), load it here too or it
    // stays stuck on "Loading…" with the Next button disabled.
    if (resumeStep === 'targets') await loadTargets()
    if (resumeStep === 'notify') await loadChannels()
  }
  ready.value = true
})

function selectedRegionList(): RegionID[] {
  // Preserve catalog order for a stable target list.
  return REGIONS.map((r) => r.id).filter((id) => selectedRegions.value.has(id))
}

async function persist(nextStep: Step, patch: Record<string, unknown> = {}): Promise<void> {
  try {
    await saveOnboarding({ status: 'in_progress', step: nextStep, regions: selectedRegionList(), ...patch })
  } catch {
    // Best-effort: a failed save must not block navigation within the wizard.
  }
}

function toggleRegion(id: RegionID): void {
  const next = new Set(selectedRegions.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selectedRegions.value = next
}

async function goNext(): Promise<void> {
  const idx = steps.value.indexOf(step.value)
  const next = steps.value[idx + 1]
  if (!next) return
  step.value = next
  await persist(next)
  // Reload on every entry (also when arriving via Back) so the step reflects
  // channels added elsewhere in the meantime.
  if (next === 'notify') await loadChannels()
}

async function goBack(): Promise<void> {
  const idx = steps.value.indexOf(step.value)
  const prev = steps.value[idx - 1]
  if (!prev) return
  step.value = prev
  await persist(prev)
  if (prev === 'notify') await loadChannels()
  if (prev === 'targets') await loadTargets()
}

async function skipAll(): Promise<void> {
  try {
    await saveOnboarding({ status: 'done', step: 'done', regions: selectedRegionList() })
  } catch {
    /* ignore — leaving is more important than recording it */
  }
  router.push('/')
}

async function finish(): Promise<void> {
  try {
    await saveOnboarding({ status: 'done', step: 'done', regions: selectedRegionList() })
  } catch {
    /* ignore */
  }
  router.push('/')
}

// ---- targets step ----
const existingTargets = ref<ProbeTarget[]>([])
const groups = ref<MonitorGroup[]>([])
const defaultGroupId = computed(() => groups.value.find((g) => g.is_default)?.id ?? '')
const targetsLoaded = ref(false)
const targetsError = ref('')
const applying = ref(false)
// preset key → checked, for presets that don't already exist.
const checks = ref<Record<string, boolean>>({})

// NAT STUN server: defaults by region (stun.miwifi.com only when cn is selected,
// since it is mainland-only) but the user can override it in the targets step.
const stunTouched = ref(false)
const stunServer = ref('')
const effectiveStun = computed(() => (stunTouched.value ? stunServer.value : defaultStunServer(selectedRegionList())))
function onStunChange(v: string): void {
  stunServer.value = v
  stunTouched.value = true
}

// The monitor-group buckets for the current region selection (local + global +
// one per selected region), each mapping to its own monitor group.
const selection = computed<SelectionGroup[]>(() => buildSelection(selectedRegionList()))

interface DisplayPreset {
  preset: RegionPreset
  exists: boolean
}
interface DisplayGroup {
  nameKey: string
  items: DisplayPreset[]
}

// One display section per bucket, in the order buildSelection returns them.
const displayGroups = computed<DisplayGroup[]>(() =>
  selection.value.map((g) => ({ nameKey: g.nameKey, items: g.presets.map(toDisplay) })),
)

function toDisplay(p: RegionPreset): DisplayPreset {
  return { preset: p, exists: presetExists(existingTargets.value, p) }
}

// presetLabel is the display/monitor name for a preset; backup (failover) presets
// get a suffix so they don't collide with their primary's name.
function presetLabel(p: RegionPreset): string {
  return p.backup ? `${t(p.nameKey)} ${t('setup.derpBackup')}` : t(p.nameKey)
}

async function loadTargets(): Promise<void> {
  targetsError.value = ''
  try {
    ;[existingTargets.value, groups.value] = await Promise.all([api.listTargets(SITE), api.monitorGroups(SITE)])
  } catch (e) {
    targetsError.value = String((e as Error).message || e)
    return
  }
  // Seed checkboxes: default-checked for new presets, off/disabled for existing.
  const next: Record<string, boolean> = {}
  for (const g of selection.value) {
    for (const p of g.presets) {
      next[p.key] = p.checked && !presetExists(existingTargets.value, p)
    }
  }
  checks.value = next
  targetsLoaded.value = true
}

// A preset is a live "will create" only when checked and not already on the site.
function isNew(p: RegionPreset): boolean {
  return !!checks.value[p.key] && !presetExists(existingTargets.value, p)
}

const anySelected = computed(() => selection.value.some((g) => g.presets.some(isNew)))

// Resolve the monitor group id for a bucket, creating the group if needed. The
// local bucket reuses the site's default group; global/region buckets get their
// own named group (matched by localized name so a re-run reuses it).
async function resolveGroupId(bucket: SelectionGroup): Promise<string> {
  if (bucket.key === 'local') return defaultGroupId.value
  const name = t(bucket.nameKey)
  const existing = groups.value.find((g) => g.name === name)
  if (existing) return existing.id
  const { id } = await api.createMonitorGroup(SITE, {
    name,
    merge_enabled: true,
    all_agents: true,
    agent_group_ids: [],
  })
  return id
}

// applyAndNext creates the checked, not-yet-existing presets as real targets in
// their respective monitor groups, adds an unavailable alarm to each group, then
// advances. Groups are created first (a target's group_id is a foreign key);
// setTargets is a full reconcile, so we merge the additions onto the existing list.
async function applyAndNext(): Promise<void> {
  if (!targetsLoaded.value) {
    await goNext()
    return
  }
  applying.value = true
  targetsError.value = ''
  try {
    const populated: Array<{ bucket: SelectionGroup; groupId: string }> = []
    const additions: ProbeTarget[] = []
    for (const bucket of selection.value) {
      const fresh = bucket.presets.filter(isNew)
      if (!fresh.length) continue
      const gid = await resolveGroupId(bucket)
      if (!gid) continue
      populated.push({ bucket, groupId: gid })
      for (const p of fresh) {
        // NAT uses the user-selected STUN server rather than the preset default.
        const preset = p.kind === 'nat' ? { ...p, target: effectiveStun.value } : p
        additions.push(presetToTarget(preset, gid, presetLabel(preset)))
      }
    }
    if (additions.length) {
      await api.setTargets(SITE, [...existingTargets.value, ...additions])
      ;[existingTargets.value, groups.value] = await Promise.all([api.listTargets(SITE), api.monitorGroups(SITE)])
      // Nothing further to configure: every saved target starts recording faults
      // on its own from the next probe round.
    }
    await goNext()
  } catch (e) {
    targetsError.value = String((e as Error).message || e)
  } finally {
    applying.value = false
  }
}

// When we arrive at the targets step, (re)load the site's targets and groups so
// dedupe and group resolution are fresh.
async function enterTargets(): Promise<void> {
  step.value = 'targets'
  targetsLoaded.value = false
  await persist('targets')
  await loadTargets()
}

async function goNextFromRegion(): Promise<void> {
  await enterTargets()
}

// ---- notify step ----
// Alert rules are created with an empty channel list, which the server resolves as
// "deliver to every enabled channel" — so this step only has to make sure at least
// one channel exists; nothing needs to be wired back into the rules.
const channels = ref<Channel[]>([])
const channelsLoaded = ref(false)
const notifyError = ref('')
const notifyApplying = ref(false)
const showChannelCreator = ref(false)
// A channel only receives alerts while it is enabled — notification.Notify filters
// on enabled=1 regardless of the rule's channel list — so a *disabled* system
// channel is not a working destination and must not suppress the recommendation.
const systemChannel = computed(() => channels.value.find((c) => c.type === 'system'))
const hasEnabledSystem = computed(() => systemChannel.value?.enabled === true)
// Desktop runs the server on the user's own machine, so an OS toast needs no setup
// and is the recommended default there. Elsewhere the server is on some other box,
// so a local toast would go unseen — the user supplies their own channel instead.
const suggestSystem = computed(() => desktop.value && nativeNotify.value)
// Whether to create the recommended system channel on "next" (pre-checked; the
// user can opt out). Only meaningful while the recommendation card is showing.
// sysTouched keeps an explicit opt-out from being undone when the step reloads
// (e.g. coming back from the enroll step) — same pattern as stunTouched above.
const sysWanted = ref(false)
const sysTouched = ref(false)
const sysLang = ref(locale.value.toLowerCase().startsWith('zh') ? 'zh' : 'en')
const showSysCard = computed(() => suggestSystem.value && !hasEnabledSystem.value)
const listedChannels = computed(() => showSysCard.value
  ? channels.value.filter((channel) => channel.type !== 'system')
  : channels.value)

function onSysToggle(v: boolean): void {
  sysWanted.value = v
  sysTouched.value = true
}

async function loadChannels(): Promise<void> {
  notifyError.value = ''
  let loaded: Channel[]
  try {
    loaded = await api.channels()
  } catch (e) {
    // Best-effort: a read failure must not trap the user on an optional step.
    // Show the reason and still offer the add form, but don't pre-check the
    // recommendation — we can't tell whether a system channel already exists.
    notifyError.value = String((e as Error).message || e)
    channels.value = []
    channelsLoaded.value = true
    sysWanted.value = false
    sysTouched.value = true
    return
  }
  channels.value = loaded
  channelsLoaded.value = true
  // Carry over the language of a disabled system channel we're about to re-enable,
  // so the card shows what it will actually be set to.
  const lang = systemChannel.value?.config.lang
  if (lang === 'zh' || lang === 'en') sysLang.value = lang
  if (!sysTouched.value) sysWanted.value = showSysCard.value
}

function onboardingChannelTypeLabel(channel: Channel): string {
  const descriptor = channelTypeDescriptor(channel.type)
  return descriptor.labelKey ? t(descriptor.labelKey) : channel.type
}

function onboardingChannelTarget(channel: Channel): string {
  if (channel.type === 'webhook') return channel.config.url || 'Webhook'
  if (channel.type === 'email') return channel.config.to || 'Email'
  if (channel.type === 'system') return t('settings.sysNotifyConfig')
  const provider = pushProvider(channel.type)
  if (!provider) return onboardingChannelTypeLabel(channel)
  return provider.summaryKeys.map((key) => channel.config[key]).filter(Boolean).join(' · ') || onboardingChannelTypeLabel(channel)
}

async function onOnboardingChannelAdded(): Promise<void> {
  await loadChannels()
  showChannelCreator.value = false
}

// wireChannelsToPolicy adds the channels created in this wizard to the site's
// default notification policy. Detection already runs regardless; this is the
// step that decides anyone hears about it. Adding them here is not a silent
// opt-in — the user created the channel moments ago in this very flow — and it
// is idempotent, so a re-run never duplicates or drops a hand-picked channel.
async function wireChannelsToPolicy(): Promise<void> {
  const ids = channels.value.filter((c) => c.enabled).map((c) => c.id)
  if (!ids.length) return
  try {
    const policies = await api.notificationPolicies(SITE)
    const def = policies.find((p) => p.is_default)
    if (!def) return
    const merged = [...def.channel_ids, ...ids.filter((id) => !def.channel_ids.includes(id))]
    if (merged.length === def.channel_ids.length) return
    await api.updateNotificationPolicy(def.id, {
      name: def.name,
      scope_kind: def.scope_kind,
      scope_id: def.scope_id,
      enabled: def.enabled,
      min_severity: def.min_severity,
      warn_delay_sec: def.warn_delay_sec,
      critical_delay_sec: def.critical_delay_sec,
      notify_recovery: def.notify_recovery,
      channel_ids: merged,
    })
  } catch {
    // Best-effort: never block onboarding on notification wiring. Faults are
    // recorded either way, and the policy page can wire the channel later.
  }
}

// applyNotifyAndNext turns on the recommended system notification when it is still
// checked, points the wizard's outage rules at the resulting channels, then
// advances. A failure keeps the user on the step with the reason; every step here
// is idempotent, so pressing the button again resumes rather than duplicates.
// A disabled system channel is re-enabled rather than duplicated.
async function applyNotifyAndNext(): Promise<void> {
  notifyApplying.value = true
  notifyError.value = ''
  try {
    if (showSysCard.value && sysWanted.value) {
      const existing = systemChannel.value
      if (existing) {
        await api.updateChannel(existing.id, {
          name: existing.name,
          enabled: true,
          storm_merge: existing.storm_merge,
          config: { lang: sysLang.value },
        })
      } else {
        await api.createChannel(t('settings.sysNotify'), 'system', { lang: sysLang.value }, true)
      }
      // Re-read so the new channel's id is available to wireChannelsToPolicy, and
      // so coming back doesn't re-offer the card.
      channels.value = await api.channels()
      sysTouched.value = true
    }
    await wireChannelsToPolicy()
  } catch (e) {
    notifyError.value = String((e as Error).message || e)
    return
  } finally {
    notifyApplying.value = false
  }
  await goNext()
}

// ---- enroll step ----
const enrollToken = ref('')
const enrollError = ref('')
async function genToken(): Promise<void> {
  enrollError.value = ''
  try {
    const r = await api.createToken('onboarding')
    enrollToken.value = r.token
  } catch (e) {
    enrollError.value = String((e as Error).message || e)
  }
}
</script>

<template>
  <div class="wrap">
    <div class="glow"></div>
    <div class="card wizard" v-if="ready">
      <header class="wiz-head">
        <div class="brand">
          <span class="mark">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2"
              stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 12h3l2.5 7 5-15L18 12h3" />
            </svg>
          </span>
          <div class="brand-text">
            <b>NetTact</b>
            <small>{{ t('setup.title') }}</small>
          </div>
        </div>
        <button class="btn btn-ghost skip" @click="skipAll">{{ t('setup.skipAll') }}</button>
      </header>

      <ol class="dots" :aria-label="t('setup.title')">
        <li v-for="(s, i) in steps" :key="s" :class="{ active: i === stepIndex, done: i < stepIndex }">
          <span class="dot"></span>
          <span class="dot-label">{{ t('setup.step_' + s) }}</span>
        </li>
      </ol>

      <!-- welcome -->
      <section v-if="step === 'welcome'" class="panel step welcome-step">
        <p class="welcome-eyebrow">{{ t('setup.welcomeEyebrow') }}</p>
        <h1>{{ t('setup.welcomeTitle') }}</h1>
        <p class="lead">{{ t('setup.welcomeBody') }}</p>
        <div class="welcome-benefits">
          <div class="welcome-benefit">
            <span class="benefit-icon">
              <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.8">
                <circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2" />
                <path d="M12 2v3M22 12h-3M12 22v-3M2 12h3" />
              </svg>
            </span>
            <span>{{ t('setup.benefitTargets') }}</span>
          </div>
          <div class="welcome-benefit">
            <span class="benefit-icon">
              <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.8"
                stroke-linecap="round" stroke-linejoin="round">
                <path d="M8 12h8M12 8v8" /><path d="M7 4h10l3 4v10l-3 2H7l-3-2V8z" />
              </svg>
            </span>
            <span>{{ t('setup.benefitAgent') }}</span>
          </div>
          <div class="welcome-benefit">
            <span class="benefit-icon">
              <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.8"
                stroke-linecap="round" stroke-linejoin="round">
                <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 8h18c0-1-3-1-3-8" /><path d="M10 20h4" />
              </svg>
            </span>
            <span>{{ t('setup.benefitAlerts') }}</span>
          </div>
        </div>
      </section>

      <!-- region (multi-select) -->
      <section v-else-if="step === 'region'" class="panel step">
        <h1>{{ t('setup.regionTitle') }}</h1>
        <p class="lead">{{ t('setup.regionHint') }}</p>
        <div class="region-grid">
          <label
            v-for="r in orderedRegions"
            :key="r.id"
            class="region-card"
            :class="{ picked: selectedRegions.has(r.id) }"
          >
            <span class="region-top">
              <input type="checkbox" :checked="selectedRegions.has(r.id)" @change="toggleRegion(r.id)" />
              <span class="region-name">{{ t(r.labelKey) }}</span>
            </span>
            <span v-if="r.id === recommended" class="badge badge-rec">{{ t('setup.recommended') }}</span>
          </label>
        </div>
      </section>

      <!-- targets -->
      <section v-else-if="step === 'targets'" class="panel step">
        <h1>{{ t('setup.targetsTitle') }}</h1>
        <p class="lead">{{ t('setup.targetsHint') }}</p>
        <p v-if="targetsError" class="err">{{ targetsError }}</p>
        <p v-if="!targetsLoaded && !targetsError" class="muted">{{ t('setup.loading') }}</p>
        <div v-for="g in displayGroups" :key="g.nameKey" class="tgt-group">
          <h3>{{ t(g.nameKey) }}</h3>
          <label
            v-for="d in g.items"
            :key="d.preset.key"
            class="tgt-row"
            :class="{ disabled: d.exists }"
          >
            <input
              type="checkbox"
              :checked="d.exists ? false : checks[d.preset.key]"
              :disabled="d.exists"
              @change="checks[d.preset.key] = ($event.target as HTMLInputElement).checked"
            />
            <span class="tgt-kind badge">{{ d.preset.kind }}</span>
            <span class="tgt-name">{{ presetLabel(d.preset) }}</span>
            <template v-if="d.preset.kind === 'nat' && !d.exists">
              <span class="tgt-nat-label">{{ t('setup.natServer') }}</span>
              <select
                class="tgt-nat-select"
                :value="effectiveStun"
                @change="onStunChange(($event.target as HTMLSelectElement).value)"
                @click.stop
              >
                <option v-for="s in STUN_SERVERS" :key="s" :value="s">{{ s }}</option>
              </select>
            </template>
            <span v-else class="tgt-target">{{ d.preset.target }}</span>
            <span v-if="d.exists" class="badge badge-exists">{{ t('setup.alreadyExists') }}</span>
          </label>
        </div>
      </section>

      <!-- notify -->
      <section v-else-if="step === 'notify'" class="panel step">
        <h1>{{ t('setup.notifyTitle') }}</h1>
        <p class="lead">{{ t('setup.notifyHint') }}</p>
        <p v-if="notifyError" class="err">{{ notifyError }}</p>
        <p v-if="!channelsLoaded && !notifyError" class="muted">{{ t('setup.loading') }}</p>

        <!-- Desktop: the OS toast needs no configuration, so it's pre-checked. -->
        <label v-if="showSysCard" class="sys-card" :class="{ picked: sysWanted }">
          <input
            type="checkbox"
            :checked="sysWanted"
            @change="onSysToggle(($event.target as HTMLInputElement).checked)"
          />
          <ChannelTypeMark type="system" />
          <span class="sys-body">
            <span class="sys-title">
              {{ t('settings.sysNotify') }}
              <span class="badge badge-rec">{{ t('setup.recommended') }}</span>
            </span>
            <span class="sys-hint">{{ t('setup.notifySystemHint') }}</span>
          </span>
          <select v-model="sysLang" class="sys-lang" :title="t('settings.langLabel')" @click.stop>
            <option value="zh">中文</option>
            <option value="en">English</option>
          </select>
        </label>

        <div v-if="listedChannels.length" class="ch-existing">
          <h3>{{ t('setup.notifyExisting') }}</h3>
          <div class="ch-existing-list">
            <div v-for="channel in listedChannels" :key="channel.id" class="ch-existing-row" :class="{ off: !channel.enabled }">
              <ChannelTypeMark :type="channel.type" size="sm" />
              <span class="ch-existing-copy">
                <strong>{{ channel.name }}</strong>
                <small>{{ onboardingChannelTarget(channel) }}</small>
              </span>
              <span class="ch-existing-state" :class="{ enabled: channel.enabled }">
                {{ channel.enabled ? t('setup.notifyWillReceive') : t('setup.notifyDisabled') }}
              </span>
            </div>
          </div>
        </div>

        <div v-if="channelsLoaded" class="ch-create">
          <button v-if="!showChannelCreator" type="button" class="btn ch-create-open" @click="showChannelCreator = true">
            <span aria-hidden="true">+</span>
            {{ showSysCard || channels.length ? t('setup.notifyAddAction') : t('setup.notifyAdd') }}
          </button>
          <div v-else class="ch-create-flow">
            <div class="ch-create-head">
              <h3>{{ t('setup.notifyAddOther') }}</h3>
              <button type="button" class="link-btn" @click="showChannelCreator = false">{{ t('settings.webhook.cancel') }}</button>
            </div>
            <ChannelEditor
              :native-notify="nativeNotify"
              :exclude="showSysCard ? ['system'] : []"
              @added="onOnboardingChannelAdded"
            />
          </div>
        </div>
        <p class="muted skip-hint">{{ t('setup.notifySkipHint') }}</p>
      </section>

      <!-- enroll (skipped in desktop mode) -->
      <section v-else-if="step === 'enroll'" class="panel step">
        <h1>{{ t('setup.enrollTitle') }}</h1>
        <p class="lead">{{ t('setup.enrollHint') }}</p>
        <div class="enroll-actions">
          <button class="btn btn-primary" @click="genToken">{{ t('setup.genToken') }}</button>
          <span v-if="enrollToken" class="muted">{{ t('setup.tokenOnce') }}</span>
          <span v-if="enrollError" class="err">{{ enrollError }}</span>
        </div>
        <EnrollExamples class="enroll-examples" :token="enrollToken" />
      </section>

      <!-- done -->
      <section v-else-if="step === 'done'" class="panel step">
        <h1>{{ t('setup.doneTitle') }}</h1>
        <p class="lead">{{ t('setup.doneBody') }}</p>
      </section>

      <footer class="wiz-nav">
        <button v-if="stepIndex > 0 && step !== 'done'" class="btn btn-ghost" @click="goBack">
          {{ t('setup.back') }}
        </button>
        <span class="spacer"></span>
        <template v-if="step === 'welcome'">
          <button class="btn btn-primary welcome-action" @click="goNext">
            {{ t('setup.begin') }}
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2"
              stroke-linecap="round" stroke-linejoin="round">
              <path d="m9 18 6-6-6-6" />
            </svg>
          </button>
        </template>
        <template v-else-if="step === 'region'">
          <button class="btn btn-primary" @click="goNextFromRegion">{{ t('setup.next') }}</button>
        </template>
        <template v-else-if="step === 'targets'">
          <button class="btn btn-primary" :disabled="applying || !targetsLoaded" @click="applyAndNext">
            {{ applying ? t('setup.applying') : anySelected ? t('setup.applyNext') : t('setup.next') }}
          </button>
        </template>
        <template v-else-if="step === 'notify'">
          <button class="btn btn-primary" :disabled="notifyApplying || !channelsLoaded" @click="applyNotifyAndNext">
            {{ notifyApplying ? t('setup.applying') : showSysCard && sysWanted ? t('setup.applyNext') : t('setup.next') }}
          </button>
        </template>
        <template v-else-if="step === 'enroll'">
          <button class="btn btn-primary" @click="goNext">{{ t('setup.next') }}</button>
        </template>
        <template v-else-if="step === 'done'">
          <button class="btn btn-primary" @click="finish">{{ t('setup.enterConsole') }}</button>
        </template>
      </footer>
      <p v-if="step === 'welcome'" class="privacy-note">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8"
          stroke-linecap="round" stroke-linejoin="round">
          <rect x="5" y="10" width="14" height="10" rx="2" />
          <path d="M8 10V7a4 4 0 0 1 8 0v3" />
        </svg>
        {{ t('setup.privacyNote') }}
      </p>
    </div>
  </div>
</template>

<style scoped>
.wrap {
  position: relative;
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 24px;
  overflow: hidden;
}
.glow {
  position: absolute;
  width: 520px;
  height: 520px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(56, 189, 248, 0.22), transparent 60%);
  filter: blur(20px);
  top: -120px;
  pointer-events: none;
}
.wizard {
  position: relative;
  width: 680px;
  max-width: 100%;
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 28px 30px 24px;
}
.wiz-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.brand {
  display: flex;
  align-items: center;
  gap: 12px;
}
.mark {
  display: grid;
  place-items: center;
  width: 42px;
  height: 42px;
  border-radius: 12px;
  color: #04121c;
  background: linear-gradient(150deg, #7dd3fc, var(--primary-strong));
  box-shadow: 0 10px 26px -8px var(--primary-glow);
}
.brand-text {
  display: flex;
  flex-direction: column;
  line-height: 1.25;
}
.brand-text b {
  font-size: 17px;
}
.brand-text small {
  font-size: 12px;
  color: var(--text-muted);
}
.dots {
  display: flex;
  gap: 6px;
  list-style: none;
  padding: 0;
  margin: 0;
  flex-wrap: wrap;
}
.dots li {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-muted);
  flex: 1;
  min-width: 90px;
}
.dots .dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--border);
  flex-shrink: 0;
}
.dots li.active .dot {
  background: var(--primary);
}
.dots li.done .dot {
  background: var(--primary-strong);
}
.dots li.active .dot-label {
  color: var(--text);
  font-weight: 600;
}
.step {
  min-height: 260px;
}
.step h1 {
  font-size: 20px;
  margin: 0 0 6px;
}
.lead {
  margin: 0 0 14px;
  color: var(--text-dim);
  font-size: 13.5px;
}
.muted {
  color: var(--text-muted);
  font-size: 13px;
}
.welcome-eyebrow {
  margin: 0 0 11px;
  color: var(--color-accent-text);
  font-size: 12px;
  font-weight: 650;
  letter-spacing: 0.08em;
}
.welcome-benefits {
  display: grid;
  margin-top: 24px;
}
.welcome-benefit {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 11px 0;
  color: var(--text);
  border-bottom: 1px solid var(--border);
  font-size: 13.5px;
  font-weight: 550;
}
.welcome-benefit:last-child {
  border-bottom: 0;
}
.benefit-icon {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  flex: 0 0 40px;
  color: var(--color-accent-text);
  border: 1px solid rgba(56, 189, 248, 0.28);
  border-radius: 10px;
  background: rgba(56, 189, 248, 0.06);
}
.welcome-action {
  gap: 9px;
}
.privacy-note {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  margin: -5px 0 0;
  color: var(--text-muted);
  font-size: 10.5px;
}
.privacy-note svg {
  flex: 0 0 auto;
}
.welcome-step .lead {
  max-width: 500px;
}
.welcome-step h1 {
  font-size: 30px;
  line-height: 1.25;
  letter-spacing: -0.03em;
}
.region-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 10px;
}
.region-card {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 6px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 10px;
  cursor: pointer;
}
.region-card.picked {
  border-color: var(--primary);
  background: var(--surface-2, rgba(56, 189, 248, 0.06));
}
.region-top {
  display: flex;
  align-items: center;
  gap: 8px;
}
.region-name {
  flex: 1;
}
.badge-rec {
  align-self: flex-start;
  background: var(--primary);
  color: #04121c;
  font-size: 10px;
  padding: 1px 8px;
}
.tgt-group {
  margin-bottom: 14px;
}
.tgt-group h3 {
  font-size: 13px;
  color: var(--text-dim);
  margin: 0 0 6px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.tgt-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
}
.tgt-row:hover {
  background: var(--surface-2, rgba(148, 163, 184, 0.08));
}
.tgt-row.disabled {
  opacity: 0.55;
  cursor: default;
}
.tgt-kind {
  text-transform: uppercase;
  font-size: 10.5px;
  min-width: 58px;
  text-align: center;
}
.tgt-name {
  flex: 1;
}
.tgt-target {
  color: var(--text-muted);
  font-size: 12.5px;
  font-family: var(--mono, monospace);
}
.tgt-nat-label {
  color: var(--text-muted);
  font-size: 12px;
}
.tgt-nat-select {
  font-size: 12.5px;
  padding: 3px 6px;
}
.badge-exists {
  background: var(--border);
  color: var(--text-muted);
}
.sys-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  border: 1px solid var(--border);
  border-radius: 10px;
  cursor: pointer;
}
.sys-card.picked {
  border-color: var(--primary);
  background: var(--surface-2, rgba(56, 189, 248, 0.06));
}
.sys-body {
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex: 1;
  min-width: 0;
}
.sys-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
}
.sys-hint {
  color: var(--text-muted);
  font-size: 12.5px;
}
.sys-lang {
  flex: 0 0 auto;
  font-size: 12.5px;
  padding: 3px 6px;
}
.ch-existing {
  margin-top: 16px;
}
.ch-existing h3,
.ch-create-head h3 {
  font-size: 13px;
  color: var(--text-dim);
  margin: 0 0 6px;
  letter-spacing: 0;
}
.ch-existing-list {
  border-top: 1px solid var(--border);
}
.ch-existing-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 58px;
  padding: 9px 2px;
  border-bottom: 1px solid var(--border);
}
.ch-existing-row.off { opacity: .62; }
.ch-existing-copy {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 2px;
}
.ch-existing-copy strong,
.ch-existing-copy small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ch-existing-copy strong { color: var(--text); font-size: 13px; }
.ch-existing-copy small {
  color: var(--text-muted);
  font-family: var(--mono, var(--font-outlier));
  font-size: 11.5px;
}
.ch-existing-state {
  flex: 0 0 auto;
  color: var(--text-muted);
  font-size: 10.5px;
  white-space: nowrap;
}
.ch-existing-state.enabled { color: var(--color-success-text); }
.ch-create { margin-top: 18px; }
.ch-create-open { gap: 7px; width: 100%; }
.ch-create-flow {
  padding-top: 14px;
  border-top: 1px solid var(--border);
}
.ch-create-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}
.ch-create-head h3 { margin: 0; }
.skip-hint {
  margin-top: 16px;
}
@media (max-width: 520px) {
  .sys-card { align-items: flex-start; flex-wrap: wrap; }
  .sys-card > input { margin-top: 10px; }
  .sys-lang { margin-left: calc(44px + 12px); }
  .ch-existing-row { align-items: flex-start; }
  .ch-existing-state { width: 100%; padding-left: 42px; }
  .ch-existing-row { flex-wrap: wrap; }
}
.enroll-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.enroll-examples {
  display: block;
}
.wiz-nav {
  display: flex;
  align-items: center;
  gap: 10px;
  border-top: 1px solid var(--border);
  padding-top: 16px;
}
.spacer {
  flex: 1;
}
.err {
  color: var(--danger, #f87171);
  font-size: 13px;
  margin: 4px 0;
}
</style>

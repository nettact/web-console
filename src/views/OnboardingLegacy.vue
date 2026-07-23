<script setup lang="ts">
// First-run onboarding wizard. A full-screen bare view (rendered outside the app
// shell, like Login) that walks the user through: welcome → region select →
// recommended targets → enroll an agent (hidden in desktop mode, which embeds the
// agent) → done. Every step is skippable and the whole flow is interruptible:
// progress is persisted server-side (src/onboarding.ts) so it resumes on the next
// login, on any device, at the saved step.
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { api, type MonitorGroup, type ProbeTarget, type RuleConditionInput, type ServerInfo } from '../api'
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
import { unavailablePreset } from '../lib/conditionPresets'
import EnrollExamples from '../components/EnrollExamples.vue'

const SITE = 'site_default'
const { t } = useI18n()
const router = useRouter()

type Step = 'welcome' | 'region' | 'targets' | 'enroll' | 'done'

const serverInfo = ref<ServerInfo | null>(null)
const desktop = computed(() => serverInfo.value?.listen?.desktop === true)
// Enroll step is dropped in desktop mode (the desktop app embeds the agent).
const steps = computed<Step[]>(() => ['welcome', 'region', 'targets', ...(desktop.value ? [] : ['enroll'] as Step[]), 'done'])

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
    // The targets step's data is normally loaded on entry from the region step;
    // when we land on it directly (e.g. refresh), load it here too or it stays
    // stuck on "Loading…" with the Next button disabled.
    if (resumeStep === 'targets') await loadTargets()
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
}

async function goBack(): Promise<void> {
  const idx = steps.value.indexOf(step.value)
  const prev = steps.value[idx - 1]
  if (!prev) return
  step.value = prev
  await persist(prev)
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

// ensureUnavailableRule adds an "unavailable" (outage) alarm to a monitor group:
// an OR rule with one down/unreachable condition per target in the group. Skips
// the group if it already has a rule with this name (idempotent on re-run). The
// STUN target for a nat probe is stored under the user-chosen server, so its
// down condition (probe.nat.ok < 1) applies regardless.
async function ensureUnavailableRule(groupId: string, layer: string): Promise<void> {
  const name = t('setup.ruleUnavailable')
  let existing
  try {
    existing = await api.groupRules(groupId)
  } catch {
    return // best-effort: never block onboarding on rule setup
  }
  if (existing.some((r) => r.name === name)) return
  const conditions: RuleConditionInput[] = []
  for (const m of existingTargets.value) {
    if (m.group_id !== groupId || !m.id) continue
    const p = unavailablePreset(m)
    if (!p) continue
    conditions.push({
      target_id: m.id,
      metric_kind: p.metric,
      comparator: p.comparator,
      threshold: p.fixed ?? 0,
      fail_threshold: 3,
      for_seconds: 0,
    })
  }
  if (!conditions.length) return
  await api.createGroupRule(groupId, {
    name,
    op: 'or',
    layer,
    severity: 'error',
    channel_ids: [],
    enabled: true,
    conditions,
  })
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
      // Add an outage alarm to each populated group (targets now have server ids).
      for (const { bucket, groupId } of populated) {
        await ensureUnavailableRule(groupId, bucket.key === 'local' ? 'lan' : 'internet')
      }
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

// ---- enroll step ----
const enrollToken = ref('')
const enrollError = ref('')
const serverUrl = window.location.origin
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

      <!-- enroll (skipped in desktop mode) -->
      <section v-else-if="step === 'enroll'" class="panel step">
        <h1>{{ t('setup.enrollTitle') }}</h1>
        <p class="lead">{{ t('setup.enrollHint') }}</p>
        <div class="enroll-actions">
          <button class="btn btn-primary" @click="genToken">{{ t('setup.genToken') }}</button>
          <span v-if="enrollToken" class="muted">{{ t('setup.tokenOnce') }}</span>
          <span v-if="enrollError" class="err">{{ enrollError }}</span>
        </div>
        <EnrollExamples class="enroll-examples" :server-url="serverUrl" :token="enrollToken" />
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
  color: var(--primary);
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
  color: var(--primary);
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

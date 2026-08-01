<script setup lang="ts">
// Game profiles: which executables the site treats as a game, what each one is
// aiming at, how deeply to instrument it, and which monitors describe the network
// it is played over.
//
// A profile is capture configuration, not a display filter: saving one changes
// what the agents record from that moment on. Runs already stored keep the
// profile they were captured under, which is why deleting a profile here does not
// erase its runs — they simply lose the name.
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { api, type GameProfile, type GameProfileInput, type GameProfileTier, type ProbeTarget } from '../api'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import InfoTip from '../components/InfoTip.vue'
import { toDateLocale } from '../i18n'
import { targetLabel, typeLabel } from '../lib/targetLabels'
import { pushToast } from '../toasts'

const { t, locale } = useI18n()
const route = useRoute()

const SITE = 'site_default'

// The frame-rate goals a display actually offers. Anything else is typed in, so
// the list stays a shortcut rather than a limit.
const FPS_PRESETS = [30, 60, 90, 120, 144, 165, 240]

const profiles = ref<GameProfile[]>([])
const monitors = ref<ProbeTarget[]>([])
const recordUnmatched = ref(true)
const loading = ref(true)
const busy = ref(false)
const error = ref('')

const fmtUnix = (sec: number) => new Date(sec * 1000).toLocaleString(toDateLocale(locale.value), { hour12: false })

// Only what the run's network timeline can actually chart. That section plots
// ICMP round-trip and loss, so a gateway or ICMP monitor is the whole of what a
// link here can do — offering a TCP/DNS/HTTP/NAT monitor would let someone
// configure a link that silently draws nothing.
const TIMELINE_KINDS = ['gateway', 'icmp']
const linkableMonitors = computed(() => monitors.value.filter((m) => !!m.id && TIMELINE_KINDS.includes(m.kind)))
const monitorName = (m: ProbeTarget) => m.name?.trim() || targetLabel(m, t)
const monitorById = computed(() => new Map(linkableMonitors.value.map((m) => [m.id as string, m])))

// A profile can reference a monitor that has since been deleted. The count is of
// what the profile still points at; the names shown are the ones that resolve, so
// a stale link reads as a missing name rather than as a monitor that exists.
function monitorNames(p: GameProfile): string {
  const names = p.monitor_ids.map((id) => monitorById.value.get(id)).filter(Boolean) as ProbeTarget[]
  return names.map(monitorName).join(t('gameProfiles.listSep'))
}

const tierLabel = (tier: GameProfileTier) =>
  tier === 'diag' ? t('gameProfiles.tierDiag') : t('gameProfiles.tierBase')

async function load() {
  loading.value = true
  try {
    const [list, targets, collection] = await Promise.all([
      api.gameProfiles(SITE),
      api.listTargets(SITE),
      api.gameCollection(SITE),
    ])
    profiles.value = list.items
    monitors.value = targets
    recordUnmatched.value = collection.record_unmatched
    error.value = ''
  } catch (e) {
    error.value = String((e as Error).message || e)
  } finally {
    loading.value = false
  }
}

// ---- site-wide capture policy ----
// Strict mode is the one setting here that can make data disappear, so the switch
// writes through immediately and reverts on failure rather than leaving the UI
// claiming a policy the server never accepted.
async function onRecordUnmatchedChange(e: Event) {
  const next = (e.target as HTMLInputElement).checked
  const previous = recordUnmatched.value
  recordUnmatched.value = next
  busy.value = true
  error.value = ''
  try {
    const saved = await api.setGameCollection(SITE, { record_unmatched: next })
    recordUnmatched.value = saved.record_unmatched
  } catch (err) {
    recordUnmatched.value = previous
    error.value = String((err as Error).message || err)
  } finally {
    busy.value = false
  }
}

// ---- create / edit ----
interface Form {
  name: string
  exe: string[]
  // '' = no goal declared, 'custom' = the number beside it. Kept as a string so
  // "no goal" stays distinguishable from 0 rather than collapsing into it.
  fpsChoice: string
  fpsCustom: string
  tier: GameProfileTier
  monitorIds: string[]
}
const form = reactive<Form>({ name: '', exe: [], fpsChoice: '', fpsCustom: '', tier: 'base', monitorIds: [] })
const editing = ref<GameProfile | null>(null)

const formOpen = ref(false)
const formError = ref('')
const exeDraft = ref('')

function resetForm() {
  form.name = ''
  form.exe = []
  form.fpsChoice = ''
  form.fpsCustom = ''
  form.tier = 'base'
  form.monitorIds = []
  exeDraft.value = ''
  formError.value = ''
}

function openCreate(prefill?: { exe?: string; name?: string }) {
  editing.value = null
  resetForm()
  if (prefill?.exe) form.exe = [prefill.exe]
  if (prefill?.name) form.name = prefill.name
  formOpen.value = true
}

function openEdit(p: GameProfile) {
  editing.value = p
  resetForm()
  form.name = p.name
  form.exe = [...p.exe]
  form.tier = p.tier
  form.monitorIds = [...p.monitor_ids]
  if (p.target_fps === null) form.fpsChoice = ''
  else if (FPS_PRESETS.includes(p.target_fps)) form.fpsChoice = String(p.target_fps)
  else {
    form.fpsChoice = 'custom'
    form.fpsCustom = String(p.target_fps)
  }
  formOpen.value = true
}

function closeForm() {
  formOpen.value = false
  editing.value = null
  resetForm()
}

function addExe() {
  const raw = exeDraft.value.trim()
  if (!raw) return
  if (form.exe.some((e) => e.toLowerCase() === raw.toLowerCase())) {
    exeDraft.value = ''
    return
  }
  form.exe.push(raw)
  exeDraft.value = ''
}
function removeExe(name: string) {
  form.exe = form.exe.filter((e) => e !== name)
}
function toggleMonitor(id: string) {
  const i = form.monitorIds.indexOf(id)
  if (i >= 0) form.monitorIds.splice(i, 1)
  else form.monitorIds.push(id)
}

// null means no frame-rate goal was declared. It is not 0 and it is not the
// display's refresh rate — nothing here may guess one on the user's behalf.
function targetFps(): number | null {
  if (form.fpsChoice === '') return null
  if (form.fpsChoice !== 'custom') return Number(form.fpsChoice)
  const n = Number(form.fpsCustom.trim())
  return Number.isFinite(n) ? Math.round(n) : NaN
}

function payload(): GameProfileInput | null {
  const name = form.name.trim()
  if (!name) {
    formError.value = t('gameProfiles.errNameRequired')
    return null
  }
  // A profile with no executable matches nothing, so it would sit in the list
  // looking configured while never claiming a single process.
  if (!form.exe.length) {
    formError.value = t('gameProfiles.errExeRequired')
    return null
  }
  const fps = targetFps()
  if (fps !== null && (!Number.isFinite(fps) || fps <= 0)) {
    formError.value = t('gameProfiles.errFpsInvalid')
    return null
  }
  return { name, exe: [...form.exe], target_fps: fps, tier: form.tier, monitor_ids: [...form.monitorIds] }
}

async function save() {
  formError.value = ''
  // A name typed but never added would be silently dropped on save, so fold the
  // pending entry in first.
  if (exeDraft.value.trim()) addExe()
  const body = payload()
  if (!body) return
  busy.value = true
  try {
    if (editing.value) {
      await api.updateGameProfile(editing.value.id, body)
      pushToast({ tone: 'info', title: t('gameProfiles.savedToast', { name: body.name }) })
    } else {
      await api.createGameProfile(SITE, body)
      pushToast({ tone: 'info', title: t('gameProfiles.createdToast', { name: body.name }) })
    }
    closeForm()
    await load()
  } catch (e) {
    formError.value = String((e as Error).message || e)
  } finally {
    busy.value = false
  }
}

// ---- delete ----
const pendingDelete = ref<GameProfile | null>(null)

async function confirmDelete() {
  const p = pendingDelete.value
  if (!p) return
  busy.value = true
  error.value = ''
  try {
    await api.deleteGameProfile(p.id)
    pendingDelete.value = null
    if (editing.value?.id === p.id) closeForm()
    await load()
    pushToast({ tone: 'info', title: t('gameProfiles.deletedToast', { name: p.name }) })
  } catch (e) {
    error.value = String((e as Error).message || e)
    pendingDelete.value = null
  } finally {
    busy.value = false
  }
}

onMounted(async () => {
  await load()
  // Arriving from a run's "create profile" action: the process name (and the
  // window title, when it read one) come in on the query so the form opens
  // already describing the game the reader was looking at.
  const exe = String(route.query.exe || '').trim()
  const name = String(route.query.name || '').trim()
  if (exe || name) openCreate({ exe, name: name || exe })
})
</script>

<template>
  <main class="page data-workbench" aria-labelledby="game-profiles-title">
    <RouterLink class="back-link" to="/game-performance">← {{ t('gameProfiles.back') }}</RouterLink>

    <div class="page-head workbench-head">
      <div class="head-copy">
        <h2 id="game-profiles-title">{{ t('gameProfiles.title') }}</h2>
        <p class="hint sub">{{ t('gameProfiles.sub') }}</p>
      </div>
      <span class="spacer"></span>
      <button class="btn btn-primary" :disabled="busy" @click="openCreate()">{{ t('gameProfiles.newProfile') }}</button>
    </div>

    <p v-if="error" class="err" role="alert">{{ error }}</p>

    <section class="panel policy-panel" aria-labelledby="game-collection-title">
      <div class="panel-head">
        <h3 id="game-collection-title">{{ t('gameProfiles.collectionTitle') }}</h3>
      </div>
      <div class="pbody">
        <label class="check">
          <input
            type="checkbox"
            :checked="recordUnmatched"
            :disabled="busy || loading"
            @change="onRecordUnmatchedChange"
          />
          <span>{{ t('gameProfiles.recordUnmatched') }}</span>
        </label>
        <p class="hint tiny">
          {{ recordUnmatched ? t('gameProfiles.recordUnmatchedOnHint') : t('gameProfiles.recordUnmatchedOffHint') }}
        </p>
      </div>
    </section>

    <!-- Create / edit. One inline editor rather than a second page: the list is
         the context (which executables are already claimed) that makes the form
         answerable. -->
    <section v-if="formOpen" class="panel form-panel" aria-labelledby="game-profile-form-title">
      <div class="panel-head">
        <h3 id="game-profile-form-title">
          {{ editing ? t('gameProfiles.editTitle') : t('gameProfiles.newTitle') }}
        </h3>
      </div>
      <div class="pbody">
        <p v-if="formError" class="err" role="alert">{{ formError }}</p>

        <label class="field">
          <span>{{ t('gameProfiles.name') }}</span>
          <input v-model="form.name" :placeholder="t('gameProfiles.namePlaceholder')" />
        </label>

        <fieldset class="block">
          <legend>{{ t('gameProfiles.exe') }}<InfoTip :text="t('gameProfiles.exeHint')" /></legend>
          <div class="tag-row">
            <span v-for="e in form.exe" :key="e" class="tag">
              <span class="mono">{{ e }}</span>
              <button
                type="button"
                class="tag-x"
                :aria-label="t('gameProfiles.exeRemove', { name: e })"
                @click="removeExe(e)"
              >
                ×
              </button>
            </span>
            <span v-if="!form.exe.length" class="hint tiny">{{ t('gameProfiles.exeEmpty') }}</span>
          </div>
          <div class="tag-add">
            <input
              v-model="exeDraft"
              :placeholder="t('gameProfiles.exePlaceholder')"
              :aria-label="t('gameProfiles.exe')"
              @keydown.enter.prevent="addExe"
            />
            <button type="button" class="btn" @click="addExe">{{ t('gameProfiles.exeAdd') }}</button>
          </div>
        </fieldset>

        <fieldset class="block">
          <legend>{{ t('gameProfiles.fps') }}</legend>
          <div class="fps-row">
            <select v-model="form.fpsChoice" :aria-label="t('gameProfiles.fps')">
              <option value="">{{ t('gameProfiles.fpsUnset') }}</option>
              <option v-for="p in FPS_PRESETS" :key="p" :value="String(p)">{{ p }} FPS</option>
              <option value="custom">{{ t('gameProfiles.fpsCustom') }}</option>
            </select>
            <input
              v-if="form.fpsChoice === 'custom'"
              v-model="form.fpsCustom"
              type="number"
              min="1"
              class="fps-custom"
              :placeholder="t('gameProfiles.fpsCustomPlaceholder')"
              :aria-label="t('gameProfiles.fpsCustom')"
            />
          </div>
          <p class="hint tiny">{{ t('gameProfiles.fpsHint') }}</p>
        </fieldset>

        <fieldset class="block">
          <legend>{{ t('gameProfiles.tier') }}</legend>
          <label class="opt">
            <input type="radio" value="base" v-model="form.tier" />
            <span>
              <strong>{{ t('gameProfiles.tierBase') }}</strong>
              <em>{{ t('gameProfiles.tierBaseDesc') }}</em>
            </span>
          </label>
          <!-- The description is what this depth collects TODAY. It is the one
               line here that can turn into a promise the capture side does not
               keep, so it names the actual blocks rather than the ambition. -->
          <label class="opt">
            <input type="radio" value="diag" v-model="form.tier" />
            <span>
              <strong>{{ t('gameProfiles.tierDiag') }}</strong>
              <em>{{ t('gameProfiles.tierDiagDesc') }}</em>
            </span>
          </label>
        </fieldset>

        <fieldset class="block">
          <legend>{{ t('gameProfiles.monitors') }}</legend>
          <p class="hint tiny">{{ t('gameProfiles.monitorsHint') }}</p>
          <p v-if="!linkableMonitors.length" class="hint tiny">
            {{ t('gameProfiles.noMonitors') }}
            <RouterLink to="/monitoring">{{ t('gameProfiles.manageMonitors') }}</RouterLink>
          </p>
          <div v-else class="monitor-pick">
            <label v-for="m in linkableMonitors" :key="m.id" class="monitor-chip">
              <input type="checkbox" :checked="form.monitorIds.includes(m.id!)" @change="toggleMonitor(m.id!)" />
              <span>{{ monitorName(m) }}</span>
              <em>{{ typeLabel(m, t) }}</em>
            </label>
          </div>
        </fieldset>

        <div class="form-foot">
          <button class="btn" :disabled="busy" @click="closeForm">{{ t('gameProfiles.cancel') }}</button>
          <button class="btn btn-primary" :disabled="busy" @click="save">
            {{ busy ? t('gameProfiles.saving') : editing ? t('gameProfiles.save') : t('gameProfiles.create') }}
          </button>
        </div>
      </div>
    </section>

    <section class="panel table-sheet" aria-labelledby="game-profiles-list-title">
      <div class="panel-head">
        <h3 id="game-profiles-list-title">{{ t('gameProfiles.listTitle') }}</h3>
        <span class="count">{{ profiles.length }}</span>
      </div>
      <p class="hint panel-hint">{{ t('gameProfiles.listHint') }}</p>

      <div class="table-wrap" role="region" tabindex="0" :aria-label="t('gameProfiles.listTitle')">
        <table class="data-table">
          <thead>
            <tr>
              <th>{{ t('gameProfiles.thName') }}</th>
              <th>{{ t('gameProfiles.thExe') }}</th>
              <th class="num">{{ t('gameProfiles.thFps') }}</th>
              <th>{{ t('gameProfiles.thTier') }}</th>
              <th>{{ t('gameProfiles.thMonitors') }}</th>
              <th>{{ t('gameProfiles.thUpdated') }}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading">
              <td colspan="7" class="hint">{{ t('common.loading') }}</td>
            </tr>
            <tr v-else-if="!profiles.length">
              <td colspan="7" class="hint">{{ t('gameProfiles.empty') }}</td>
            </tr>
            <tr v-for="p in profiles" :key="p.id">
              <td>{{ p.name }}</td>
              <td class="mono dim">{{ p.exe.join(t('gameProfiles.listSep')) }}</td>
              <!-- No declared goal is a dash, never 0 and never the refresh rate. -->
              <td class="num">{{ p.target_fps === null ? '—' : p.target_fps }}</td>
              <td>
                <span class="badge neutral">{{ tierLabel(p.tier) }}</span>
              </td>
              <td>
                <span v-if="!p.monitor_ids.length" class="dim">{{ t('gameProfiles.monitorsNone') }}</span>
                <span v-else :title="monitorNames(p)">{{
                  t('gameProfiles.monitorsCount', { n: p.monitor_ids.length })
                }}</span>
              </td>
              <td>{{ fmtUnix(p.updated_at) }}</td>
              <td class="actions">
                <button class="link-btn" :disabled="busy" @click="openEdit(p)">{{ t('gameProfiles.edit') }}</button>
                <button class="link-btn danger" :disabled="busy" @click="pendingDelete = p">
                  {{ t('common.delete') }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <ConfirmDialog
      :open="!!pendingDelete"
      :title="t('gameProfiles.deleteTitle')"
      :message="[
        t('gameProfiles.deleteBody', { name: pendingDelete?.name ?? '' }),
        t('gameProfiles.deleteRunsKept'),
      ]"
      :confirm-label="t('common.delete')"
      :cancel-label="t('gameProfiles.cancel')"
      :busy="busy"
      tone="danger"
      @confirm="confirmDelete"
      @cancel="pendingDelete = null"
    />
  </main>
</template>

<style scoped>
/* Hallmark · designed-as-app · design-system: design.md · page: Game profiles */
.data-workbench {
  font-variant-numeric: tabular-nums;
}
.back-link {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  margin-bottom: var(--space-sm);
  color: var(--color-accent-text);
  font-size: var(--text-sm);
  text-decoration: none;
  white-space: nowrap;
}
.back-link:focus-visible {
  outline: var(--rule-fine) solid var(--color-focus);
  outline-offset: var(--space-3xs);
  border-radius: var(--radius-xs);
}
.workbench-head {
  align-items: flex-start;
}
.workbench-head h2 {
  font-family: var(--font-display);
  letter-spacing: -0.028em;
}
.head-copy {
  min-width: 0;
}
.head-copy .sub {
  margin: var(--space-2xs) 0 0;
}
.panel {
  margin-bottom: var(--space-md);
}
.policy-panel,
.form-panel {
  background: var(--color-glass);
  border-color: var(--color-rule);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-card);
  backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
}
.table-sheet {
  background: var(--color-glass-strong);
  border-color: var(--color-rule);
  border-radius: var(--radius-panel);
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
.panel-hint {
  margin: 0 18px 6px;
  padding-top: 8px;
}
.pbody {
  padding: 14px 18px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-width: 420px;
  color: var(--text-dim);
  font-size: 13px;
}
.field input {
  width: 100%;
}
.block {
  margin: 16px 0 0;
  padding: 0;
  border: none;
}
.block legend {
  margin-bottom: 6px;
  padding: 0;
  color: var(--text-dim);
  font-size: 13px;
}
.check {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  font-size: 13px;
  color: var(--text);
}
.check input,
.opt input,
.monitor-chip input {
  width: auto;
}
.tag-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  min-height: 32px;
}
.tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 6px 3px 10px;
  border: var(--rule-hair) solid var(--color-rule);
  border-radius: var(--radius-pill);
  background: var(--color-glass-subtle);
  font-size: 12.5px;
}
.tag-x {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
}
.tag-x:hover {
  color: var(--color-danger-text);
  background: var(--color-glass-hover);
}
.tag-x:focus-visible {
  outline: var(--rule-fine) solid var(--color-focus);
  outline-offset: var(--space-3xs);
}
.tag-add {
  display: flex;
  gap: 8px;
  margin-top: 8px;
  max-width: 420px;
}
.tag-add input {
  flex: 1;
  min-width: 0;
}
.fps-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.fps-custom {
  width: 120px;
}
.opt {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 6px 0;
  font-size: 13px;
}
.opt strong {
  display: block;
  font-weight: 600;
}
.opt em {
  display: block;
  margin-top: 2px;
  color: var(--text-dim);
  font-style: normal;
  font-size: 11.5px;
}
.monitor-pick {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed var(--border);
}
.monitor-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 44px;
  padding: 4px 8px;
  border: var(--rule-hair) solid var(--color-rule);
  border-radius: var(--radius-input);
  background: var(--color-glass-subtle);
  font-size: 12.5px;
}
.monitor-chip:has(input:focus-visible) {
  outline: var(--rule-fine) solid var(--color-focus);
  outline-offset: var(--space-3xs);
}
.monitor-chip em {
  color: var(--text-dim);
  font-style: normal;
  font-size: 11px;
}
.form-foot {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: var(--space-sm);
}
.count {
  min-width: 22px;
  padding: 1px 9px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text-dim);
  font-size: 12px;
  font-weight: 600;
  text-align: center;
}
.table-wrap {
  overflow-x: auto;
  overscroll-behavior-inline: contain;
  scrollbar-gutter: stable;
}
.table-wrap:focus-visible {
  outline: var(--rule-fine) solid var(--color-focus);
  outline-offset: calc(-1 * var(--rule-fine));
}
.data-table {
  min-width: 880px;
}
.data-table thead th {
  background: var(--color-glass-subtle);
}
.mono {
  font-family: var(--mono);
  font-size: 12.5px;
}
.num {
  text-align: right;
}
.dim {
  color: var(--text-muted);
}
.actions {
  white-space: nowrap;
}
.tiny {
  font-size: 11.5px;
  margin: 4px 0 0;
}

@media (max-width: 768px) {
  .workbench-head {
    align-items: stretch;
  }
  .pbody,
  .panel-head {
    padding-inline: var(--space-sm);
  }
  .panel-hint {
    margin-inline: var(--space-sm);
  }
  .field,
  .tag-add {
    max-width: none;
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
}
</style>

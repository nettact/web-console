<script setup lang="ts">
// "Connect to other servers" — the desktop-only panel for the extra servers this
// computer's embedded Agent reports to (AGENT-007 phase 3).
//
// The whole point of the feature is that it is UI-driven: a desktop user must
// never have to hand-edit an Agent config file, so adding a server is exactly two
// pasted values (that server's console URL and the ordinary one-time enrollment
// token it mints) plus a permission choice. There is no separate pairing code and
// no second token format — the token from a foreign console's "Add agent" page is
// the token.
//
// Permissions are per server on purpose: this machine may let the office server
// run probes while only the home server reads host metrics. So the picker is not
// decoration — it is the security boundary the panel exists to expose — and it
// reuses the enrollment chooser's machinery (permissionCatalog + the pure
// selection helpers) rather than reimplementing dependency closure.
//
// One editor, two modes. Adding and re-permissioning share a single always-open
// form instead of a modal: the permission picker is the primary editor here, and
// duplicating it into a dialog would mean two copies of the same dependency
// logic. Editing switches the form's mode and seeds it from the row (mirroring
// Settings.vue's channel `editingId` pattern), so only removal — which is
// destructive and needs a decision, not an editor — opens a dialog.
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  api,
  type LocalAgentServer,
  type LocalAgentServerSpec,
  type LocalAgentServerStatus,
  type PermissionCatalogEntry,
} from '../api'
import { ensurePermissionCatalog, permissionCatalog } from '../permissionCatalog'
import { serverInfo } from '../serverInfo'
import { toDateLocale } from '../i18n'
import { usePermissionMeta } from '../composables/usePermissionMeta'
import {
  deselectWithDependents,
  groupCatalog,
  orderedSelection,
  platformSupport,
  sameSelection,
  selectWithDependencies,
  type EnrollPlatform,
} from '../lib/permissionSelection'
import ConfirmDialog from './ConfirmDialog.vue'

const { t, te, locale } = useI18n()
const { permLabel, permPurpose } = usePermissionMeta()

const servers = ref<LocalAgentServer[]>([])
const loading = ref(true)
const error = ref('')

// --- list -------------------------------------------------------------------

async function load() {
  loading.value = true
  try {
    servers.value = await api.localAgentServers()
    error.value = ''
  } catch (e) {
    error.value = String((e as Error).message || e)
  } finally {
    loading.value = false
  }
}

// How often the list is re-read while this panel is on screen. Nothing here is
// pushed: adding a server schedules an Agent restart half a second later, the
// enrollment round-trip to a machine on someone else's network lands seconds
// after that, and a refused token only becomes visible once it has been tried.
// Without a poll every one of those outcomes waits for a remount, so a working
// server sits at "Connecting" forever and `enroll_failed` — the one state that
// needs the user to go do something — is the one they never see.
//
// 5s because the states being watched are transitions a human is waiting on, and
// the request is a read of a handful of in-memory entries against a server in
// this same process. It is not an SSE subscription (`/api/v1/events`) because
// none of this state passes through the server's event bus at all: it lives in
// the desktop app's agent supervisor, and putting it on the bus would mean
// plumbing a desktop-only concern through a console-wide channel to save one
// small request every five seconds.
const POLL_MS = 5000
let pollTimer: ReturnType<typeof setInterval> | undefined

// A poll is a quiet reload: no spinner (the list is already on screen, and
// flipping `loading` would blink the empty-state text), and a failure keeps the
// last good list rather than replacing the panel with an error. A transient
// refresh failure is not news — the user did not ask for anything — while the
// error from an action they DID take still surfaces through its own path.
//
// It is skipped mid-mutation so a poll cannot land between a submit and the
// reload that submit does itself, which would show the pre-mutation list for a
// moment. The add/edit form is untouched either way: this only ever assigns
// `servers`, and the form is seeded from a row at click time rather than being
// bound to one.
async function poll() {
  if (saving.value || removing.value) return
  try {
    servers.value = await api.localAgentServers()
  } catch {
    /* keep the last good list; the next tick tries again */
  }
}

// Badge tone per connection state. `superseded` is a warning rather than an error
// because it is usually self-inflicted and self-healing (another agent claimed
// the same identity on that server); `enroll_failed` and `revoked` are dead ends
// that need the user to do something.
//
// Keyed by plain string because the vocabulary is open — see below.
const STATE_TONE: Record<string, string> = {
  connected: 'ok',
  connecting: 'neutral',
  enroll_failed: 'bad',
  superseded: 'warn',
  revoked: 'bad',
  stopped: 'neutral',
}
const stateTone = (s: string) => STATE_TONE[s] || 'neutral'

// The state vocabulary can grow, and the API contract says so explicitly: this
// console is versioned separately from the binary serving it, so a state from a
// newer host is ordinary rather than a fault. vue-i18n renders a missing message
// as its own key path, so an unguarded lookup would put
// "settings.localAgent.state.some_new_thing" in a status badge. Fall back to a
// generic label that still carries the raw code — it is the thing the user would
// search for or quote, and the proof the host did say something. Same `te()`
// pattern as the preset labels in EnrollExamples.vue.
const stateLabel = (s: string) =>
  te(`settings.localAgent.state.${s}`)
    ? t(`settings.localAgent.state.${s}`)
    : t('settings.localAgent.stateUnknown', { state: s })

// Timestamps are rendered only when they are real ones.
//
// The API omits `since` when the host has no meaningful instant for the current
// state, which is exactly the state of an entry between being added and the
// Agent's first transition on it. Trusting mere presence is still wrong: Go's
// zero time is a valid RFC 3339 string, and any host that lets one through would
// have this panel announce "since 1/1/1". Anything before the epoch is not a
// timestamp this product can produce, so it is treated as absent.
function sinceLabel(status: LocalAgentServerStatus): string {
  if (!status.since) return ''
  const at = new Date(status.since)
  const ms = at.getTime()
  if (!Number.isFinite(ms) || ms <= 0) return ''
  return t('settings.localAgent.since', {
    time: at.toLocaleString(toDateLocale(locale.value), { hour12: false }),
  })
}

// Permission summary for a row: names, not ids, and only the first few — the full
// set is on the title so a long grant is still readable without a click.
const SEP = () => t('settings.localAgent.listSep')
function permSummary(s: LocalAgentServer): string {
  const names = (s.permissions || []).map(permLabel)
  if (!names.length) return t('settings.localAgent.permNone')
  if (names.length <= 3) return names.join(SEP())
  return t('settings.localAgent.permMore', { names: names.slice(0, 3).join(SEP()), n: names.length - 3 })
}
const permTitle = (s: LocalAgentServer) => (s.permissions || []).map(permLabel).join(SEP())

// --- permission picker ------------------------------------------------------

const catalog = computed(() => permissionCatalog.permissions)
const grouped = computed(() => groupCatalog(catalog.value))
const bundleIds = computed(() => permissionCatalog.bundles.map((b) => b.id))
const bundle = (id: string) => permissionCatalog.bundles.find((b) => b.id === id)?.permissions || []

// Presets are named by the server; `custom` is the only client-side option.
const preset = ref('recommended')
const custom = ref<Set<string>>(new Set())

const selected = computed<string[]>(() =>
  preset.value === 'custom' ? orderedSelection(custom.value, catalog.value) : bundle(preset.value),
)

// The recommended bundle IS the Agent's default set, so an add that lands on it
// omits `permissions` entirely rather than pinning a copy of a value the Agent
// already holds.
const isDefaultPolicy = computed(() => sameSelection(selected.value, bundle('recommended')))

// Entering custom mode starts from whatever preset was showing, so the chooser
// opens on a working policy rather than an empty one. Done in the change handler
// rather than a watcher: seeding an edit from the row's own permissions also
// assigns `preset`, and a watcher would fire afterwards and overwrite it.
function choosePreset(next: string) {
  if (next === 'custom' && preset.value !== 'custom') custom.value = new Set(bundle(preset.value))
  preset.value = next
}

function toggle(entry: PermissionCatalogEntry) {
  custom.value = custom.value.has(entry.id)
    ? deselectWithDependents(custom.value, entry.id, catalog.value)
    : selectWithDependencies(custom.value, entry)
}

// This panel only ever configures THIS computer, so the platform is known rather
// than chosen: flag what this machine cannot actually do instead of offering a
// per-platform tab strip.
const platform = computed<EnrollPlatform>(() =>
  serverInfo.os === 'windows' ? 'windows' : serverInfo.os === 'darwin' ? 'macos' : 'linux',
)
const support = (id: string) => platformSupport(id, platform.value)
const unsupportedSelected = computed(() => selected.value.filter((id) => support(id) === 'unsupported'))

// --- add / edit form --------------------------------------------------------

const mode = ref<'add' | 'edit'>('add')
const editingName = ref('')
const form = reactive({ url: '', token: '', name: '', tlsInsecure: false })
const saving = ref(false)
const formError = ref('')

const canSubmit = computed(() =>
  mode.value === 'edit' ? true : !!form.url.trim() && !!form.token.trim(),
)

function resetForm() {
  mode.value = 'add'
  editingName.value = ''
  form.url = ''
  form.token = ''
  form.name = ''
  form.tlsInsecure = false
  preset.value = 'recommended'
  custom.value = new Set()
  formError.value = ''
}

function startEdit(s: LocalAgentServer) {
  mode.value = 'edit'
  editingName.value = s.name
  formError.value = ''
  const granted = s.permissions || []
  // Show a preset radio when the grant still matches one, so the operator sees
  // "Recommended" rather than a hand-ticked list that happens to equal it.
  const match = permissionCatalog.bundles.find((b) => sameSelection(b.permissions, granted))
  preset.value = match ? match.id : 'custom'
  custom.value = new Set(granted)
}

// A trailing slash would make the Agent build "//api/..." request paths, and a
// shouty scheme fails the server's own URL check — normalize both here rather
// than bouncing the user off a validation error they cannot see the cause of.
function normalizeUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '')
  const i = trimmed.indexOf('://')
  return i < 0 ? trimmed : trimmed.slice(0, i).toLowerCase() + trimmed.slice(i)
}

// The name the API will actually accept, built from whatever the user typed.
//
// That charset is narrow on purpose (it is a URL path segment on every other
// route, and an implementation may use it as a filename), so "Work server" —
// which is the kind of thing a Display name field invites — is a 400 rather than
// a label. Normalizing here instead of rejecting is the same rule the server
// applies when deriving a name from a URL host: lowercase, fold anything outside
// the charset to '-', then trim the leading run because the first character
// cannot be '-' or '_'. The help text says so, and the row shows the result.
//
// The alternative — constraining the input element — does not work: this form is
// not a <form> that submits, so `pattern` never runs, and blocking keystrokes in
// an @input handler fights the cursor on every paste.
const LOCAL_AGENT_RESERVED_NAME = 'local'
function normalizeName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/^[-_]+/, '')
    .slice(0, 64)
}

function validate(): string {
  if (!form.url.trim()) return t('settings.localAgent.errUrlRequired')
  if (!/^https?:\/\/./i.test(form.url.trim())) return t('settings.localAgent.errUrlScheme')
  if (!form.token.trim()) return t('settings.localAgent.errTokenRequired')
  // Only when something was typed: an empty name is the documented "derive one
  // from the URL host", not a mistake.
  if (form.name.trim()) {
    const name = normalizeName(form.name)
    if (!name) return t('settings.localAgent.errNameInvalid')
    // Reserved for this machine's own in-process server, which is not in this
    // list — an entry allowed to take it would shadow the one connection the
    // user cannot configure.
    if (name === LOCAL_AGENT_RESERVED_NAME) return t('settings.localAgent.errNameReserved')
  }
  return ''
}

async function submit() {
  formError.value = ''
  if (mode.value === 'add') {
    const invalid = validate()
    if (invalid) {
      formError.value = invalid
      return
    }
  }
  saving.value = true
  try {
    if (mode.value === 'edit') {
      // `selected` is sent as-is, empty included: an operator who cleared every
      // box is revoking, and the API honors [] literally rather than reading it
      // as "you choose". (Passing null would be the other request — "use your
      // recommended default" — which this form has a preset for instead.)
      await api.setLocalAgentServerPermissions(editingName.value, selected.value)
    } else {
      const spec: LocalAgentServerSpec = {
        url: normalizeUrl(form.url),
        enroll_token: form.token.trim(),
      }
      const name = normalizeName(form.name)
      if (name) spec.name = name
      if (form.tlsInsecure) spec.tls_insecure = true
      // Landing on the recommended preset OMITS the field rather than pinning a
      // copy of a value the Agent already holds. Every other selection — an empty
      // one included — is sent, because the field's presence is exactly what
      // separates "you choose" from "grant nothing".
      if (!isDefaultPolicy.value) spec.permissions = selected.value
      await api.addLocalAgentServer(spec)
    }
    resetForm()
    await load()
  } catch (e) {
    formError.value = String((e as Error).message || e)
  } finally {
    saving.value = false
  }
}

// --- removal ----------------------------------------------------------------

const pendingRemove = ref<LocalAgentServer | null>(null)
const removing = ref(false)

async function confirmRemove() {
  const target = pendingRemove.value
  if (!target) return
  removing.value = true
  try {
    await api.removeLocalAgentServer(target.name)
    if (editingName.value === target.name) resetForm()
    pendingRemove.value = null
    await load()
  } catch (e) {
    error.value = String((e as Error).message || e)
    pendingRemove.value = null
  } finally {
    removing.value = false
  }
}

onMounted(() => {
  ensurePermissionCatalog()
  load()
  pollTimer = setInterval(poll, POLL_MS)
})

// Stopped with the panel: Settings.vue keeps its tab bodies mounted, so the
// timer would otherwise outlive the tab and keep polling a desktop-only route
// for as long as the console stayed open on another page.
onUnmounted(() => {
  clearInterval(pollTimer)
  pollTimer = undefined
})
</script>

<template>
  <div class="las">
    <p class="hint">{{ t('settings.localAgent.hint') }}</p>
    <p v-if="error" class="err inline" role="alert">{{ error }}</p>

    <ul v-if="servers.length" class="las-list">
      <li v-for="s in servers" :key="s.name" class="las-row" :class="{ editing: editingName === s.name }">
        <div class="las-head">
          <strong class="las-name">{{ s.name }}</strong>
          <span class="badge" :class="stateTone(s.status.state)">{{ stateLabel(s.status.state) }}</span>
          <span v-if="s.tls_insecure" class="badge warn">{{ t('settings.localAgent.tlsInsecureBadge') }}</span>
        </div>
        <div class="las-url mono">{{ s.url }}</div>
        <p class="las-meta">
          <span :title="permTitle(s)">{{ permSummary(s) }}</span>
          <span v-if="sinceLabel(s.status)"> · {{ sinceLabel(s.status) }}</span>
          <span v-if="s.status.agent_id"> · {{ t('settings.localAgent.agentId') }} {{ s.status.agent_id }}</span>
          <span v-else-if="!s.enrolled"> · {{ t('settings.localAgent.notEnrolled') }}</span>
        </p>
        <!-- A refused token cannot be retried: it was one-time and it is gone. -->
        <p v-if="s.status.state === 'enroll_failed'" class="las-fix">
          {{ t('settings.localAgent.enrollFailedFix') }}
        </p>
        <p v-if="s.status.last_error" class="las-last-error">
          {{ t('settings.localAgent.lastError') }} {{ s.status.last_error }}
        </p>
        <div class="las-actions">
          <button v-if="catalog.length" type="button" class="btn btn-ghost las-edit" @click="startEdit(s)">
            {{ t('settings.localAgent.editPerms') }}
          </button>
          <button type="button" class="btn btn-ghost las-remove" @click="pendingRemove = s">
            {{ t('settings.localAgent.remove') }}
          </button>
        </div>
      </li>
    </ul>
    <p v-else-if="!loading" class="las-empty">{{ t('settings.localAgent.empty') }}</p>

    <section class="las-form">
      <h4 class="las-form-title">
        {{ mode === 'edit' ? t('settings.localAgent.editTitle', { name: editingName }) : t('settings.localAgent.addTitle') }}
      </h4>

      <template v-if="mode === 'add'">
        <label class="las-field">
          <span class="knob-label">{{ t('settings.localAgent.urlLabel') }}</span>
          <input v-model="form.url" class="wide" placeholder="https://nettact.example.com:12450" />
          <small>{{ t('settings.localAgent.urlHelp') }}</small>
        </label>
        <label class="las-field">
          <span class="knob-label">{{ t('settings.localAgent.tokenLabel') }}</span>
          <input v-model="form.token" class="wide las-token" autocomplete="off" spellcheck="false" />
          <small>{{ t('settings.localAgent.tokenHelp') }}</small>
        </label>
        <label class="las-field">
          <span class="knob-label">{{ t('settings.localAgent.nameLabel') }}</span>
          <input v-model="form.name" class="wide" :placeholder="t('settings.localAgent.namePlaceholder')" />
          <small>{{ t('settings.localAgent.nameHelp') }}</small>
        </label>
        <label class="las-check">
          <input v-model="form.tlsInsecure" type="checkbox" />
          <span>
            <strong>{{ t('settings.localAgent.tlsInsecureLabel') }}</strong>
            <small>{{ t('settings.localAgent.tlsInsecureHelp') }}</small>
          </span>
        </label>
      </template>

      <!-- The permission chooser stays open: it is what this panel is for. Hidden
           only when the catalog could not be loaded, in which case an add still
           works and the Agent grants that server its default set. -->
      <div v-if="catalog.length" class="las-perms">
        <div class="las-perm-head">
          <strong>{{ t('settings.localAgent.permTitle') }}</strong>
          <small>{{ t('settings.localAgent.permHint') }}</small>
        </div>
        <div class="las-presets" role="radiogroup" :aria-label="t('settings.localAgent.permTitle')">
          <label v-for="b in bundleIds" :key="b" class="las-preset">
            <input
              type="radio"
              name="las-preset"
              :value="b"
              :checked="preset === b"
              @change="choosePreset(b)"
            />
            <span>{{ t(`onboarding.preset_${b}`) }}</span>
          </label>
          <label class="las-preset">
            <input
              type="radio"
              name="las-preset"
              value="custom"
              :checked="preset === 'custom'"
              @change="choosePreset('custom')"
            />
            <span>{{ t('onboarding.preset_custom') }}</span>
          </label>
        </div>

        <div v-if="preset === 'custom'" class="las-perm-groups">
          <div v-for="g in grouped" :key="g.group" class="las-perm-group">
            <h5>{{ t(`onboarding.permGroup_${g.group}`) }}</h5>
            <label
              v-for="e in g.entries"
              :key="e.id"
              class="las-perm-item"
              :class="{ unsupported: support(e.id) === 'unsupported' }"
              :title="permPurpose(e.id) || e.id"
            >
              <input type="checkbox" :checked="custom.has(e.id)" @change="toggle(e)" />
              <span class="las-perm-name">{{ permLabel(e.id) }}</span>
              <span v-if="support(e.id) === 'unsupported'" class="las-perm-tag warn">
                {{ t('onboarding.permUnsupportedTag') }}
              </span>
              <span v-else-if="support(e.id) === 'component'" class="las-perm-tag">
                {{ t('onboarding.permComponentTag') }}
              </span>
              <span v-else-if="support(e.id) === 'privileged'" class="las-perm-tag">
                {{ t('onboarding.permPrivilegedTag') }}
              </span>
            </label>
          </div>
        </div>

        <p v-if="!selected.length" class="las-note">{{ t('settings.localAgent.permNoneNote') }}</p>
        <p v-if="unsupportedSelected.length" class="las-note warn">
          {{ t('settings.localAgent.permUnsupportedNote', { n: unsupportedSelected.length }) }}
        </p>
      </div>

      <p v-if="formError" class="err inline" role="alert">{{ formError }}</p>

      <div class="row field-row">
        <button class="btn btn-primary" :disabled="saving || !canSubmit" @click="submit">
          {{ mode === 'edit' ? t('common.save') : t('settings.localAgent.addAction') }}
        </button>
        <button v-if="mode === 'edit'" class="btn" :disabled="saving" @click="resetForm">
          {{ t('settings.localAgent.cancel') }}
        </button>
      </div>
    </section>

    <ConfirmDialog
      :open="!!pendingRemove"
      :title="t('settings.localAgent.removeTitle')"
      :message="[
        t('settings.localAgent.removeBody', { name: pendingRemove?.name || '' }),
        t('settings.localAgent.removeConsequence'),
      ]"
      :confirm-label="t('settings.localAgent.remove')"
      :cancel-label="t('settings.localAgent.cancel')"
      :busy="removing"
      tone="danger"
      @confirm="confirmRemove"
      @cancel="pendingRemove = null"
    />
  </div>
</template>

<style scoped>
.las {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.las-empty {
  margin: 0;
  padding: 14px;
  border: 1px dashed var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  font-size: 13px;
  line-height: 1.6;
}
.las-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.las-row {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 11px 13px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
}
.las-row.editing {
  border-color: var(--primary);
}
.las-head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.las-name {
  font-size: 13.5px;
}
.las-url {
  color: var(--text-dim);
  word-break: break-all;
}
.las-meta {
  margin: 0;
  font-size: 12.5px;
  color: var(--text-muted);
  line-height: 1.55;
}
.las-fix {
  margin: 0;
  font-size: 12.5px;
  color: var(--color-warning-text);
  line-height: 1.55;
}
.las-last-error {
  margin: 0;
  font-size: 12px;
  color: var(--color-danger-text);
  word-break: break-word;
  line-height: 1.5;
}
.las-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding-top: 3px;
}
.las-form {
  display: flex;
  flex-direction: column;
  gap: 11px;
  padding: 13px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
}
.las-form-title {
  margin: 0;
  font-size: 13px;
}
.las-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.las-field small,
.las-check small {
  color: var(--text-dim);
  font-size: 12px;
  line-height: 1.5;
}
.las-check {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  cursor: pointer;
}
.las-check input {
  margin-top: 3px;
}
.las-check span {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.las-check strong {
  font-size: 12.5px;
}
.las-perms {
  display: flex;
  flex-direction: column;
  gap: 9px;
  padding-top: 10px;
  border-top: 1px solid var(--border);
}
.las-perm-head {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.las-perm-head strong {
  font-size: 13px;
}
.las-perm-head small {
  color: var(--text-dim);
  font-size: 12px;
  line-height: 1.5;
}
.las-presets {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
}
.las-preset {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12.5px;
  cursor: pointer;
}
.las-perm-groups {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px 18px;
  padding-top: 4px;
  border-top: 1px dashed var(--border);
}
.las-perm-group h5 {
  margin: 0 0 6px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
}
.las-perm-item {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 2px 0;
  font-size: 12.5px;
  cursor: pointer;
}
.las-perm-item.unsupported .las-perm-name {
  color: var(--text-muted);
  text-decoration: line-through;
}
.las-perm-tag {
  font-size: 10.5px;
  padding: 0 6px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--border-strong);
  color: var(--text-muted);
  white-space: nowrap;
}
.las-perm-tag.warn {
  color: var(--color-warning-text);
}
.las-note {
  margin: 0;
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.55;
}
.las-note.warn {
  color: var(--color-warning-text);
}
</style>

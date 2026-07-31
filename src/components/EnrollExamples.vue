<script setup lang="ts">
// One-command Agent installers, grouped by target platform, with the local
// permission policy chosen up front. Picking permissions here rather than after
// the fact matters: the policy is applied at install time, so changing it later
// means editing a config file on the machine and restarting the Agent.
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { PermissionCatalogEntry } from '../api'
import { consoleBase, ensureConsoleBase } from '../consoleBaseUrl'
import { permissionCatalog, ensurePermissionCatalog } from '../permissionCatalog'
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

const props = defineProps<{ token: string }>()

type Tab = EnrollPlatform
const tabs: Tab[] = ['windows', 'macos', 'linux', 'docker']
const tab = ref<Tab>('windows')
const autoUpdate = ref(true)

const { t, te } = useI18n()
const { permLabel, permPurpose } = usePermissionMeta()

// Presets are named by the server, so a console older than its server can meet a
// bundle it has no wording for. Fall back to the raw id rather than rendering a
// translation key at the operator.
const presetLabel = (id: string) => (te(`onboarding.preset_${id}`) ? t(`onboarding.preset_${id}`) : id)
const presetHint = (id: string) =>
  te(`onboarding.presetHint_${id}`) ? t(`onboarding.presetHint_${id}`) : ''

// A real token when one was just generated, else a clear placeholder.
const tok = computed(() => props.token || '<enrollment-token>')
// The configured console address (Settings → console URL), never this browser's
// origin: the operator's own address often isn't reachable from the machine the
// Agent is being installed on.
const url = computed(() => consoleBase.url)

// --- permission policy ------------------------------------------------------

// Presets come from the server so "recommended" always means the Agent's own
// built-in default set; `custom` is the only client-side option.
type Preset = string
const preset = ref<Preset>('recommended')
const custom = ref<Set<string>>(new Set())
const showCustom = ref(false)

const catalog = computed(() => permissionCatalog.permissions)
const grouped = computed(() => groupCatalog(catalog.value))
const bundleIds = computed(() => permissionCatalog.bundles.map((b) => b.id))

function bundle(id: string): string[] {
  return permissionCatalog.bundles.find((b) => b.id === id)?.permissions || []
}

// The permissions the install command will carry.
const selected = computed<string[]>(() =>
  preset.value === 'custom' ? orderedSelection(custom.value, catalog.value) : bundle(preset.value),
)

// The recommended bundle IS the Agent's default, so sending it explicitly would
// only lengthen the command without changing anything.
const isDefaultPolicy = computed(() => sameSelection(selected.value, bundle('recommended')))
const policyValue = computed(() => (isDefaultPolicy.value ? '' : selected.value.join(',') || 'none'))

// Entering custom mode starts from whatever preset was showing, so the chooser
// opens on a working policy rather than an empty one.
watch(preset, (next, prev) => {
  if (next === 'custom' && prev !== 'custom') {
    custom.value = new Set(bundle(prev))
    showCustom.value = true
  }
})

function toggle(entry: PermissionCatalogEntry) {
  custom.value = custom.value.has(entry.id)
    ? deselectWithDependents(custom.value, entry.id, catalog.value)
    : selectWithDependencies(custom.value, entry)
}

function support(id: string) {
  return platformSupport(id, tab.value)
}

// Permissions the chosen policy includes that the selected platform cannot run.
// Not an error — the same policy is often applied to a fleet — but the operator
// should see it rather than wonder later why the capability never appeared.
const unsupportedSelected = computed(() =>
  selected.value.filter((id) => platformSupport(id, tab.value) === 'unsupported'),
)

// --- install commands -------------------------------------------------------

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'"'"'`)}'`
}

function powershellQuote(value: string) {
  return `'${value.replace(/'/g, "''")}'`
}

const windows = computed(
  () =>
    `& ([scriptblock]::Create((irm https://d.nettact.org/agent/install.ps1))) -ServerUrl ${powershellQuote(url.value)} -Token ${powershellQuote(tok.value)}${policyValue.value ? ` -Permissions ${powershellQuote(policyValue.value)}` : ''}${autoUpdate.value ? ' -AutoUpdate' : ''}`,
)

const unixPolicyArg = computed(() =>
  policyValue.value ? ` \\\n  --permissions ${shellQuote(policyValue.value)}` : '',
)

const nativeUnix = computed(
  () =>
    `curl -fsSL https://d.nettact.org/agent/install.sh | sudo bash -s -- \\\n  --server-url ${shellQuote(url.value)} \\\n  --token ${shellQuote(tok.value)}${unixPolicyArg.value}${autoUpdate.value ? ' --auto-update' : ''}`,
)

const docker = computed(
  () =>
    `curl -fsSL https://d.nettact.org/agent/install.sh | bash -s -- --docker \\\n  --server-url ${shellQuote(url.value)} \\\n  --token ${shellQuote(tok.value)}${unixPolicyArg.value}${autoUpdate.value ? ' --auto-update' : ''}`,
)

const snippet = computed(() => {
  if (tab.value === 'windows') return windows.value
  if (tab.value === 'docker') return docker.value
  return nativeUnix.value
})

const copied = ref(false)
async function copy() {
  await navigator.clipboard?.writeText(snippet.value)
  copied.value = true
  window.setTimeout(() => (copied.value = false), 1500)
}

onMounted(() => {
  ensureConsoleBase()
  ensurePermissionCatalog()
})
</script>

<template>
  <div class="enroll">
    <div class="tabs" role="tablist">
      <button
        v-for="k in tabs"
        :key="k"
        class="tab"
        role="tab"
        :class="{ active: tab === k }"
        :aria-selected="tab === k"
        @click="tab = k"
      >
        {{ $t(`onboarding.tab_${k}`) }}
      </button>
    </div>

    <label class="auto-update">
      <input v-model="autoUpdate" type="checkbox" />
      <span>
        <strong>{{ $t('onboarding.autoUpdate') }}</strong>
        <small>{{ $t('onboarding.autoUpdateHint') }}</small>
      </span>
    </label>

    <!-- Local permission policy, applied at install time. Hidden entirely when
         the catalog could not be loaded: the command below still enrolls a
         working Agent on its built-in default policy. -->
    <section v-if="catalog.length" class="perm-picker">
      <div class="perm-head">
        <strong>{{ $t('onboarding.permTitle') }}</strong>
        <small>{{ $t('onboarding.permHint') }}</small>
      </div>
      <div class="presets" role="radiogroup" :aria-label="$t('onboarding.permTitle')">
        <label v-for="b in bundleIds" :key="b" class="preset">
          <input v-model="preset" type="radio" :value="b" />
          <span>
            <strong>{{ presetLabel(b) }}</strong>
            <small v-if="presetHint(b)">{{ presetHint(b) }}</small>
          </span>
        </label>
        <label class="preset">
          <input v-model="preset" type="radio" value="custom" />
          <span>
            <strong>{{ $t('onboarding.preset_custom') }}</strong>
            <small>{{ $t('onboarding.presetHint_custom') }}</small>
          </span>
        </label>
      </div>

      <button
        v-if="preset === 'custom'"
        type="button"
        class="link-btn"
        :aria-expanded="showCustom"
        @click="showCustom = !showCustom"
      >
        {{ showCustom ? $t('onboarding.permCollapse') : $t('onboarding.permExpand') }}
        ({{ selected.length }})
      </button>

      <div v-if="preset === 'custom' && showCustom" class="perm-groups">
        <div v-for="g in grouped" :key="g.group" class="perm-group">
          <h4>{{ $t(`onboarding.permGroup_${g.group}`) }}</h4>
          <label
            v-for="e in g.entries"
            :key="e.id"
            class="perm-item"
            :class="{ unsupported: support(e.id) === 'unsupported' }"
            :title="permPurpose(e.id) || e.id"
          >
            <input type="checkbox" :checked="custom.has(e.id)" @change="toggle(e)" />
            <span class="perm-name">{{ permLabel(e.id) }}</span>
            <span v-if="support(e.id) === 'unsupported'" class="perm-tag warn">
              {{ $t('onboarding.permUnsupportedTag') }}
            </span>
            <span v-else-if="support(e.id) === 'privileged'" class="perm-tag">
              {{ $t('onboarding.permPrivilegedTag') }}
            </span>
          </label>
        </div>
      </div>

      <p v-if="isDefaultPolicy" class="perm-note">{{ $t('onboarding.permDefaultNote') }}</p>
      <p v-else-if="!selected.length" class="perm-note">{{ $t('onboarding.permNoneNote') }}</p>
      <p v-if="unsupportedSelected.length" class="perm-note warn">
        {{ $t('onboarding.permUnsupportedNote', { n: unsupportedSelected.length }) }}
      </p>
      <p class="perm-note">
        {{ $t('onboarding.permReplaceNote') }}
        <a :href="$t('docs.permissionsUrl')" target="_blank" rel="noopener noreferrer">
          {{ $t('permRemediation.docsLink') }} →
        </a>
      </p>
    </section>

    <div class="code-wrap">
      <button class="copy" @click="copy">{{ copied ? $t('common.saved') : $t('agents.copy') }}</button>
      <pre><code>{{ snippet }}</code></pre>
    </div>

    <ul class="callouts">
      <li>{{ $t('onboarding.calloutAdmin') }}</li>
      <li>{{ $t('onboarding.calloutInstall') }}</li>
      <li>{{ $t('onboarding.calloutTokenHistory') }}</li>
    </ul>
  </div>
</template>

<style scoped>
.enroll {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  border-bottom: 1px solid var(--border);
}
.tab {
  padding: 7px 14px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: 13px;
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
.auto-update {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  width: fit-content;
  color: var(--text);
  cursor: pointer;
}
.auto-update input {
  margin-top: 3px;
}
.auto-update span {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.auto-update strong {
  font-size: 13px;
}
.auto-update small {
  color: var(--text-dim);
  font-size: 12px;
}
.perm-picker {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
}
.perm-head {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.perm-head strong {
  font-size: 13px;
}
.perm-head small {
  color: var(--text-dim);
  font-size: 12px;
}
.presets {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 8px 14px;
}
.preset {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  cursor: pointer;
}
.preset input {
  margin-top: 3px;
}
.preset span {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.preset strong {
  font-size: 12.5px;
}
.preset small {
  color: var(--text-dim);
  font-size: 11.5px;
  line-height: 1.45;
}
.perm-groups {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px 18px;
  padding-top: 4px;
  border-top: 1px dashed var(--border);
}
.perm-group h4 {
  margin: 0 0 6px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
}
.perm-item {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 2px 0;
  font-size: 12.5px;
  cursor: pointer;
}
.perm-item.unsupported .perm-name {
  color: var(--text-muted);
  text-decoration: line-through;
}
.perm-tag {
  font-size: 10.5px;
  padding: 0 6px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--border-strong);
  color: var(--text-muted);
  white-space: nowrap;
}
.perm-tag.warn {
  border-color: rgba(251, 191, 36, 0.4);
  color: #fbbf24;
}
.perm-note {
  margin: 0;
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.55;
}
.perm-note.warn {
  color: #fbbf24;
}
.link-btn {
  align-self: flex-start;
  border: none;
  background: transparent;
  color: var(--primary);
  font: inherit;
  font-size: 12.5px;
  padding: 0;
  cursor: pointer;
}
.link-btn:hover {
  text-decoration: underline;
}
.code-wrap {
  position: relative;
}
.copy {
  position: absolute;
  top: 8px;
  right: 8px;
  padding: 3px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--text-dim);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.copy:hover {
  color: var(--text);
  border-color: var(--border-strong);
}
pre {
  margin: 0;
  padding: 14px 16px;
  overflow-x: auto;
  background: var(--code-bg, var(--surface-2));
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}
code {
  font-family: var(--mono, monospace);
  font-size: 12.5px;
  line-height: 1.65;
  color: var(--text);
  white-space: pre;
  background: none;
  border: none;
  padding: 0;
}
.callouts {
  margin: 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: 12.5px;
  color: var(--text-dim);
  line-height: 1.55;
}
</style>
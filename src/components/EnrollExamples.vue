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

// `reinstall` is set by the dialog that mints a token bound to one agent. It
// only changes the OpenWrt path, and it has to: every other platform's installer
// wipes the local identity on a full install, while the router deliberately
// keeps /etc/nettact across reinstalls and sysupgrades. Without saying so, the
// agent would go on using the credential it already has, the bound token would
// never be spent, and the dialog's promise would simply be false there.
const props = withDefaults(defineProps<{ token: string; reinstall?: boolean }>(), {
  reinstall: false,
})

type Tab = EnrollPlatform
const tabs: Tab[] = ['windows', 'macos', 'linux', 'docker', 'openwrt']
const tab = ref<Tab>('windows')
const autoUpdate = ref(true)
// Router-only, and the one decision a router owner cannot avoid: the packages
// ship no binary, so this says where the ~11 MB agent lands. RAM costs a
// download per boot and no flash at all, which is the right default on the 8
// and 16 MB devices that benefit most from having an agent at the edge.
const storage = ref<'ram' | 'flash'>('ram')
const showManual = ref(false)

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

// Permissions the policy includes that need software this command does not
// install. Without saying so, the enrollment reads as complete and then quietly
// collects nothing — the one outcome an operator has no way to diagnose from
// here.
const componentSelected = computed(() =>
  selected.value.filter((id) => platformSupport(id, tab.value) === 'component'),
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

// `wget` rather than `curl`: OpenWrt images carry uclient-fetch (or BusyBox
// wget) and usually no curl at all.
//
// Downloaded to a file and run separately rather than piped into `sh`. A
// pipeline reports the status of its LAST command, and `sh -s` fed an empty
// stdin exits 0 — so a failed download (no DNS, no CA bundle, a 404) would
// print nothing and look exactly like a successful install. `&&` makes the
// download a precondition, and dropping `-q` keeps wget's error visible.
//
// `--mode` is emitted only for flash for the same reason the permission
// argument is omitted at the default policy — a command should carry the
// choices that were made, not restate the defaults.
// Unlike the other platforms, this command states EVERY choice instead of
// omitting the defaults. The installer only touches a setting the command names,
// so on a rerun an omitted `--mode` would leave a flash router on flash while
// the console shows RAM, and an omitted `--permissions` would keep a grant
// broader than the one displayed. A command that does not match the screen it
// was copied from is worse than a longer one.
const openwrtPolicy = computed(() => policyValue.value || 'default')

const openwrt = computed(
  () =>
    `wget -O /tmp/nettact-openwrt.sh https://d.nettact.org/agent/openwrt.sh && sh /tmp/nettact-openwrt.sh \\\n  --server-url ${shellQuote(url.value)} \\\n  --token ${shellQuote(tok.value)} \\\n  --mode ${storage.value} \\\n  --permissions ${shellQuote(openwrtPolicy.value)}${props.reinstall ? ' \\\n  --reinstall' : ''}`,
)

const snippet = computed(() => {
  if (tab.value === 'windows') return windows.value
  if (tab.value === 'docker') return docker.value
  if (tab.value === 'openwrt') return openwrt.value
  return nativeUnix.value
})

// --- the same thing by hand -------------------------------------------------
// Shown under the OpenWrt tab because a router owner is the operator most likely
// to refuse a piped script, and because the two packages plus UCI are what the
// LuCI pages are configuring anyway. These are literally the steps the installer
// above performs, so they stay in step with it.

// The TLS transport is installed only when no provider is present: images using
// libustream-openssl or -wolfssl already have one, and dropping mbedtls on top
// would swap a working backend nobody asked to change.
const manualInstall = `opkg update
opkg install ca-bundle
opkg list-installed | grep -q '^libustream-' || opkg install libustream-mbedtls
opkg install https://d.nettact.org/agent/nettact-agent.ipk
opkg install https://d.nettact.org/agent/luci-app-nettact.ipk`

// UCI models the grant as a mode plus an optional list, so the console's policy
// value has to be rendered as both — and the list has to be DELETED first.
// `add_list` appends, so a rerun on a router that already has a custom grant
// would union the two and keep permissions the operator just removed. The
// default-policy branch sets the mode explicitly rather than emitting nothing,
// because "nothing" leaves an earlier `none` or `custom` in place.
const manualPermissionLines = computed(() => {
  const clear = `uci -q delete nettact.main.permissions\n`
  if (!policyValue.value) return `${clear}uci set nettact.main.permission_mode='default'\n`
  if (policyValue.value === 'none') return `${clear}uci set nettact.main.permission_mode='none'\n`
  return (
    `${clear}uci set nettact.main.permission_mode='custom'\n` +
    selected.value.map((id) => `uci add_list nettact.main.permissions='${id}'\n`).join('')
  )
})

// `server_mode=single` is not optional: on a router previously set up for
// several servers the agent reads its `config server` sections and ignores the
// server_url and token written here. `enroll_token_file` is deleted for a
// related reason — the two token sources are mutually exclusive, and a router
// that already had the file form would produce a config the agent rejects at
// startup. `restart` rather than `start` because `start` is a no-op on an
// already-running service, so the settings just written would not take effect.
//
// The reinstall wipe comes LAST, after every uci write, and is CHAINED to them
// with `&&`. These lines are pasted into an interactive shell, which has no
// `set -e`: without the chain a failed `uci commit` would not stop the sequence,
// and the router would lose its working credential to a configuration that
// never landed.
const manualConfigure = computed(
  () =>
    `uci set nettact.main.server_mode='single'
uci set nettact.main.server_url=${shellQuote(url.value)}
uci set nettact.main.enroll_token=${shellQuote(tok.value)}
uci -q delete nettact.main.enroll_token_file
uci set nettact.main.mode='${storage.value}'
${manualPermissionLines.value}uci set nettact.main.enabled='1'
uci commit nettact${
      props.reinstall
        ? ` && /etc/init.d/nettact enable \\
  && /etc/init.d/nettact stop \\
  && rm -f /etc/nettact/data/agent.json \\
  && rm -rf /etc/nettact/data/wal \\
  && /etc/init.d/nettact restart`
        : `
/etc/init.d/nettact enable
/etc/init.d/nettact restart`
    }`,
)

const copiedKey = ref('')
async function copyText(text: string, key: string) {
  await navigator.clipboard?.writeText(text)
  copiedKey.value = key
  window.setTimeout(() => {
    if (copiedKey.value === key) copiedKey.value = ''
  }, 1500)
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

    <label v-if="tab !== 'openwrt'" class="auto-update">
      <input v-model="autoUpdate" type="checkbox" />
      <span>
        <strong>{{ $t('onboarding.autoUpdate') }}</strong>
        <small>{{ $t('onboarding.autoUpdateHint') }}</small>
      </span>
    </label>

    <!-- Where the downloaded binary lives. Router-only: nothing on the other
         platforms downloads itself at every boot. -->
    <section v-else class="perm-picker">
      <div class="perm-head">
        <strong>{{ $t('onboarding.storageTitle') }}</strong>
        <small>{{ $t('onboarding.storageHint') }}</small>
      </div>
      <div class="presets" role="radiogroup" :aria-label="$t('onboarding.storageTitle')">
        <label v-for="s in (['ram', 'flash'] as const)" :key="s" class="preset">
          <input v-model="storage" type="radio" :value="s" />
          <span>
            <strong>{{ $t(`onboarding.storage_${s}`) }}</strong>
            <small>{{ $t(`onboarding.storageHint_${s}`) }}</small>
          </span>
        </label>
      </div>
    </section>

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
            <span v-else-if="support(e.id) === 'component'" class="perm-tag">
              {{ $t('onboarding.permComponentTag') }}
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
      <p v-if="componentSelected.length" class="perm-note warn">
        {{ $t('onboarding.permComponentNote', { n: componentSelected.length }) }}
      </p>
      <p class="perm-note">
        {{ $t('onboarding.permReplaceNote') }}
        <a :href="$t('docs.permissionsUrl')" target="_blank" rel="noopener noreferrer">
          {{ $t('permRemediation.docsLink') }} →
        </a>
      </p>
    </section>

    <div class="code-wrap">
      <button class="copy" @click="copyText(snippet, 'cmd')">
        {{ copiedKey === 'cmd' ? $t('common.saved') : $t('agents.copy') }}
      </button>
      <pre><code>{{ snippet }}</code></pre>
    </div>

    <!-- The same install by hand. Collapsed, because the command above is the
         primary path; the documentation link is not, so it stays visible. -->
    <section v-if="tab === 'openwrt'" class="manual">
      <div class="manual-head">
        <strong>{{ $t('onboarding.manualTitle') }}</strong>
        <a :href="$t('docs.openwrtUrl')" target="_blank" rel="noopener noreferrer">
          {{ $t('onboarding.manualDocsLink') }} →
        </a>
      </div>
      <button
        type="button"
        class="link-btn"
        :aria-expanded="showManual"
        @click="showManual = !showManual"
      >
        {{ showManual ? $t('onboarding.manualCollapse') : $t('onboarding.manualExpand') }}
      </button>
      <ol v-if="showManual" class="manual-steps">
        <li>
          <p>{{ $t('onboarding.manualStep1') }}</p>
          <div class="code-wrap">
            <button class="copy" @click="copyText(manualInstall, 'manual1')">
              {{ copiedKey === 'manual1' ? $t('common.saved') : $t('agents.copy') }}
            </button>
            <pre><code>{{ manualInstall }}</code></pre>
          </div>
        </li>
        <li>
          <p>{{ $t('onboarding.manualStep2') }}</p>
        </li>
        <li>
          <p>{{ $t('onboarding.manualStep3') }}</p>
          <div class="code-wrap">
            <button class="copy" @click="copyText(manualConfigure, 'manual2')">
              {{ copiedKey === 'manual2' ? $t('common.saved') : $t('agents.copy') }}
            </button>
            <pre><code>{{ manualConfigure }}</code></pre>
          </div>
        </li>
      </ol>
    </section>

    <ul class="callouts">
      <li v-if="tab !== 'openwrt'">{{ $t('onboarding.calloutAdmin') }}</li>
      <li v-if="tab !== 'openwrt'">{{ $t('onboarding.calloutInstall') }}</li>
      <li v-if="tab === 'openwrt'">
        {{ reinstall ? $t('onboarding.calloutOpenwrtReinstall') : $t('onboarding.calloutOpenwrtInstall') }}
      </li>
      <li v-if="tab === 'openwrt'">{{ $t('onboarding.calloutOpenwrtHttps') }}</li>
      <li v-if="tab === 'openwrt' && storage === 'ram'">
        {{ $t('onboarding.calloutOpenwrtRam') }}
      </li>
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
  color: var(--color-accent-text);
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
  color: var(--color-warning-text);
}
.perm-note {
  margin: 0;
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.55;
}
.perm-note.warn {
  color: var(--color-warning-text);
}
.link-btn {
  align-self: flex-start;
  border: none;
  background: transparent;
  color: var(--color-accent-text);
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
.manual {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
}
.manual-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}
.manual-head strong {
  font-size: 13px;
}
.manual-head a {
  font-size: 12.5px;
  color: var(--color-accent-text);
}
.manual-steps {
  margin: 0;
  padding-left: 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  color: var(--text);
}
.manual-steps p {
  margin: 0 0 6px;
  font-size: 12.5px;
  color: var(--text-dim);
  line-height: 1.55;
}
</style>

<script setup lang="ts">
// Remediation dialog for a permission that is not in effect. Opened by clicking a
// permission chip. The body is composed of two parts: WHY it is not usable (one of
// four causes) and, when a policy change is part of the fix, HOW to grant it.
//
// Causes:
//   permission_blocked — not granted by the Agent's local policy, and the platform
//     could run it. The grant block below is the whole fix.
//   elevation — the Agent needs more OS privilege (raw-socket TCP traceroute).
//   unsupported — a hard platform/build capability gap. No policy change or
//     elevation helps; explains which platform/build is required.
//   dependency — granted and supported, but a permission it requires is not in
//     effect, so it was pruned. Fix the parent first.
//
// The grant block shows the server-computed full NETTACT_AGENT_PERMISSIONS=… line
// (granted ∪ missing, dependency-closed) with copy, plus per run-mode snippets
// (PowerShell / systemd / docker compose / YAML config). When the server line is
// unavailable a generic instruction is shown instead — the console never fabricates
// the closure itself. It renders for permission_blocked, and also for an
// elevation/unsupported cause when `grantMissing` says the permission isn't granted
// either: fixing only the capability would still leave it off.
//
// Desktop (embedded-Agent) mode has a fixed FullAccess policy, so the environment/
// YAML guidance is suppressed there — only the capability causes apply.
//
// Accessibility mirrors ConfirmDialog: role=dialog, aria-modal, focus moves in on
// open and is restored on close, Escape and backdrop close, Tab is trapped.
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { usePermissionMeta } from '../../composables/usePermissionMeta'

const props = defineProps<{
  open: boolean
  permId: string
  category: 'permission_blocked' | 'elevation' | 'unsupported' | 'dependency'
  // Full `NETTACT_AGENT_PERMISSIONS=…` line from the server. Absent when it could
  // not be resolved (then a generic instruction is shown).
  permissionsEnv?: string
  // Direct required parents, shown by the dependency cause.
  requires?: string[]
  // The permission is not granted either, so the grant block applies on top of an
  // elevation/unsupported cause.
  grantMissing?: boolean
  desktop?: boolean
}>()

const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()
const { permLabel, permPurpose, permPlatforms } = usePermissionMeta()

const dialog = ref<HTMLElement | null>(null)
const closeBtn = ref<HTMLButtonElement | null>(null)
let lastFocused: HTMLElement | null = null

const name = computed(() => permLabel(props.permId))
const purpose = computed(() => permPurpose(props.permId))
const platforms = computed(() => permPlatforms(props.permId))
const requiresLabel = computed(() =>
  (props.requires || []).map(permLabel).join(t('permRemediation.listSep')),
)

// Deep link into the permission reference for THIS permission. The docs give each
// entry an explicit `{#id-with-hyphens}` anchor precisely because VitePress's
// default slugifier drops the dots out of an ID, which would leave every link
// here pointing at nothing.
const docsUrl = computed(
  () => `${t('docs.permissionsUrl')}#${props.permId.replace(/\./g, '-')}`,
)

// A policy change is part of the fix whenever the permission isn't granted —
// always for permission_blocked, and on top of a capability cause when the caller
// flags it.
const needsGrant = computed(() => props.category === 'permission_blocked' || props.grantMissing === true)
// The env line is suppressed in desktop mode (FullAccess) and when the server did
// not attach one.
const showEnv = computed(() => needsGrant.value && !props.desktop && !!props.permissionsEnv)
const showEnvMissing = computed(() => needsGrant.value && !props.desktop && !props.permissionsEnv)

// The value after `NETTACT_AGENT_PERMISSIONS=` (the comma-joined closure).
const envValue = computed(() => {
  const line = props.permissionsEnv || ''
  const i = line.indexOf('=')
  return i >= 0 ? line.slice(i + 1) : ''
})
const envPerms = computed(() => envValue.value.split(',').map((s) => s.trim()).filter(Boolean))

type Tab = 'powershell' | 'systemd' | 'container' | 'yaml'
const tab = ref<Tab>('powershell')

const snippet = computed<string>(() => {
  const v = envValue.value
  switch (tab.value) {
    case 'powershell':
      return `$env:NETTACT_AGENT_PERMISSIONS = "${v}"\n.\\nettact-agent.exe`
    case 'systemd':
      return `# /etc/systemd/system/nettact-agent.service\n[Service]\nEnvironment=NETTACT_AGENT_PERMISSIONS=${v}`
    case 'container':
      return `# docker-compose.yml\nservices:\n  nettact-agent:\n    environment:\n      - NETTACT_AGENT_PERMISSIONS=${v}`
    case 'yaml':
      return `# nettact-agent.yaml\npermissions:\n${envPerms.value.map((p) => `  - ${p}`).join('\n')}`
  }
  return ''
})

// Local "copied" feedback, one per copy target so the label reverts independently.
const copiedKey = ref<'' | 'env' | 'snippet'>('')
function copyText(text: string, key: 'env' | 'snippet') {
  navigator.clipboard?.writeText(text)
  copiedKey.value = key
  window.setTimeout(() => {
    if (copiedKey.value === key) copiedKey.value = ''
  }, 1500)
}

function onClose() {
  emit('close')
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault()
    onClose()
    return
  }
  if (e.key !== 'Tab') return
  const focusable = dialog.value?.querySelectorAll<HTMLElement>(
    'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
  )
  if (!focusable || !focusable.length) return
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  const active = document.activeElement
  if (e.shiftKey && active === first) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && active === last) {
    e.preventDefault()
    first.focus()
  }
}

watch(
  () => props.open,
  async (open) => {
    if (open) {
      lastFocused = document.activeElement as HTMLElement | null
      tab.value = 'powershell'
      copiedKey.value = ''
      await nextTick()
      closeBtn.value?.focus()
    } else if (lastFocused) {
      lastFocused.focus()
      lastFocused = null
    }
  },
)
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="open" class="prd-backdrop" @click="onClose">
        <div
          ref="dialog"
          class="prd-dialog card"
          role="dialog"
          aria-modal="true"
          aria-labelledby="prd-title"
          @click.stop
          @keydown="onKeydown"
        >
          <header class="prd-head">
            <h3 id="prd-title" class="prd-title">{{ t('permRemediation.title') }}</h3>
            <button ref="closeBtn" type="button" class="prd-x" :aria-label="t('common.close')" @click="onClose">×</button>
          </header>

          <div class="prd-body">
            <div class="prd-perm">
              <span class="prd-name">{{ name }}</span>
              <code class="prd-id">{{ permId }}</code>
              <a class="prd-docs" :href="docsUrl" target="_blank" rel="noopener noreferrer">
                {{ t('permRemediation.docsLink') }} →
              </a>
            </div>
            <p v-if="purpose" class="prd-purpose">
              <span class="prd-purpose-label">{{ t('permRemediation.purposeLabel') }}</span>{{ purpose }}
            </p>

            <!-- why it is not in effect -->
            <template v-if="category === 'permission_blocked'">
              <p class="prd-intro">{{ t('permRemediation.blockedIntro') }}</p>
            </template>

            <!-- elevation: needs more OS privilege -->
            <template v-else-if="category === 'elevation'">
              <p class="prd-intro">
                {{ grantMissing ? t('permRemediation.elevationIntroUngranted') : t('permRemediation.elevationIntro') }}
              </p>
              <ol class="prd-steps">
                <li>{{ t('permRemediation.elevationWindows') }}</li>
                <li>{{ t('permRemediation.elevationOther') }}</li>
              </ol>
              <p class="prd-note strong">{{ t('permRemediation.reRunNote') }}</p>
            </template>

            <!-- dependency: granted and supported, but a required parent is not effective -->
            <template v-else-if="category === 'dependency'">
              <p class="prd-intro">{{ t('permRemediation.dependencyIntro') }}</p>
              <p v-if="requiresLabel" class="prd-note">
                {{ t('permRemediation.dependencyRequires', { names: requiresLabel }) }}
              </p>
            </template>

            <!-- unsupported: hard platform/build gap -->
            <template v-else>
              <p class="prd-intro">{{ t('permRemediation.unsupportedIntro') }}</p>
              <p class="prd-note">{{ platforms || t('permRemediation.unsupportedGeneric') }}</p>
            </template>

            <!-- how to grant it, when the policy is (part of) what's missing -->
            <template v-if="needsGrant">
              <p v-if="category !== 'permission_blocked'" class="prd-note strong">
                {{ t('permRemediation.alsoNotGranted') }}
              </p>
              <p class="prd-note">{{ t('permRemediation.policyNote') }}</p>

              <template v-if="desktop">
                <p class="prd-note">{{ t('permRemediation.desktopNote') }}</p>
              </template>

              <template v-else-if="showEnv">
                <p class="prd-label">{{ t('permRemediation.envLabel') }}</p>
                <div class="code-wrap">
                  <button class="copy" @click="copyText(permissionsEnv || '', 'env')">
                    {{ copiedKey === 'env' ? t('common.saved') : t('agents.copy') }}
                  </button>
                  <pre><code>{{ permissionsEnv }}</code></pre>
                </div>

                <p class="prd-label">{{ t('permRemediation.runModeLabel') }}</p>
                <div class="tabs" role="tablist">
                  <button
                    v-for="k in (['powershell', 'systemd', 'container', 'yaml'] as Tab[])"
                    :key="k"
                    class="tab"
                    role="tab"
                    :class="{ active: tab === k }"
                    :aria-selected="tab === k"
                    @click="tab = k"
                  >
                    {{ t(`permRemediation.tab_${k}`) }}
                  </button>
                </div>
                <div class="code-wrap">
                  <button class="copy" @click="copyText(snippet, 'snippet')">
                    {{ copiedKey === 'snippet' ? t('common.saved') : t('agents.copy') }}
                  </button>
                  <pre><code>{{ snippet }}</code></pre>
                </div>
                <p class="prd-note">{{ t('permRemediation.yamlNote') }}</p>
                <p class="prd-note strong">{{ t('permRemediation.restartNote') }}</p>
              </template>

              <template v-else-if="showEnvMissing">
                <p class="prd-note">{{ t('permRemediation.envMissing', { name }) }}</p>
                <p class="prd-note strong">{{ t('permRemediation.restartNote') }}</p>
              </template>
            </template>
          </div>

          <div class="prd-actions">
            <button type="button" class="btn btn-primary" @click="onClose">{{ t('common.close') }}</button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.prd-backdrop {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(2px);
}
.prd-dialog {
  width: 100%;
  max-width: 560px;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  padding: 0;
}
.prd-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 16px 20px 12px;
  border-bottom: 1px solid var(--border);
}
.prd-title {
  margin: 0;
  font-size: 16px;
  flex: 1;
}
.prd-x {
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
  padding: 0 4px;
}
.prd-x:hover {
  color: var(--text);
}
.prd-body {
  overflow-y: auto;
  padding: 14px 20px 4px;
}
.prd-perm {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.prd-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}
.prd-id {
  font-family: var(--mono, monospace);
  font-size: 11.5px;
  color: var(--text-muted);
  background: var(--surface-2);
  padding: 1px 6px;
  border-radius: var(--radius-sm);
}
.prd-docs {
  margin-left: auto;
  font-size: 12px;
  color: var(--primary);
  white-space: nowrap;
}
.prd-purpose {
  margin: 8px 0 0;
  font-size: 12.5px;
  color: var(--text-dim);
  line-height: 1.55;
}
.prd-purpose-label {
  color: var(--text-muted);
  margin-right: 6px;
}
.prd-intro {
  margin: 12px 0 0;
  font-size: 13px;
  color: var(--text);
  line-height: 1.6;
}
.prd-note {
  margin: 8px 0 0;
  font-size: 12.5px;
  color: var(--text-dim);
  line-height: 1.6;
}
.prd-note.strong {
  color: var(--text);
}
.prd-label {
  margin: 14px 0 6px;
  font-size: 11.5px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}
.prd-steps {
  margin: 10px 0 0;
  padding-left: 20px;
  display: flex;
  flex-direction: column;
  gap: 7px;
  font-size: 12.5px;
  color: var(--text-dim);
  line-height: 1.6;
}
.tabs {
  display: flex;
  gap: 6px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 10px;
  flex-wrap: wrap;
}
.tab {
  padding: 6px 12px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: 12.5px;
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
.code-wrap {
  position: relative;
  margin-bottom: 4px;
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
  padding: 12px 14px;
  overflow-x: auto;
  background: var(--code-bg, var(--surface-2));
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}
code {
  font-family: var(--mono, monospace);
  font-size: 12px;
  line-height: 1.6;
  color: var(--text);
  white-space: pre;
  background: none;
  border: none;
  padding: 0;
}
.prd-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 12px 20px 16px;
  border-top: 1px solid var(--border);
}
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.18s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>

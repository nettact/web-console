<script setup lang="ts">
// Reinstall dialog for an agent row (AGENT-006). Opens from the status list's
// row actions, mints a one-time token bound to that agent, and shows the
// platform install commands with the token already embedded (reusing
// EnrollExamples, the same component the "add agent" tab uses).
//
// The token is generated once per open and shown exactly once — closing and
// reopening mints a fresh one, so there is no risk of showing a used token. The
// copy explains the asymmetry on purpose: the install command wipes the machine's
// local identity/queue, while the server keeps the agent's full history because
// it rejoins under the SAME agent_id.
//
// Accessibility mirrors ConfirmDialog / PermissionRemediationDialog: role=dialog,
// aria-modal, focus moves in on open and is restored on close, Escape and
// backdrop close, Tab is trapped.
import { nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { api, type AgentStatusRow } from '../api'
import EnrollExamples from './EnrollExamples.vue'

const props = defineProps<{ open: boolean; agent: AgentStatusRow | null }>()
const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()

const dialog = ref<HTMLElement | null>(null)
const closeBtn = ref<HTMLButtonElement | null>(null)
let lastFocused: HTMLElement | null = null

const token = ref('')
const error = ref('')
const copied = ref(false)
const copyFailed = ref(false)

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

async function copyToken() {
  copyFailed.value = false
  try {
    if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable')
    await navigator.clipboard.writeText(token.value)
  } catch {
    // Plain-HTTP LAN consoles have no clipboard API; the token below is
    // selectable text, so don't claim a copy that never happened.
    copyFailed.value = true
    return
  }
  copied.value = true
  window.setTimeout(() => (copied.value = false), 1500)
}

// Monotonic generation for the in-flight mint. Every open/close bumps it, so a
// stale response (close A's dialog while its request is pending, open B's) can
// never overwrite the current dialog's token with the previous agent's.
let tokenRequest = 0

watch(
  () => props.open,
  async (open) => {
    const request = ++tokenRequest
    if (open) {
      lastFocused = document.activeElement as HTMLElement | null
      token.value = ''
      error.value = ''
      copied.value = false
      copyFailed.value = false
      await nextTick()
      closeBtn.value?.focus()
      if (!props.agent) return
      try {
        const r = await api.createReinstallToken(props.agent.id)
        if (request !== tokenRequest) return
        token.value = r.token
      } catch (e) {
        if (request !== tokenRequest) return
        error.value = String((e as Error).message || e)
      }
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
      <div v-if="open" class="rd-backdrop" @click="onClose">
        <div
          ref="dialog"
          class="rd-dialog card"
          role="dialog"
          aria-modal="true"
          aria-labelledby="rd-title"
          @click.stop
          @keydown="onKeydown"
        >
          <header class="rd-head">
            <h3 id="rd-title" class="rd-title">{{ t('agents.reinstallTitle') }}</h3>
            <button ref="closeBtn" type="button" class="rd-x" :aria-label="t('common.close')" @click="onClose">×</button>
          </header>

          <div class="rd-body">
            <p v-if="error" class="rd-error">{{ error }}</p>
            <template v-else-if="token">
              <p class="rd-agent">{{ t('agents.reinstallTarget') }} <code>{{ agent?.id }}</code></p>
              <ul class="rd-hints">
                <li>{{ t('agents.reinstallHintWipe') }}</li>
                <li>{{ t('agents.reinstallHintHistory') }}</li>
                <li>{{ t('agents.reinstallHintToken') }}</li>
              </ul>
              <div class="rd-token">
                <span class="rd-token-label">{{ t('agents.tokenOnce') }}</span>
                <code>{{ token }}</code>
                <button class="link-btn" @click="copyToken">{{ copied ? t('common.saved') : t('agents.copy') }}</button>
              </div>
              <p v-if="copyFailed" class="rd-copy-failed">{{ t('agents.copyUnavailable') }}</p>
              <EnrollExamples class="rd-examples" :token="token" />
            </template>
            <p v-else class="rd-minting">{{ t('agents.reinstallMinting') }}</p>
          </div>

          <div class="rd-actions">
            <button type="button" class="btn btn-primary" @click="onClose">{{ t('common.close') }}</button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.rd-backdrop {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal, 60);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(2px);
}
.rd-dialog {
  width: 100%;
  max-width: 620px;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  padding: 0;
}
.rd-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 16px 20px 12px;
  border-bottom: 1px solid var(--border);
}
.rd-title {
  margin: 0;
  font-size: 16px;
  flex: 1;
}
.rd-x {
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
  padding: 0 4px;
}
.rd-x:hover {
  color: var(--text);
}
.rd-body {
  overflow-y: auto;
  padding: 14px 20px 4px;
}
.rd-error {
  margin: 0 0 12px;
  font-size: 13px;
  color: var(--color-danger, var(--danger, #d33));
}
.rd-agent {
  margin: 0 0 10px;
  font-size: 13px;
  color: var(--text);
}
.rd-agent code {
  font-family: var(--mono, monospace);
  font-size: 12px;
  color: var(--text-muted);
  background: var(--surface-2);
  padding: 1px 6px;
  border-radius: var(--radius-sm);
}
.rd-hints {
  margin: 0 0 14px;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12.5px;
  color: var(--text-dim);
  line-height: 1.55;
}
.rd-token {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.rd-token-label {
  font-size: 12px;
  color: var(--text-muted);
}
.rd-token code {
  font-family: var(--mono, monospace);
  font-size: 12px;
  word-break: break-all;
  color: var(--text);
  background: var(--surface-2);
  padding: 3px 8px;
  border-radius: var(--radius-sm);
}
.rd-minting {
  margin: 0;
  font-size: 13px;
  color: var(--text-dim);
}
.rd-copy-failed {
  margin: 0 0 12px;
  font-size: 12.5px;
  color: var(--color-warning-text, var(--text-dim));
}
.rd-actions {
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

<script setup lang="ts">
// Accessible confirmation modal for destructive mutations (delete group/rule,
// move/delete target). Proper dialog semantics: role="dialog", aria-modal, a
// title referenced by aria-labelledby and a description by aria-describedby.
// Opening moves focus into the dialog (the cancel button — the least destructive
// action), traps Tab within it, closes on Escape/backdrop, and restores focus to
// the previously focused element on close. Confirmation is never automatic: the
// parent decides what to do on `confirm`.
import { nextTick, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    open: boolean
    title: string
    // Body text. An array renders one <p> per line so multi-consequence warnings
    // (rules removed / alerts terminated / targets moved) stay legible.
    message: string | string[]
    confirmLabel: string
    cancelLabel: string
    tone?: 'default' | 'danger'
    busy?: boolean
  }>(),
  { tone: 'default', busy: false },
)

const emit = defineEmits<{ confirm: []; cancel: [] }>()

const dialog = ref<HTMLElement | null>(null)
const cancelBtn = ref<HTMLButtonElement | null>(null)
let lastFocused: HTMLElement | null = null

const lines = () => (Array.isArray(props.message) ? props.message : [props.message])

watch(
  () => props.open,
  async (open) => {
    if (open) {
      lastFocused = document.activeElement as HTMLElement | null
      await nextTick()
      cancelBtn.value?.focus()
    } else if (lastFocused) {
      lastFocused.focus()
      lastFocused = null
    }
  },
)

function onCancel() {
  if (!props.busy) emit('cancel')
}
function onConfirm() {
  if (!props.busy) emit('confirm')
}

// Keep Tab focus inside the dialog (only two buttons, so cycle between them).
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault()
    onCancel()
    return
  }
  if (e.key !== 'Tab') return
  const focusable = dialog.value?.querySelectorAll<HTMLElement>('button:not([disabled])')
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
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="open" class="cd-backdrop" @click="onCancel">
        <div
          ref="dialog"
          class="cd-dialog card"
          role="dialog"
          aria-modal="true"
          aria-labelledby="cd-title"
          aria-describedby="cd-body"
          @click.stop
          @keydown="onKeydown"
        >
          <h3 id="cd-title" class="cd-title">{{ title }}</h3>
          <div id="cd-body" class="cd-body">
            <p v-for="(line, i) in lines()" :key="i">{{ line }}</p>
          </div>
          <div class="cd-actions">
            <button ref="cancelBtn" type="button" class="btn" :disabled="busy" @click="onCancel">
              {{ cancelLabel }}
            </button>
            <button
              type="button"
              class="btn"
              :class="tone === 'danger' ? 'btn-danger' : 'btn-primary'"
              :disabled="busy"
              @click="onConfirm"
            >
              {{ confirmLabel }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.cd-backdrop {
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
.cd-dialog {
  width: 100%;
  max-width: 460px;
  padding: 20px 22px;
}
.cd-title {
  margin: 0 0 10px;
  font-size: 16px;
}
.cd-body {
  margin: 0 0 18px;
  font-size: 13.5px;
  color: var(--text-dim);
  line-height: 1.6;
}
.cd-body p {
  margin: 0 0 6px;
}
.cd-body p:last-child {
  margin-bottom: 0;
}
.cd-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
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

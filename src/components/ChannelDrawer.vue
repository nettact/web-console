<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps<{
  open: boolean
  title: string
  description?: string
}>()
const emit = defineEmits<{ (e: 'close'): void }>()

const panel = ref<HTMLElement | null>(null)
const closeButton = ref<HTMLButtonElement | null>(null)
let returnFocus: HTMLElement | null = null
let previousOverflow = ''

function close() {
  emit('close')
}

function focusableElements(): HTMLElement[] {
  if (!panel.value) return []
  return Array.from(
    panel.value.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], summary',
    ),
  )
}

function onKeydown(event: KeyboardEvent) {
  if (!props.open) return
  if (event.key === 'Escape') {
    event.preventDefault()
    close()
    return
  }
  if (event.key !== 'Tab') return
  const items = focusableElements()
  if (!items.length) return
  const first = items[0]
  const last = items[items.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

watch(
  () => props.open,
  async (open) => {
    if (open) {
      returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
      previousOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      window.addEventListener('keydown', onKeydown)
      await nextTick()
      closeButton.value?.focus()
    } else {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeydown)
      returnFocus?.focus()
      returnFocus = null
    }
  },
)

onBeforeUnmount(() => {
  document.body.style.overflow = previousOverflow
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <Teleport to="body">
    <Transition name="channel-drawer">
      <div v-if="open" class="channel-drawer-layer" @mousedown.self="close">
        <aside ref="panel" class="channel-drawer-panel" role="dialog" aria-modal="true" :aria-label="title">
          <header class="channel-drawer-head">
            <div>
              <h2>{{ title }}</h2>
              <p v-if="description">{{ description }}</p>
            </div>
            <button ref="closeButton" type="button" class="channel-drawer-close" :aria-label="$t('common.close')" @click="close">
              ×
            </button>
          </header>
          <div class="channel-drawer-body">
            <slot />
          </div>
        </aside>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.channel-drawer-layer {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  display: flex;
  justify-content: flex-end;
  background: color-mix(in oklch, var(--color-backdrop) 24%, transparent);
}
.channel-drawer-panel {
  width: min(38rem, 100%);
  height: 100dvh;
  display: flex;
  flex-direction: column;
  color: var(--color-ink);
  background: var(--glass-specular), var(--color-paper-2);
  border-left: var(--rule-hair) solid var(--color-rule-2);
  box-shadow: var(--shadow-card);
}
.channel-drawer-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-md);
  padding: var(--space-md);
  border-bottom: var(--rule-hair) solid var(--color-rule);
}
.channel-drawer-head h2 {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--text-xl);
  letter-spacing: 0;
}
.channel-drawer-head p {
  margin: var(--space-3xs) 0 0;
  color: var(--color-muted);
  font-size: var(--text-sm);
}
.channel-drawer-close {
  display: grid;
  place-items: center;
  width: 2.75rem;
  height: 2.75rem;
  flex: 0 0 auto;
  border: var(--rule-hair) solid var(--color-rule);
  border-radius: var(--radius-xs);
  color: var(--color-ink-2);
  background: var(--color-glass-subtle);
  font-size: 1.4rem;
  cursor: pointer;
}
.channel-drawer-close:hover { color: var(--color-ink); background: var(--color-glass-hover); }
.channel-drawer-close:focus-visible { outline: var(--rule-fine) solid var(--color-focus); outline-offset: var(--space-3xs); }
.channel-drawer-close:active { transform: translateY(1px); }
.channel-drawer-body {
  min-height: 0;
  flex: 1;
  overflow-y: auto;
  padding: var(--space-md);
}
.channel-drawer-enter-active,
.channel-drawer-leave-active { transition: opacity var(--dur-short) var(--ease-out); }
.channel-drawer-enter-active .channel-drawer-panel,
.channel-drawer-leave-active .channel-drawer-panel { transition: transform var(--dur-short) var(--ease-out); }
.channel-drawer-enter-from,
.channel-drawer-leave-to { opacity: 0; }
.channel-drawer-enter-from .channel-drawer-panel,
.channel-drawer-leave-to .channel-drawer-panel { transform: translateX(1.5rem); }
@media (max-width: 600px) {
  .channel-drawer-panel { width: 100%; border-left: 0; }
  .channel-drawer-head,
  .channel-drawer-body { padding: var(--space-sm); }
}
@media (prefers-reduced-motion: reduce) {
  .channel-drawer-enter-active,
  .channel-drawer-leave-active,
  .channel-drawer-enter-active .channel-drawer-panel,
  .channel-drawer-leave-active .channel-drawer-panel { transition-duration: var(--dur-micro); }
  .channel-drawer-enter-from .channel-drawer-panel,
  .channel-drawer-leave-to .channel-drawer-panel { transform: none; }
}
</style>

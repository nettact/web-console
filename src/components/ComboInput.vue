<script setup lang="ts">
// An editable combo-box: a free-text input plus a dropdown button that shows the
// full option list (no input filtering — the list is short and fixed). The user
// can pick an option or type their own value.
//
// The list is teleported to <body> and positioned with fixed coordinates so it is
// never clipped by an ancestor's overflow/border-radius (panels, cards, etc.).
import { ref, onBeforeUnmount, nextTick } from 'vue'

defineProps<{ modelValue: string; options: string[]; placeholder?: string }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>()

const open = ref(false)
const root = ref<HTMLElement | null>(null)
const inputEl = ref<HTMLInputElement | null>(null)
const listEl = ref<HTMLElement | null>(null)
const listStyle = ref<Record<string, string>>({})

function place() {
  const el = inputEl.value
  if (!el) return
  const r = el.getBoundingClientRect()
  listStyle.value = {
    position: 'fixed',
    top: `${r.bottom + 4}px`,
    left: `${r.left}px`,
    width: `${r.width}px`,
  }
}
async function show() {
  if (open.value) return
  open.value = true
  window.addEventListener('scroll', onViewportChange, true)
  window.addEventListener('resize', onViewportChange)
  await nextTick()
  place()
}
function hide() {
  if (!open.value) return
  open.value = false
  window.removeEventListener('scroll', onViewportChange, true)
  window.removeEventListener('resize', onViewportChange)
}
function toggle() {
  open.value ? hide() : show()
}
function onViewportChange() {
  place()
}
function pick(o: string) {
  emit('update:modelValue', o)
  hide()
}
function onInput(e: Event) {
  emit('update:modelValue', (e.target as HTMLInputElement).value)
}
function onDocClick(e: MouseEvent) {
  const t = e.target as Node
  if (root.value?.contains(t) || listEl.value?.contains(t)) return
  hide()
}
document.addEventListener('click', onDocClick)
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick)
  window.removeEventListener('scroll', onViewportChange, true)
  window.removeEventListener('resize', onViewportChange)
})
</script>

<template>
  <div class="combo" ref="root">
    <input
      ref="inputEl"
      class="combo-input"
      :value="modelValue"
      :placeholder="placeholder"
      @input="onInput"
      @focus="show"
    />
    <button type="button" class="combo-toggle" tabindex="-1" @click="toggle">▾</button>
    <Teleport to="body">
      <ul v-if="open" ref="listEl" class="combo-list" :style="listStyle">
        <li
          v-for="o in options"
          :key="o"
          :class="{ active: o === modelValue }"
          @mousedown.prevent="pick(o)"
        >
          {{ o }}
        </li>
      </ul>
    </Teleport>
  </div>
</template>

<style scoped>
.combo {
  position: relative;
  display: flex;
  align-items: stretch;
}
.combo-input {
  width: 100%;
  padding-right: 38px; /* room for the toggle */
}
.combo-toggle {
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  width: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--text-dim);
  font-size: 12px;
  cursor: pointer;
}
.combo-toggle:hover {
  color: var(--color-accent-text);
}
</style>

<style>
/* Teleported to <body>, so the list is styled globally (not scoped). */
.combo-list {
  z-index: 1000;
  margin: 0;
  padding: 4px;
  list-style: none;
  max-height: 280px;
  overflow-y: auto;
  background: var(--surface-solid);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
}
.combo-list li {
  padding: 9px 12px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  color: var(--text);
  font-size: 13.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.combo-list li:hover {
  background: var(--surface-2);
}
.combo-list li.active {
  background: var(--primary-soft);
  color: var(--color-accent-text);
}
</style>

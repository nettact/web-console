<script setup lang="ts">
// A small "!" help icon with a hover/focus tooltip. The tooltip is teleported to
// <body> and positioned with fixed coordinates so it is never clipped by an
// ancestor's overflow (e.g. the stat cards use overflow:hidden). Multi-line text
// (\n) renders as separate lines.
import { ref, nextTick, onBeforeUnmount } from 'vue'

defineProps<{ text: string }>()

const show = ref(false)
const iconEl = ref<HTMLElement | null>(null)
const tipEl = ref<HTMLElement | null>(null)
const style = ref<Record<string, string>>({ position: 'fixed', top: '-9999px', left: '-9999px' })

function place() {
  const ic = iconEl.value
  const tip = tipEl.value
  if (!ic || !tip) return
  const r = ic.getBoundingClientRect()
  const w = tip.offsetWidth
  const vw = window.innerWidth
  const left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, vw - w - 8))
  style.value = { position: 'fixed', top: `${r.bottom + 6}px`, left: `${left}px` }
}
async function open() {
  if (show.value) return
  show.value = true
  window.addEventListener('scroll', place, true)
  window.addEventListener('resize', place)
  await nextTick()
  place()
}
function close() {
  show.value = false
  window.removeEventListener('scroll', place, true)
  window.removeEventListener('resize', place)
}
onBeforeUnmount(close)
</script>

<template>
  <span
    ref="iconEl"
    class="info-ic"
    tabindex="0"
    @mouseenter="open"
    @mouseleave="close"
    @focus="open"
    @blur="close"
    >!
    <Teleport to="body">
      <span v-if="show" ref="tipEl" class="info-tip" :style="style">{{ text }}</span>
    </Teleport>
  </span>
</template>

<style scoped>
.info-ic {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  margin-left: 5px;
  border-radius: 50%;
  border: 1px solid var(--border-strong);
  color: var(--text-dim);
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
  cursor: help;
  vertical-align: middle;
}
.info-ic:hover,
.info-ic:focus {
  color: var(--primary);
  border-color: var(--primary);
  outline: none;
}
</style>

<style>
/* Teleported to <body>, so styled globally (not scoped). */
.info-tip {
  z-index: 1000;
  width: max-content;
  max-width: 340px;
  padding: 10px 12px;
  white-space: pre-line;
  text-align: left;
  font-size: 12px;
  font-weight: 400;
  line-height: 1.6;
  color: var(--text);
  background: var(--surface-solid);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
  pointer-events: none;
}
</style>

<script setup lang="ts">
// Transient toast host, mounted once in App.vue. Renders the module-level queue
// from ../toasts; each toast auto-dismisses on its own timer.
import { RouterLink } from 'vue-router'
import { useToasts, dismissToast } from '../toasts'

const state = useToasts()
</script>

<template>
  <div class="toast-host" aria-live="polite" aria-atomic="false">
    <div v-for="tst in state.toasts" :key="tst.id" class="toast" :class="`is-${tst.tone}`" role="status">
      <span class="bar" aria-hidden="true"></span>
      <div class="body">
        <p class="title">{{ tst.title }}</p>
        <p v-if="tst.body" class="text">{{ tst.body }}</p>
        <RouterLink v-if="tst.to" class="link" :to="tst.to" @click="dismissToast(tst.id)">
          {{ $t('issues.viewDetail') }}
        </RouterLink>
      </div>
      <button class="x" :aria-label="$t('common.close')" @click="dismissToast(tst.id)">×</button>
    </div>
  </div>
</template>

<style scoped>
.toast-host {
  position: fixed;
  right: var(--space-md);
  bottom: var(--space-md);
  z-index: var(--z-toast);
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  width: min(22rem, calc(100% - var(--space-lg)));
}
.toast {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  padding: var(--space-xs);
  border: var(--rule-hair) solid var(--color-rule-2);
  border-radius: var(--radius-card);
  background: var(--color-glass-strong);
  box-shadow: var(--shadow-float);
  backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  overflow: hidden;
}
.toast .bar {
  width: var(--space-2xs);
  height: var(--space-2xs);
  flex: none;
  border-radius: var(--radius-pill);
}
.toast.is-info .bar {
  background: var(--primary);
}
.toast.is-warn .bar {
  background: var(--color-warning);
}
.toast.is-danger .bar {
  background: var(--danger);
}
.body {
  flex: 1;
  min-width: 0;
}
.title {
  margin: 0;
  color: var(--color-ink);
  font-size: var(--text-sm);
  font-weight: 650;
}
.text {
  margin: var(--space-3xs) 0 0;
  color: var(--color-ink-2);
  font-size: var(--text-xs);
  word-break: break-word;
}
.link {
  display: inline-block;
  margin-top: var(--space-2xs);
  color: var(--color-accent);
  font-size: var(--text-xs);
}
.x {
  display: grid;
  place-items: center;
  width: 2.75rem;
  height: 2.75rem;
  border: none;
  background: transparent;
  color: var(--color-muted);
  font-size: var(--text-lg);
  line-height: 1;
  cursor: pointer;
  padding: 0;
}
.x:hover {
  color: var(--text);
}
@media (max-width: 30rem) {
  .toast-host {
    right: var(--space-2xs);
    bottom: var(--space-2xs);
    width: calc(100% - var(--space-sm));
  }
}
</style>

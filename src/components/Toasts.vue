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
  right: 20px;
  bottom: 20px;
  z-index: 60;
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-width: 360px;
}
.toast {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 12px 12px 16px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface);
  box-shadow: 0 12px 30px -12px rgba(0, 0, 0, 0.45);
  overflow: hidden;
}
.toast .bar {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
}
.toast.is-info .bar {
  background: var(--primary);
}
.toast.is-warn .bar {
  background: var(--warn, #fbbf24);
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
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}
.text {
  margin: 3px 0 0;
  font-size: 12px;
  color: var(--text-dim);
  word-break: break-word;
}
.link {
  display: inline-block;
  margin-top: 6px;
  font-size: 12px;
  color: var(--primary);
}
.x {
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  padding: 0 2px;
}
.x:hover {
  color: var(--text);
}
</style>

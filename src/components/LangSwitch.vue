<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { setLocale, type Lang } from '../i18n'

const { locale } = useI18n()
const pick = (l: Lang) => setLocale(l)
</script>

<template>
  <div class="lang-switch" role="group" aria-label="Language">
    <button type="button" :class="{ active: locale === 'zh' }" @click="pick('zh')">中</button>
    <button type="button" :class="{ active: locale === 'en' }" @click="pick('en')">EN</button>
  </div>
</template>

<style scoped>
.lang-switch {
  display: inline-flex;
  min-height: 2.75rem;
  padding: var(--space-3xs);
  gap: var(--space-3xs);
  border: var(--rule-hair) solid var(--color-rule);
  border-radius: var(--radius-pill);
  background: var(--color-glass-subtle);
}
.lang-switch button {
  min-width: 2.25rem;
  border: none;
  background: transparent;
  color: var(--color-ink-2);
  font-family: var(--font-body);
  font-size: var(--text-xs);
  font-weight: 650;
  line-height: 1;
  padding: var(--space-2xs);
  border-radius: var(--radius-pill);
  cursor: pointer;
  transition:
    transform var(--dur-micro) var(--ease-out),
    opacity var(--dur-micro) var(--ease-out);
}
.lang-switch button:hover {
  color: var(--color-ink);
}
.lang-switch button.active {
  color: var(--color-primary-action-text);
  background: var(--color-primary-action-bg);
}
</style>

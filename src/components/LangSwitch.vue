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
  padding: 3px;
  gap: 2px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
}
.lang-switch button {
  border: none;
  background: transparent;
  color: var(--text-dim);
  font: inherit;
  font-size: 12.5px;
  font-weight: 600;
  line-height: 1;
  padding: 4px 10px;
  border-radius: var(--radius-pill);
  cursor: pointer;
  transition: background 0.16s, color 0.16s;
}
.lang-switch button:hover {
  color: var(--text);
}
.lang-switch button.active {
  color: #04121c;
  background: linear-gradient(150deg, #7dd3fc, var(--primary-strong));
}
</style>

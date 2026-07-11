<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { theme, toggleTheme } from '../theme'

const { t } = useI18n()

// Icon shows the mode you'd switch TO: a moon while in light, a sun while in dark.
const isDark = computed(() => theme.value === 'dark')
const label = computed(() => (isDark.value ? t('app.themeLight') : t('app.themeDark')))
</script>

<template>
  <button
    type="button"
    class="theme-switch btn btn-ghost"
    :title="label"
    :aria-label="label"
    @click="toggleTheme"
  >
    <!-- sun: click to go light (shown in dark mode) -->
    <svg v-if="isDark" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
      stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
    <!-- moon: click to go dark (shown in light mode) -->
    <svg v-else viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
      stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
    </svg>
  </button>
</template>

<style scoped>
.theme-switch {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  padding: 0;
  border-radius: var(--radius-pill);
  color: var(--text-dim);
}
.theme-switch:hover {
  color: var(--text);
}
</style>

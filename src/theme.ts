import { ref } from 'vue'

export type Theme = 'dark' | 'light'
// NOTE: index.html has an inline <head> script that applies the theme before
// first paint (to avoid a flash). It duplicates this key + the detect() order —
// keep both in sync when changing either.
const STORAGE_KEY = 'nettact.theme'

// Detection order: saved preference → OS `prefers-color-scheme` → fall back to dark.
function detect(): Theme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'dark' || saved === 'light') return saved
  } catch {
    /* localStorage may be unavailable (private mode / SSR) — fall through */
  }
  try {
    if (window.matchMedia?.('(prefers-color-scheme: light)').matches) return 'light'
  } catch {
    /* matchMedia may be unavailable — fall through */
  }
  return 'dark'
}

const initial = detect()

// Reactive so canvas-based views (e.g. MetricChart) can re-render their palette
// when the theme changes — CSS custom properties alone don't reach ECharts.
export const theme = ref<Theme>(initial)

function apply(next: Theme): void {
  // `:root[data-theme='light']` in style.css overrides the dark defaults.
  document.documentElement.dataset.theme = next
}

export function setTheme(next: Theme): void {
  theme.value = next
  apply(next)
  try {
    localStorage.setItem(STORAGE_KEY, next)
  } catch {
    /* ignore persistence failure */
  }
}

export function toggleTheme(): void {
  setTheme(theme.value === 'dark' ? 'light' : 'dark')
}

// Apply before the app mounts so there is no dark→light flash on load.
apply(initial)

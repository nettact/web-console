import { ref } from 'vue'

// A trimmed copy of the console's src/theme.ts. It is a copy rather than an
// import because this app must not depend on the console's module graph — but it
// shares the STORAGE KEY on purpose: on a same-origin deployment, a visitor who
// picked light mode in the console should not be handed a dark status page.
//
// NOTE: index.html has an inline <head> script that applies the theme before
// first paint. It duplicates this key + the detect() order — keep both in sync.

export type Theme = 'dark' | 'light'
const STORAGE_KEY = 'nettact.theme'

// Detection order: saved preference → OS `prefers-color-scheme` → fall back to dark.
function detect(): Theme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'dark' || saved === 'light') return saved
  } catch {
    /* localStorage may be unavailable (private mode) — fall through */
  }
  try {
    if (window.matchMedia?.('(prefers-color-scheme: light)').matches) return 'light'
  } catch {
    /* matchMedia may be unavailable — fall through */
  }
  return 'dark'
}

const initial = detect()

export const theme = ref<Theme>(initial)

function apply(next: Theme): void {
  document.documentElement.dataset.theme = next
}

export function toggleTheme(): void {
  const next: Theme = theme.value === 'dark' ? 'light' : 'dark'
  theme.value = next
  apply(next)
  try {
    localStorage.setItem(STORAGE_KEY, next)
  } catch {
    /* ignore persistence failure */
  }
}

apply(initial)

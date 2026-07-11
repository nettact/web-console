import { createI18n } from 'vue-i18n'
import zh from './locales/zh'
import en from './locales/en'

export type Lang = 'zh' | 'en'
const STORAGE_KEY = 'nettact.lang'

// Detection order: saved preference → browser language → fall back to zh.
function detect(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'zh' || saved === 'en') return saved
  } catch {
    /* localStorage may be unavailable (private mode / SSR) — fall through */
  }
  const nav = (navigator.language || '').toLowerCase()
  return nav.startsWith('zh') ? 'zh' : 'en'
}

const initial = detect()

export const i18n = createI18n({
  legacy: false, // Composition API mode ($t / useI18n), matches the <script setup> SFCs
  locale: initial,
  fallbackLocale: 'zh',
  messages: { zh, en },
})

export function setLocale(lang: Lang): void {
  i18n.global.locale.value = lang
  try {
    localStorage.setItem(STORAGE_KEY, lang)
  } catch {
    /* ignore persistence failure */
  }
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en'
}

// Maps our app locale to a JS Intl locale for toLocaleString/toLocaleTimeString.
export function toDateLocale(lang: string): string {
  return lang === 'zh' ? 'zh-CN' : 'en-US'
}

document.documentElement.lang = toDateLocale(initial)

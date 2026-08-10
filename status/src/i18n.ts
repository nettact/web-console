import { createI18n } from 'vue-i18n'
import zh from './locales/zh'
import en from './locales/en'

// Same key and same detection order as the console's src/i18n.ts, so a visitor
// who set English there does not get Chinese here on a same-origin deployment.
export type Lang = 'zh' | 'en'
const STORAGE_KEY = 'nettact.lang'

// Detection order: saved preference → browser language → fall back to zh.
function detect(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'zh' || saved === 'en') return saved
  } catch {
    /* localStorage may be unavailable (private mode) — fall through */
  }
  const nav = (navigator.language || '').toLowerCase()
  return nav.startsWith('zh') ? 'zh' : 'en'
}

const initial = detect()

export const i18n = createI18n({
  legacy: false,
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

/** Maps our app locale to a JS Intl locale for toLocaleString and friends. */
export function toDateLocale(lang: string): string {
  return lang === 'zh' ? 'zh-CN' : 'en-US'
}

document.documentElement.lang = toDateLocale(initial)

import { describe, it, expect } from 'vitest'
import { createI18n } from 'vue-i18n'
import zh from './zh'
import en from './en'

// The incident timeline renders each entry via kindLabel(k) → te/t('incidents.kind.'+k),
// where k is a dotted server code like "alert.raised" or "incident.terminated".
// vue-i18n treats those dots as nested path segments, so the kind sub-tree MUST be
// nested (kind.alert.raised), not flat ('alert.raised'). This guards that every
// server-emitted timeline kind resolves in both locales instead of silently
// falling back to the raw code.
const KINDS = [
  'alert.raised',
  'alert.resolved',
  'alert.terminated',
  'incident.opened',
  'incident.updated',
  'incident.resolved',
  'incident.terminated',
]

describe('incident timeline kind labels', () => {
  for (const locale of ['zh', 'en'] as const) {
    const i18n = createI18n({ legacy: false, locale, fallbackLocale: 'zh', messages: { zh, en } })
    const t = i18n.global.t as (k: string) => string
    const te = i18n.global.te as (k: string) => boolean
    for (const k of KINDS) {
      it(`${locale}: resolves incidents.kind.${k}`, () => {
        const path = `incidents.kind.${k}`
        expect(te(path)).toBe(true)
        expect(t(path)).not.toBe(path)
      })
    }
  }
})

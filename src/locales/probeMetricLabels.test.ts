import { createI18n } from 'vue-i18n'
import { describe, expect, it } from 'vitest'
import { HTTP_DIAGNOSTIC_KINDS, PROBE_ERROR_KINDS } from '../lib/metricMeta'
import zh from './zh'
import en from './en'

describe('probe error metric labels', () => {
  for (const locale of ['zh', 'en'] as const) {
    const i18n = createI18n({ legacy: false, locale, fallbackLocale: 'zh', messages: { zh, en } })
    const t = i18n.global.t as (key: string) => string
    const te = i18n.global.te as (key: string) => boolean

    for (const kind of PROBE_ERROR_KINDS) {
      it(`${locale}: resolves ${kind}`, () => {
        const path = `metrics.metric.${kind.replace(/\./g, '_')}`
        expect(te(path)).toBe(true)
        expect(t(path)).not.toBe(path)
        expect(t(path)).not.toBe(kind)
      })
    }
  }
})

describe('HTTP diagnostic metric labels', () => {
  for (const locale of ['zh', 'en'] as const) {
    const i18n = createI18n({ legacy: false, locale, fallbackLocale: 'zh', messages: { zh, en } })
    const t = i18n.global.t as (key: string) => string
    const te = i18n.global.te as (key: string) => boolean

    for (const namespace of ['monitoring.metric', 'metrics.metric']) {
      for (const kind of HTTP_DIAGNOSTIC_KINDS) {
        it(`${locale}: resolves ${namespace}.${kind}`, () => {
          const path = `${namespace}.${kind.replace(/\./g, '_')}`
          expect(te(path)).toBe(true)
          expect(t(path)).not.toBe(path)
          expect(t(path)).not.toBe(kind)
        })
      }
    }
  }
})

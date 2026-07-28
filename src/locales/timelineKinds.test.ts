import { describe, it, expect } from 'vitest'
import { createI18n } from 'vue-i18n'
import zh from './zh'
import en from './en'

// The incident timeline renders each entry via kindLabel(k) → te/t('incidents.kind.'+k),
// where k is a dotted server code like "fault.confirmed" or "incident.terminated".
// vue-i18n treats those dots as nested path segments, so the kind sub-tree MUST be
// nested (kind.fault.confirmed), not flat ('fault.confirmed'). This guards that
// every server-emitted timeline kind resolves in both locales instead of silently
// falling back to the raw code.
const KINDS = [
  'fault.confirmed',
  'fault.resolved',
  'fault.terminated',
  'severity.upgraded',
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

const TARGET_STATUS_PATHS = [
  ...['disabled', 'unassigned', 'faulted', 'confirming', 'partial_failure', 'probe_failed', 'blocked', 'agent_offline', 'pending', 'stale', 'no_data', 'healthy'].map((v) => `display.${v}`),
  ...['disabled', 'unassigned', 'pending', 'collecting', 'permission_blocked', 'target_blocked', 'unsupported', 'agent_offline'].map((v) => `execution.${v}`),
  ...['no_data', 'healthy', 'failed', 'stale', 'not_applicable'].map((v) => `probe.${v}`),
  ...['normal', 'confirming', 'faulted'].map((v) => `fault.${v}`),
  ...['target_disabled', 'no_applicable_agents', 'agent_offline', 'permission_blocked', 'target_blocked', 'unsupported', 'awaiting_status_report', 'fault_confirmed', 'fault_confirming', 'probe_failed', 'probe_stale', 'probe_no_data', 'not_applicable', 'ok'].map((v) => `reason.${v}`),
]

describe('authoritative target-status labels', () => {
  for (const locale of ['zh', 'en'] as const) {
    const i18n = createI18n({ legacy: false, locale, fallbackLocale: 'zh', messages: { zh, en } })
    const t = i18n.global.t as (k: string) => string
    const te = i18n.global.te as (k: string) => boolean
    for (const suffix of TARGET_STATUS_PATHS) {
      it(`${locale}: resolves targetStatus.${suffix}`, () => {
        const path = `targetStatus.${suffix}`
        expect(te(path)).toBe(true)
        expect(t(path)).not.toBe(path)
      })
    }
  }
})

import { describe, expect, it } from 'vitest'
import { asnBadge, asnExplanationKey, asnModeKey, asnRelative, fmtCount } from './asnTable'

describe('asnBadge', () => {
  it('reports off regardless of other flags', () => {
    expect(asnBadge({ mode: 'off', checking: true, loaded: true })).toEqual({ tone: 'neutral', key: 'statusOff' })
  })
  it('reports checking before loaded state', () => {
    expect(asnBadge({ mode: 'managed', checking: true, loaded: true }).key).toBe('statusChecking')
    expect(asnBadge({ mode: 'file', checking: true, loaded: false }).key).toBe('statusChecking')
  })
  it('reports loaded and not loaded', () => {
    expect(asnBadge({ mode: 'managed', checking: false, loaded: true })).toEqual({ tone: 'ok', key: 'statusLoaded' })
    expect(asnBadge({ mode: 'file', checking: false, loaded: false })).toEqual({ tone: 'warn', key: 'statusNotLoaded' })
  })
})

describe('asnModeKey', () => {
  it('maps each mode', () => {
    expect(asnModeKey('file')).toBe('modeFile')
    expect(asnModeKey('managed')).toBe('modeManaged')
    expect(asnModeKey('off')).toBe('modeOff')
  })
})

describe('asnExplanationKey', () => {
  it('explains how to enable when off', () => {
    expect(asnExplanationKey({ mode: 'off', loaded: false })).toBe('explainOff')
  })
  it('explains per mode while not loaded', () => {
    expect(asnExplanationKey({ mode: 'managed', loaded: false })).toBe('explainManaged')
    expect(asnExplanationKey({ mode: 'file', loaded: false })).toBe('explainFile')
  })
  it('says nothing once loaded', () => {
    expect(asnExplanationKey({ mode: 'managed', loaded: true })).toBeNull()
    expect(asnExplanationKey({ mode: 'file', loaded: true })).toBeNull()
  })
})

describe('asnRelative', () => {
  const now = Date.parse('2026-10-11T12:00:00Z')
  it('handles past and future', () => {
    expect(asnRelative('2026-10-11T11:00:00Z', now)).toEqual({ seconds: 3600, future: false })
    expect(asnRelative('2026-10-11T17:00:00Z', now)).toEqual({ seconds: 18000, future: true })
  })
  it('returns null for missing or invalid values', () => {
    expect(asnRelative(null, now)).toBeNull()
    expect(asnRelative('', now)).toBeNull()
    expect(asnRelative('not a date', now)).toBeNull()
  })
})

describe('fmtCount', () => {
  it('adds thousands separators', () => {
    expect(fmtCount(1234567, 'en-US')).toBe('1,234,567')
    expect(fmtCount(0, 'en-US')).toBe('0')
  })
})

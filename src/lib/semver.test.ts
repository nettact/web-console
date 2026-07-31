import { describe, expect, it } from 'vitest'

import { updateAvailable } from './semver'

describe('updateAvailable', () => {
  it('compares numeric parts left to right, ignoring a leading v', () => {
    expect(updateAvailable('v1.3.0', 'v1.2.0')).toBe(true)
    expect(updateAvailable('1.3.0', '1.2.0')).toBe(true)
    expect(updateAvailable('v1.2.0', 'v1.3.0')).toBe(false)
    expect(updateAvailable('v2.0.0', 'v1.9.9')).toBe(true)
    expect(updateAvailable('v1.2.10', 'v1.2.9')).toBe(true)
  })

  it('mixes v-prefixed and bare forms', () => {
    expect(updateAvailable('v1.3.0', '1.2.0')).toBe(true)
    expect(updateAvailable('1.3.0', 'v1.2.0')).toBe(true)
  })

  it('treats equal versions as not newer', () => {
    expect(updateAvailable('v1.2.0', 'v1.2.0')).toBe(false)
    expect(updateAvailable('v1.2.0-rc1', 'v1.2.0-rc1')).toBe(false)
  })

  it('pads the shorter form with zeros', () => {
    expect(updateAvailable('v1.2', 'v1.2.0')).toBe(false)
    expect(updateAvailable('v1.2.0', 'v1.2')).toBe(false)
    expect(updateAvailable('v1.2.1', 'v1.2')).toBe(true)
    expect(updateAvailable('v1.2', 'v1.2.1')).toBe(false)
    expect(updateAvailable('v2', 'v1.9.9')).toBe(true)
  })

  it('ranks a release above a pre-release of the same numbers', () => {
    expect(updateAvailable('v1.3.0', 'v1.3.0-rc1')).toBe(true)
    expect(updateAvailable('v1.3.0-rc1', 'v1.3.0')).toBe(false)
  })

  it('compares two pre-releases lexically', () => {
    expect(updateAvailable('v1.3.0-rc2', 'v1.3.0-rc1')).toBe(true)
    expect(updateAvailable('v1.3.0-rc1', 'v1.3.0-rc2')).toBe(false)
    expect(updateAvailable('v1.3.0-beta', 'v1.3.0-alpha')).toBe(true)
  })

  it('still lets the numeric parts decide across a pre-release boundary', () => {
    expect(updateAvailable('v1.4.0-rc1', 'v1.3.0')).toBe(true)
    expect(updateAvailable('v1.3.0', 'v1.4.0-rc1')).toBe(false)
  })

  // Unlike the Go comparator, an unparsable side is never flagged: this drives a
  // per-row icon, and agents reporting '' or 'dev' would otherwise all light up.
  it('never flags an unparsable current version', () => {
    expect(updateAvailable('v1.3.0', '')).toBe(false)
    expect(updateAvailable('v1.3.0', 'dev')).toBe(false)
    expect(updateAvailable('v1.3.0', 'unknown')).toBe(false)
    expect(updateAvailable('v1.3.0', 'v')).toBe(false)
    expect(updateAvailable('v1.3.0', '1.2.x')).toBe(false)
  })

  it('never flags an unparsable latest version', () => {
    expect(updateAvailable('', 'v1.2.0')).toBe(false)
    expect(updateAvailable('dev', 'v1.2.0')).toBe(false)
    expect(updateAvailable('', '')).toBe(false)
    expect(updateAvailable('dev', 'dev')).toBe(false)
  })

  it('rejects non-decimal numeric parts', () => {
    expect(updateAvailable('v1.2e3', 'v1.2.0')).toBe(false)
    expect(updateAvailable('v0x2.0.0', 'v1.2.0')).toBe(false)
    expect(updateAvailable('v-1.2.0', 'v1.2.0')).toBe(false)
  })

  it('tolerates surrounding whitespace', () => {
    expect(updateAvailable('  v1.3.0  ', ' v1.2.0 ')).toBe(true)
  })
})

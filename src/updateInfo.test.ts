import { describe, expect, it } from 'vitest'

import type { UpdateInfo } from './api'
import { UNKNOWN_VERSION, dismissalKey, shouldShowBanner } from './updateInfo'

const update = (extra: Partial<UpdateInfo> = {}): UpdateInfo => ({
  install_type: 'server',
  current_version: 'v1.2.0',
  latest_version: 'v1.3.0',
  update_available: true,
  product_checked: true,
  download_url: 'https://d.nettact.org/',
  checked_at: '2026-07-31T12:00:00Z',
  ...extra,
})

describe('dismissalKey', () => {
  it('stores the version verbatim', () => {
    expect(dismissalKey('v1.3.0')).toBe('v1.3.0')
  })

  it('collapses an unnamed version to a sentinel no release can collide with', () => {
    expect(dismissalKey('')).toBe(UNKNOWN_VERSION)
    expect(dismissalKey('   ')).toBe(UNKNOWN_VERSION)
  })
})

describe('shouldShowBanner', () => {
  it('stays hidden until the stored preferences have loaded', () => {
    // The defaults say "notices on, nothing dismissed", so rendering before the
    // real preferences arrive would flash a banner the user already silenced.
    expect(shouldShowBanner(update(), false, false, '')).toBe(false)
  })

  it('shows a fresh available update', () => {
    expect(shouldShowBanner(update(), true, false, '')).toBe(true)
  })

  it('stays hidden when the server reported no update block', () => {
    expect(shouldShowBanner(null, true, false, '')).toBe(false)
  })

  it('stays hidden when the check found nothing newer', () => {
    expect(shouldShowBanner(update({ update_available: false }), true, false, '')).toBe(false)
  })

  it('stays hidden when notices are switched off', () => {
    expect(shouldShowBanner(update(), true, true, '')).toBe(false)
    // Off wins even over a version that was never dismissed.
    expect(shouldShowBanner(update(), true, true, 'v1.0.0')).toBe(false)
  })

  it('stays hidden for the dismissed version', () => {
    expect(shouldShowBanner(update(), true, false, 'v1.3.0')).toBe(false)
  })

  it('reappears for a version newer than the dismissed one', () => {
    expect(shouldShowBanner(update({ latest_version: 'v1.4.0' }), true, false, 'v1.3.0')).toBe(true)
  })

  it('is dismissible when the Store cannot name the version', () => {
    const store = update({ install_type: 'store', latest_version: '' })
    expect(shouldShowBanner(store, true, false, '')).toBe(true)
    expect(shouldShowBanner(store, true, false, UNKNOWN_VERSION)).toBe(false)
  })

  it('does not let an unnamed dismissal hide a later named version', () => {
    expect(shouldShowBanner(update({ latest_version: 'v1.3.0' }), true, false, UNKNOWN_VERSION)).toBe(true)
  })

  it('does not let a named dismissal hide a later unnamed update', () => {
    expect(shouldShowBanner(update({ latest_version: '' }), true, false, 'v1.3.0')).toBe(true)
  })
})

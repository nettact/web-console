import { beforeEach, describe, expect, it, vi } from 'vitest'

// syncUpdateNotice() reads server-info and /settings; stub both so the module's
// own logic is what is under test.
const apiMock = vi.hoisted(() => ({
  serverInfo: vi.fn(),
  settings: vi.fn(),
  updateSettings: vi.fn(),
}))
vi.mock('./api', () => ({ api: apiMock }))

import type { UpdateInfo } from './api'
import { serverInfo } from './serverInfo'
import {
  UNKNOWN_VERSION,
  dismissUpdateBanner,
  dismissalKey,
  setUpdateNoticeDisabled,
  shouldShowBanner,
  syncUpdateNotice,
  updateNotice,
} from './updateInfo'

const update = (extra: Partial<UpdateInfo> = {}): UpdateInfo => ({
  install_type: 'server',
  current_version: 'v1.2.0',
  latest_version: 'v1.3.0',
  update_available: true,
  product_checked: true,
  download_url: 'https://d.nettact.org/',
  auto_update: false,
  checked_at: '2026-07-31T12:00:00Z',
  ...extra,
})

describe('dismissalKey', () => {
  it('stores the version verbatim off the Store', () => {
    expect(dismissalKey(update({ latest_version: 'v1.3.0' }))).toBe('v1.3.0')
  })

  it('collapses an unnamed version to a sentinel no release can collide with', () => {
    expect(dismissalKey(update({ latest_version: '' }))).toBe(UNKNOWN_VERSION)
    expect(dismissalKey(update({ latest_version: '   ' }))).toBe(UNKNOWN_VERSION)
  })

  // A Store version is not authoritative — the desktop names it from a
  // device-agnostic catalog — so the key is the build being updated from, the
  // same rule update.StorePendingKey applies to the tray notification.
  it('keys a Store update by the build it updates from', () => {
    const store = update({ install_type: 'store', current_version: 'v1.2.0' })
    expect(dismissalKey(store)).toBe('store-pending-from-v1.2.0')
    // Whatever the catalog does or does not name it, the key does not move.
    expect(dismissalKey({ ...store, latest_version: '' })).toBe('store-pending-from-v1.2.0')
    expect(dismissalKey({ ...store, latest_version: 'v9.9.9' })).toBe('store-pending-from-v1.2.0')
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
    expect(shouldShowBanner(store, true, false, 'store-pending-from-v1.2.0')).toBe(false)
  })

  // The dismissed banner must come back once the Store update actually lands,
  // because what is pending then is a different update — even if the catalog
  // still names the same version it named before.
  it('reappears for a Store install once the pending update has been installed', () => {
    const store = update({ install_type: 'store', current_version: 'v1.3.0' })
    expect(shouldShowBanner(store, true, false, 'store-pending-from-v1.2.0')).toBe(true)
  })

  it('does not let an unnamed dismissal hide a later named version', () => {
    expect(shouldShowBanner(update({ latest_version: 'v1.3.0' }), true, false, UNKNOWN_VERSION)).toBe(true)
  })

  it('does not let a named dismissal hide a later unnamed update', () => {
    expect(shouldShowBanner(update({ latest_version: '' }), true, false, 'v1.3.0')).toBe(true)
  })
})

// The notice switch is one server setting the desktop tray writes too, so the
// console cannot read it once and keep that answer: the tray flips it while a tab
// sits open, and a stale checkbox would offer to turn on what is already on.
describe('syncUpdateNotice', () => {
  beforeEach(() => {
    apiMock.serverInfo.mockReset()
    apiMock.settings.mockReset()
    apiMock.updateSettings.mockReset()
    apiMock.serverInfo.mockResolvedValue({ os: 'windows', native_notify: true, update: update() })
    apiMock.updateSettings.mockResolvedValue(undefined)
    serverInfo.loaded = false
    serverInfo.update = update()
    updateNotice.loaded = false
    updateNotice.noticeDisabled = false
    updateNotice.dismissedVersion = ''
  })

  it('publishes the stored preferences', async () => {
    apiMock.settings.mockResolvedValue({
      update_notice_disabled: '1',
      update_dismissed_version: 'v1.3.0',
    })
    await syncUpdateNotice()
    expect(updateNotice).toMatchObject({
      loaded: true,
      noticeDisabled: true,
      dismissedVersion: 'v1.3.0',
    })
  })

  it('picks up a switch the tray flipped after the first read', async () => {
    apiMock.settings.mockResolvedValue({ update_notice_disabled: '1' })
    await syncUpdateNotice()
    expect(updateNotice.noticeDisabled).toBe(true)

    // The tray re-enabled notices; the next pass must see it rather than latch.
    apiMock.settings.mockResolvedValue({ update_notice_disabled: '0' })
    await syncUpdateNotice()
    expect(updateNotice.noticeDisabled).toBe(false)
  })

  it('re-reads the check result, so a tab opened before it lands still learns of an update', async () => {
    apiMock.settings.mockResolvedValue({})
    apiMock.serverInfo.mockResolvedValue({
      os: 'windows',
      native_notify: true,
      // Published from startup, but nothing checked yet.
      update: update({ latest_version: '', update_available: false, product_checked: false }),
    })
    await syncUpdateNotice()
    expect(serverInfo.update?.update_available).toBe(false)

    apiMock.serverInfo.mockResolvedValue({ os: 'windows', native_notify: true, update: update() })
    await syncUpdateNotice()
    expect(serverInfo.update?.latest_version).toBe('v1.3.0')
  })

  it('keeps the last known answer when a refresh fails', async () => {
    apiMock.settings.mockResolvedValue({
      update_notice_disabled: '1',
      update_dismissed_version: 'v1.3.0',
    })
    await syncUpdateNotice()

    // A dropped request must not read as "notices on, nothing dismissed" — that
    // would put a banner back up that the user has already answered.
    apiMock.settings.mockRejectedValue(new Error('offline'))
    await syncUpdateNotice()
    expect(updateNotice).toMatchObject({
      loaded: true,
      noticeDisabled: true,
      dismissedVersion: 'v1.3.0',
    })
  })

  it('shares one round trip between concurrent callers', async () => {
    apiMock.settings.mockResolvedValue({})
    await Promise.all([syncUpdateNotice(), syncUpdateNotice(), syncUpdateNotice()])
    expect(apiMock.settings).toHaveBeenCalledTimes(1)
  })

  // Returning to the tab starts a refresh, and the banner is the first thing the
  // user sees — so dismissing it (or flipping the switch) lands squarely inside
  // that request's flight. The reply was read before the write and must not be
  // applied over it, or the banner the user just closed comes straight back.
  it('does not let a read that started before a dismissal undo it', async () => {
    let release: (s: Record<string, string>) => void = () => {}
    apiMock.settings.mockReturnValue(
      new Promise<Record<string, string>>((resolve) => {
        release = resolve
      }),
    )
    const syncing = syncUpdateNotice()

    await dismissUpdateBanner()
    expect(updateNotice.dismissedVersion).toBe('v1.3.0')

    release({}) // the pre-dismissal state of /settings
    await syncing
    expect(updateNotice.dismissedVersion).toBe('v1.3.0')
  })

  it('does not let a read that started before a switch write undo it', async () => {
    let release: (s: Record<string, string>) => void = () => {}
    apiMock.settings.mockReturnValue(
      new Promise<Record<string, string>>((resolve) => {
        release = resolve
      }),
    )
    const syncing = syncUpdateNotice()

    await setUpdateNoticeDisabled(true)
    release({ update_notice_disabled: '0' })
    await syncing
    expect(updateNotice.noticeDisabled).toBe(true)
  })

  // The guard must not latch: once the write is done, the NEXT read is the truth
  // again — including one that reports what the desktop tray wrote.
  it('applies reads that start after the write', async () => {
    apiMock.settings.mockResolvedValue({ update_notice_disabled: '0' })
    await setUpdateNoticeDisabled(true)
    await syncUpdateNotice()
    expect(updateNotice.noticeDisabled).toBe(false)
  })
})

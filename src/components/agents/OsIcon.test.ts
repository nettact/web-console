import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import OsIcon from './OsIcon.vue'

// The mapping is a chain of substring tests, which is exactly the kind of thing
// that silently mis-resolves when a branch moves or a new distro id is added.
// Two of these cases are the reason the file has a test at all:
//
//   darwin  — "darwin" CONTAINS "win", so a Windows branch placed first claims
//             every Mac. It did, and every macOS agent in the list wore the
//             Windows logo.
//   openwrt — a router is not a PC. Its os-release id matched no branch and fell
//             through to the neutral "unknown" device glyph, so the one platform
//             whose form factor the icon could usefully convey was the one
//             platform that conveyed nothing.
function iconFor(platform: string): string {
  return mount(OsIcon, { props: { platform } }).attributes('data-icon') ?? ''
}

describe('OsIcon', () => {
  it.each([
    // What agentrt.reportedPlatform() actually sends: GOOS off Linux, the
    // lowercased /etc/os-release ID on it.
    ['windows', 'windows'],
    ['darwin', 'apple'],
    ['linux', 'linux'],
    ['ubuntu', 'ubuntu'],
    ['debian', 'debian'],
    ['openwrt', 'openwrt'],
    ['lede', 'openwrt'],
    ['freebsd', 'freebsd'],
    ['alpine', 'linux'],
    ['fedora', 'linux'],
    ['arch', 'linux'],
  ])('maps %s to the %s icon', (platform, want) => {
    expect(iconFor(platform)).toBe(want)
  })

  it('is case-insensitive', () => {
    expect(iconFor('OpenWrt')).toBe('openwrt')
    expect(iconFor('Ubuntu')).toBe('ubuntu')
  })

  it('falls back to the neutral device glyph for an unknown or empty platform', () => {
    expect(iconFor('')).toBe('unknown')
    expect(iconFor('plan9')).toBe('unknown')
  })

  it('keeps the raw platform in the title, so hovering shows the exact value', () => {
    expect(mount(OsIcon, { props: { platform: 'openwrt' } }).attributes('title')).toBe('openwrt')
    expect(mount(OsIcon, { props: { platform: '' } }).attributes('title')).toBe('unknown')
  })
})

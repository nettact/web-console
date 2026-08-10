import { describe, it, expect } from 'vitest'
import { STATUS_SLUG_RE, publicStatusUrl, suggestStatusSlug } from './statusPage'

describe('publicStatusUrl', () => {
  it('builds the hash-routed address the status app serves', () => {
    expect(publicStatusUrl('https://nettact.example.com', 'home-lab')).toBe(
      'https://nettact.example.com/status/#/home-lab',
    )
  })

  // consoleBase is stored without a trailing slash, but it is user-editable and
  // arrives from a setting — a stray slash must not produce '//status/'.
  it('tolerates a trailing slash or padding on the base', () => {
    expect(publicStatusUrl('https://x.test/', 'a')).toBe('https://x.test/status/#/a')
    expect(publicStatusUrl('  https://x.test  ', 'a')).toBe('https://x.test/status/#/a')
  })
})

describe('suggestStatusSlug', () => {
  it('produces a slug the server will accept', () => {
    expect(suggestStatusSlug(() => 0)).toBe('status-aaaaaa')
    expect(STATUS_SLUG_RE.test(suggestStatusSlug(() => 0))).toBe(true)
    // The top of the range must not index past the alphabet.
    expect(STATUS_SLUG_RE.test(suggestStatusSlug(() => 0.999999))).toBe(true)
  })
})

describe('STATUS_SLUG_RE', () => {
  it('accepts what the server accepts', () => {
    for (const ok of ['a', 'home', 'home-lab', 'a1-b2-c3', '0']) {
      expect(STATUS_SLUG_RE.test(ok), ok).toBe(true)
    }
  })

  it('rejects what the server rejects', () => {
    for (const bad of ['', 'Home', 'home lab', 'home/lab', '-home', 'home-', 'a'.repeat(65), 'ü']) {
      expect(STATUS_SLUG_RE.test(bad), bad).toBe(false)
    }
  })
})

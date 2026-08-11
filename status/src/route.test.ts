import { describe, it, expect } from 'vitest'
import { resolveSlug, slugFromHash } from './route'

describe('slugFromHash', () => {
  it('reads the canonical form the console links to', () => {
    expect(slugFromHash('#/home-lab')).toBe('home-lab')
  })

  it('accepts the shapes a browser or a hand-typed URL produces', () => {
    expect(slugFromHash('#home-lab')).toBe('home-lab')
    expect(slugFromHash('#/home-lab/')).toBe('home-lab')
    expect(slugFromHash('#/home%2Dlab')).toBe('home-lab')
  })

  it('treats an absent or empty hash as no selection', () => {
    expect(slugFromHash('')).toBe('')
    expect(slugFromHash('#')).toBe('')
    expect(slugFromHash('#/')).toBe('')
  })

  it('drops a query string appended to the hash', () => {
    expect(slugFromHash('#/home-lab?utm_source=x')).toBe('home-lab')
  })

  // A malformed escape throws inside decodeURIComponent; the page must show its
  // empty state rather than crash on load.
  it('survives a malformed escape', () => {
    expect(slugFromHash('#/%E0%A4%A')).toBe('')
  })
})

describe('resolveSlug', () => {
  it('prefers the addressed page over the configured default', () => {
    expect(resolveSlug('#/other', 'home-lab')).toBe('other')
  })

  // The case the whole option exists for: a deployment serving one board at a
  // domain root, where the URL is just '/'.
  it('falls back to the configured default when the hash names no page', () => {
    expect(resolveSlug('', 'home-lab')).toBe('home-lab')
    expect(resolveSlug('#', 'home-lab')).toBe('home-lab')
    expect(resolveSlug('#/', 'home-lab')).toBe('home-lab')
  })

  it('keeps the empty state when no default is configured', () => {
    expect(resolveSlug('', '')).toBe('')
  })
})

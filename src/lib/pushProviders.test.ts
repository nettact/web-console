import { describe, expect, it } from 'vitest'
import zh from '../locales/zh'
import { PUSH_PROVIDERS, isPushType, pushProvider } from './pushProviders'

// The descriptors carry i18n keys, not strings — a typo in one is invisible until
// a user opens the tab and reads a raw dot-path. Resolving every key against the
// zh tree here catches that at test time; parity.test.ts carries the guarantee
// over to en.

function resolve(tree: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((node, part) => {
    if (node === null || typeof node !== 'object') return undefined
    return (node as Record<string, unknown>)[part]
  }, tree)
}

function expectString(path: string) {
  const value = resolve(zh, path)
  expect(typeof value, `zh locale is missing a string at ${path}`).toBe('string')
  expect((value as string).length, `zh.${path} is empty`).toBeGreaterThan(0)
}

describe('pushProviders descriptors', () => {
  it('has unique type strings', () => {
    const types = PUSH_PROVIDERS.map((p) => p.type)
    expect(new Set(types).size).toBe(types.length)
  })

  it('resolves every i18n key in the zh tree', () => {
    for (const p of PUSH_PROVIDERS) {
      expectString(p.labelKey)
      expectString(p.helpKey)
      for (const f of p.fields) {
        expectString(f.labelKey)
        if (f.hintKey) expectString(f.hintKey)
      }
    }
  })

  it('never summarises a secret field in the channel table', () => {
    for (const p of PUSH_PROVIDERS) {
      const secrets = p.fields.filter((f) => f.secret).map((f) => f.key)
      for (const key of p.summaryKeys) {
        expect(secrets, `${p.type}.summaryKeys leaks the secret ${key}`).not.toContain(key)
      }
    }
  })

  it('only summarises keys the provider actually declares', () => {
    for (const p of PUSH_PROVIDERS) {
      const keys = p.fields.map((f) => f.key)
      for (const key of p.summaryKeys) expect(keys).toContain(key)
    }
  })

  it('looks types up and back', () => {
    expect(pushProvider('telegram')?.type).toBe('telegram')
    expect(pushProvider('webhook')).toBeUndefined()
    expect(isPushType('wxpusher')).toBe(true)
    expect(isPushType('email')).toBe(false)
  })
})

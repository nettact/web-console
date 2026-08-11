import { describe, it, expect } from 'vitest'
import zh from './zh'
import en from './en'

// The same guard the console has (src/locales/parity.test.ts), for this app's own
// much smaller pair of files. zh is the fallback locale, so a key missing from en
// renders Chinese inside the English page — a drift neither a build nor a type
// check would catch, because these are plain object literals that merely differ.

function paths(node: unknown, prefix = ''): string[] {
  if (node === null || typeof node !== 'object') return [prefix]
  const out: string[] = []
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    out.push(...paths(value, prefix ? `${prefix}.${key}` : key))
  }
  return out
}

function leaves(node: unknown, prefix = ''): Array<[string, string]> {
  if (typeof node === 'string') return [[prefix, node]]
  if (node === null || typeof node !== 'object') return []
  const out: Array<[string, string]> = []
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    out.push(...leaves(value, prefix ? `${prefix}.${key}` : key))
  }
  return out
}

describe('status page locale parity', () => {
  const zhPaths = new Set(paths(zh))
  const enPaths = new Set(paths(en))

  it('every zh key exists in en', () => {
    const missing = [...zhPaths].filter((p) => !enPaths.has(p)).sort()
    expect(missing, `missing from status en.ts: ${missing.join(', ')}`).toEqual([])
  })

  it('every en key exists in zh', () => {
    const missing = [...enPaths].filter((p) => !zhPaths.has(p)).sort()
    expect(missing, `missing from status zh.ts: ${missing.join(', ')}`).toEqual([])
  })
})

// A bare `@` is a vue-i18n message-syntax error that throws at RENDER time, so a
// whole section silently becomes an empty comment node. The literal escape is
// `{'@'}`. See the console's copy of this test for the incident that motivated it.
describe('status page locale message syntax', () => {
  for (const [name, tree] of [
    ['zh', zh],
    ['en', en],
  ] as const) {
    it(`${name}.ts escapes every literal @`, () => {
      const offenders = leaves(tree)
        .filter(([, text]) => text.replace(/\{'@'\}/g, '').includes('@'))
        .map(([path, text]) => `${path}: ${text}`)
      expect(offenders, `unescaped @ (use {'@'}): ${offenders.join(' | ')}`).toEqual([])
    })
  }
})

describe('status page visitor copy', () => {
  it.each([
    ['zh', zh, /公开|发布/i],
    ['en', en, /\bpublish(?:ed|es|ing)?\b/i],
  ] as const)('%s avoids publisher-facing language', (_name, tree, pattern) => {
    const offenders = leaves(tree)
      .filter(([, value]) => pattern.test(value))
      .map(([path, value]) => `${path}: ${value}`)
    expect(offenders, `publisher-facing copy: ${offenders.join(' | ')}`).toEqual([])
  })
})

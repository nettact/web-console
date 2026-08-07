import { describe, it, expect } from 'vitest'
import zh from './zh'
import en from './en'

// zh is the fallback locale, so a key present in zh but missing from en does not
// fail — it renders Chinese inside the English console, which looks like a
// translation nobody got round to rather than the bug it is. The reverse leaves an
// English string in the Chinese console. Neither shows up in a build or a type
// check, because both files are just object literals that happen to differ.
//
// This walks both trees and reports the exact paths that exist on one side only.

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

describe('locale key parity', () => {
  const zhPaths = new Set(paths(zh))
  const enPaths = new Set(paths(en))

  it('every zh key exists in en', () => {
    const missing = [...zhPaths].filter((p) => !enPaths.has(p)).sort()
    expect(missing, `missing from en.ts: ${missing.join(', ')}`).toEqual([])
  })

  it('every en key exists in zh', () => {
    const missing = [...enPaths].filter((p) => !zhPaths.has(p)).sort()
    expect(missing, `missing from zh.ts: ${missing.join(', ')}`).toEqual([])
  })
})

// `@` opens a linked-message reference in vue-i18n's message syntax (`@:other.key`).
// A bare `@` — "@BotFather", "(@)" — is a syntax error, and the production build
// throws it at RENDER time: the component rendering that message becomes an empty
// comment node, so a whole form silently disappears with only a console error.
// (This cost us the Telegram channel form once; the dev build was more forgiving,
// so the unit tests and `npm run build` both stayed green.)
//
// The literal escape is `{'@'}`. This scan is deliberately a plain regex rather
// than a compile attempt: it fails identically in every environment, whereas the
// compiler's leniency is what hid the bug in the first place.
describe('locale message syntax', () => {
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

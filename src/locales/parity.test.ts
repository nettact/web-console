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

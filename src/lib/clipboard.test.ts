import { afterEach, describe, expect, it, vi } from 'vitest'

import { copyToClipboard } from './clipboard'

// The interesting case is the plain-HTTP LAN console, where `navigator.clipboard`
// does not exist at all — jsdom matches that shape out of the box, and
// `document.execCommand` is likewise absent, so both have to be installed
// explicitly per test.
function withAsyncClipboard(impl: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn(impl) },
    configurable: true,
  })
  return (navigator.clipboard as Clipboard).writeText as ReturnType<typeof vi.fn>
}

function withExecCommand(result: boolean | (() => boolean)) {
  const exec = vi.fn(() => (typeof result === 'function' ? result() : result))
  ;(document as unknown as { execCommand: unknown }).execCommand = exec
  return exec
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'clipboard')
  Reflect.deleteProperty(document, 'execCommand')
  vi.restoreAllMocks()
})

describe('copyToClipboard', () => {
  it('uses the async Clipboard API when it exists', async () => {
    const writeText = withAsyncClipboard(async () => {})
    const exec = withExecCommand(true)

    expect(await copyToClipboard('hello')).toBe(true)
    expect(writeText).toHaveBeenCalledWith('hello')
    expect(exec).not.toHaveBeenCalled()
  })

  it('falls back to execCommand when the async API is missing (insecure context)', async () => {
    let copied = ''
    const exec = withExecCommand(() => {
      copied = (document.activeElement as HTMLTextAreaElement).value
      return true
    })

    expect(await copyToClipboard('curl -fsSL https://example/install.sh')).toBe(true)
    expect(exec).toHaveBeenCalledWith('copy')
    expect(copied).toBe('curl -fsSL https://example/install.sh')
  })

  it('falls back when the async API rejects', async () => {
    withAsyncClipboard(async () => {
      throw new Error('NotAllowedError')
    })
    const exec = withExecCommand(true)

    expect(await copyToClipboard('x')).toBe(true)
    expect(exec).toHaveBeenCalled()
  })

  it('reports failure rather than claiming a copy that never happened', async () => {
    expect(await copyToClipboard('x')).toBe(false)

    withExecCommand(false)
    expect(await copyToClipboard('x')).toBe(false)
  })

  it('leaves no scratch node behind and restores focus', async () => {
    const before = document.createElement('input')
    document.body.appendChild(before)
    before.focus()
    withExecCommand(true)

    expect(await copyToClipboard('x')).toBe(true)
    expect(document.querySelectorAll('textarea')).toHaveLength(0)
    expect(document.activeElement).toBe(before)
    before.remove()
  })
})

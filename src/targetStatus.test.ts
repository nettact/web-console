import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => ({ targetStatuses: vi.fn() }))
const streamMock = vi.hoisted(() => ({ close: vi.fn() }))

vi.mock('./api', () => ({ api: apiMock }))
vi.mock('./lib/sse', () => ({ openEventStream: vi.fn(() => streamMock) }))

import { refreshTargetStatus, resetTargetStatus, stopTargetStatus, targetStatus } from './targetStatus'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const response = (name: string) => ({
  generated_at: `2026-07-17T12:00:0${name === 'first' ? 1 : 2}Z`,
  site_id: 'site_default',
  targets: [{ target_id: name }],
})

beforeEach(() => {
  vi.clearAllMocks()
  resetTargetStatus()
})

describe('authoritative target-status refresh', () => {
  it('runs one trailing refresh when demand arrives in flight', async () => {
    const first = deferred<ReturnType<typeof response>>()
    const second = deferred<ReturnType<typeof response>>()
    apiMock.targetStatuses.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)

    const running = refreshTargetStatus()
    expect(apiMock.targetStatuses).toHaveBeenCalledTimes(1)
    await refreshTargetStatus()
    first.resolve(response('first'))
    await vi.waitFor(() => expect(apiMock.targetStatuses).toHaveBeenCalledTimes(2))
    second.resolve(response('second'))
    await running

    expect(targetStatus.targets[0]?.target_id).toBe('second')
    expect(targetStatus.stale).toBe(false)
  })

  it('drops a response from a stopped lifecycle and lets the next lifecycle fetch', async () => {
    const old = deferred<ReturnType<typeof response>>()
    apiMock.targetStatuses.mockReturnValueOnce(old.promise).mockResolvedValueOnce(response('second'))
    const oldRun = refreshTargetStatus()

    stopTargetStatus()
    old.resolve(response('first'))
    await oldRun
    expect(targetStatus.loaded).toBe(false)
    expect(targetStatus.targets).toEqual([])

    await refreshTargetStatus()
    expect(apiMock.targetStatuses).toHaveBeenCalledTimes(2)
    expect(targetStatus.targets[0]?.target_id).toBe('second')
  })

  it('keeps the snapshot when the stream is only suspended, and drops it on reset', async () => {
    apiMock.targetStatuses.mockResolvedValueOnce(response('first'))
    await refreshTargetStatus()

    // Hiding the browser tab suspends the stream. The snapshot must survive, or
    // the kept-alive target-status view collapses to its loading card and the
    // browser throws away the user's scroll position.
    stopTargetStatus()
    expect(targetStatus.live).toBe(false)
    expect(targetStatus.loaded).toBe(true)
    expect(targetStatus.targets[0]?.target_id).toBe('first')
    // ...but the frozen snapshot must not keep claiming to be live: `syncing`
    // holds until a refresh actually lands, so a hung resume cannot show a stale
    // reading under a live badge.
    expect(targetStatus.syncing).toBe(true)

    apiMock.targetStatuses.mockResolvedValueOnce(response('second'))
    await refreshTargetStatus()
    expect(targetStatus.syncing).toBe(false)

    resetTargetStatus()
    expect(targetStatus.loaded).toBe(false)
    expect(targetStatus.targets).toEqual([])
  })

  it('keeps the last successful snapshot and marks it stale on failure', async () => {
    apiMock.targetStatuses.mockResolvedValueOnce(response('first')).mockRejectedValueOnce(new Error('offline'))
    await refreshTargetStatus()
    await refreshTargetStatus()

    expect(targetStatus.targets[0]?.target_id).toBe('first')
    expect(targetStatus.stale).toBe(true)
    // The attempt settled, so `stale` — not `syncing` — carries the outcome.
    expect(targetStatus.syncing).toBe(false)
    expect(targetStatus.error).toBe('')
  })
})

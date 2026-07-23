import { afterEach, describe, expect, it, vi } from 'vitest'
import { openEventStream } from './sse'

class FakeEventSource {
  static instances: FakeEventSource[] = []

  readonly listeners = new Map<string, EventListenerOrEventListenerObject[]>()
  close = vi.fn()

  constructor(
    readonly url: string,
    readonly init?: EventSourceInit,
  ) {
    FakeEventSource.instances.push(this)
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    const listeners = this.listeners.get(type) ?? []
    listeners.push(listener)
    this.listeners.set(type, listeners)
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    const listeners = this.listeners.get(type) ?? []
    this.listeners.set(type, listeners.filter((candidate) => candidate !== listener))
  }
}

describe('openEventStream', () => {
  const originalEventSource = globalThis.EventSource

  afterEach(() => {
    globalThis.EventSource = originalEventSource
    FakeEventSource.instances = []
  })

  it('shares one EventSource until the final consumer closes', () => {
    globalThis.EventSource = FakeEventSource as unknown as typeof EventSource

    const issues = openEventStream({ onIssues: vi.fn() })
    const targetStatus = openEventStream({ onTargetStatus: vi.fn() })

    expect(FakeEventSource.instances).toHaveLength(1)
    const source = FakeEventSource.instances[0]
    expect(source.url).toBe('/api/v1/events')
    expect(source.init).toEqual({ withCredentials: true })

    issues.close()
    issues.close()
    expect(source.listeners.get('issues')).toEqual([])
    expect(source.listeners.get('target.status.changed')).toHaveLength(1)
    expect(source.close).not.toHaveBeenCalled()

    targetStatus.close()
    expect(source.close).toHaveBeenCalledOnce()

    const reopened = openEventStream({})
    expect(FakeEventSource.instances).toHaveLength(2)
    reopened.close()
    expect(FakeEventSource.instances[1].close).toHaveBeenCalledOnce()
  })
})

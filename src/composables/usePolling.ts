// A small, self-cleaning poller for a single async task. It is deliberately
// self-paced: the task returns whether work is still "active" (e.g. a snapshot
// still collecting, or a referenced trace report still queued/running), and the
// poller only keeps ticking while that is true — then goes idle until start() is
// called again on a state change. Guarantees:
//
//   - no overlapping requests (an in-flight tick suppresses the next),
//   - a sensible 3–5s cadence while active, with exponential backoff on error
//     so a transient failure never kills the loop,
//   - cleanup on scope dispose (component unmount), so switching the selected
//     incident tears the old poller down and its late responses land on the
//     discarded component instance rather than the new one.
import { onScopeDispose } from 'vue'

export interface PollingOptions {
  // Base cadence while active. Default 4000ms (within the 3–5s window).
  intervalMs?: number
  // Upper bound for error backoff. Default 15000ms.
  maxBackoffMs?: number
}

// task resolves to true when polling should continue (work still active) and
// false when it should go idle. Throwing triggers backoff without stopping.
export function usePolling(task: () => Promise<boolean>, opts: PollingOptions = {}) {
  const base = Math.max(1000, opts.intervalMs ?? 4000)
  const maxBackoff = Math.max(base, opts.maxBackoffMs ?? 15000)

  let timer: number | undefined
  let inFlight = false
  let stopped = false
  let backoff = base

  function clear() {
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }
  }
  function schedule(ms: number) {
    clear()
    if (stopped) return
    timer = window.setTimeout(run, ms)
  }
  async function run() {
    if (stopped || inFlight) return
    inFlight = true
    try {
      const active = await task()
      inFlight = false
      backoff = base
      if (stopped) return
      if (active) schedule(base) // still work in flight → keep polling
      // otherwise go idle; the caller restarts the loop on a state change
    } catch {
      inFlight = false
      backoff = Math.min(backoff * 1.8, maxBackoff)
      schedule(backoff) // keep retrying so a blip doesn't strand the loop
    }
  }

  // Run one tick immediately, then let run() decide whether to keep ticking.
  // Safe to call repeatedly (e.g. when a new selection needs a fresh loop).
  function start() {
    stopped = false
    schedule(0)
  }
  function stop() {
    stopped = true
    clear()
  }

  onScopeDispose(stop)
  return { start, stop }
}

// Thin wrapper over the browser EventSource for the /events stream. The server
// multiplexes several event types on the one connection:
//   • `issues`               — FULL issue state on connect and on every change;
//                              consumers replace their state wholesale on each push.
//   • `target.status.changed`— a site-scoped signal carrying only the affected
//                              target ids; the client coalesces bursts into one
//                              authoritative batch refresh (it never applies ids
//                              directly), so missed/duplicate events cannot drift.
//   • `incident.changed`     — one incident opened, changed or resolved; the id
//                              is a hint for an open detail drawer, and the list
//                              refetches wholesale.
// `onOpen` fires on every (re)connect — EventSource reconnects natively — so each
// consumer can perform a full refresh and converge after a dropped connection.

import type { Issue } from '../api'

export interface IssueStreamState {
  issues: Issue[]
  unread_count: number
}

// Payload of a `target.status.changed` frame. `target_ids` empty ⇒ the whole
// site changed; either way the client responds with a full batch refresh.
export interface TargetStatusChanged {
  site_id: string
  target_ids: string[]
}

// Payload of an `agent.status.changed` frame: signal-only (the affected site).
// The client always refetches the whole site's agent-status list.
export interface AgentStatusChanged {
  site_id: string
}

// Payload of an `incident.changed` frame: the affected site plus the incident id,
// so a console with that incident open can refresh exactly it.
export interface IncidentChanged {
  site_id: string
  incident_id: string
}

export interface EventStreamHandlers {
  onIssues?: (state: IssueStreamState) => void
  onTargetStatus?: (ev: TargetStatusChanged) => void
  onAgentStatus?: (ev: AgentStatusChanged) => void
  onIncident?: (ev: IncidentChanged) => void
  onOpen?: () => void
}

export interface EventStream {
  close: () => void
}

let sharedSource: EventSource | undefined
let sharedSourceUsers = 0

function acquireEventSource(): EventSource {
  if (!sharedSource) {
    sharedSource = new EventSource('/api/v1/events', { withCredentials: true })
  }
  sharedSourceUsers++
  return sharedSource
}

function releaseEventSource(es: EventSource) {
  if (es !== sharedSource || sharedSourceUsers === 0) return
  sharedSourceUsers--
  if (sharedSourceUsers === 0) {
    sharedSource.close()
    sharedSource = undefined
  }
}

export function openEventStream({ onIssues, onTargetStatus, onAgentStatus, onIncident, onOpen }: EventStreamHandlers): EventStream {
  const es = acquireEventSource()

  const listeners: Array<[string, EventListener]> = []
  const listen = (type: string, listener: EventListener) => {
    es.addEventListener(type, listener)
    listeners.push([type, listener])
  }

  listen('open', () => onOpen?.())

  if (onIssues) {
    listen('issues', (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data) as IssueStreamState
        onIssues({ issues: data.issues ?? [], unread_count: data.unread_count ?? 0 })
      } catch {
        /* ignore a malformed frame — the next full-state push corrects it */
      }
    })
  }

  if (onTargetStatus) {
    listen('target.status.changed', (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data) as TargetStatusChanged
        onTargetStatus({ site_id: data.site_id ?? '', target_ids: data.target_ids ?? [] })
      } catch {
        /* ignore — a full refresh on the next event/focus/reconnect converges */
      }
    })
  }

  if (onAgentStatus) {
    listen('agent.status.changed', (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data) as AgentStatusChanged
        onAgentStatus({ site_id: data.site_id ?? '' })
      } catch {
        /* ignore — a full refresh on the next event/focus/reconnect converges */
      }
    })
  }

  if (onIncident) {
    listen('incident.changed', (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data) as IncidentChanged
        onIncident({ site_id: data.site_id ?? '', incident_id: data.incident_id ?? '' })
      } catch {
        /* ignore — a full refresh on the next event/reconnect converges */
      }
    })
  }

  let closed = false
  return {
    close: () => {
      if (closed) return
      closed = true
      for (const [type, listener] of listeners) es.removeEventListener(type, listener)
      releaseEventSource(es)
    },
  }
}

// onSSE subscribes to one event family and returns an unsubscribe function — the
// shape a component's onMounted/onBeforeUnmount pair wants. It reconnects and
// refreshes through the same shared EventSource as every other consumer.
export function onSSE(kind: 'incident', handler: () => void): () => void {
  const stream = openEventStream({
    onIncident: kind === 'incident' ? () => handler() : undefined,
    // A reconnect may have missed events, so converge with a full refresh.
    onOpen: () => handler(),
  })
  return () => stream.close()
}

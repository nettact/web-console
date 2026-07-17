// Thin wrapper over the browser EventSource for the /events stream. The server
// multiplexes two event types on the one connection:
//   • `issues`               — FULL issue state on connect and on every change;
//                              consumers replace their state wholesale on each push.
//   • `target.status.changed`— a site-scoped signal carrying only the affected
//                              target ids; the client coalesces bursts into one
//                              authoritative batch refresh (it never applies ids
//                              directly), so missed/duplicate events cannot drift.
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

export interface EventStreamHandlers {
  onIssues?: (state: IssueStreamState) => void
  onTargetStatus?: (ev: TargetStatusChanged) => void
  onOpen?: () => void
}

export interface EventStream {
  close: () => void
}

export function openEventStream({ onIssues, onTargetStatus, onOpen }: EventStreamHandlers): EventStream {
  const es = new EventSource('/api/v1/events', { withCredentials: true })

  es.addEventListener('open', () => onOpen?.())

  if (onIssues) {
    es.addEventListener('issues', (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data) as IssueStreamState
        onIssues({ issues: data.issues ?? [], unread_count: data.unread_count ?? 0 })
      } catch {
        /* ignore a malformed frame — the next full-state push corrects it */
      }
    })
  }

  if (onTargetStatus) {
    es.addEventListener('target.status.changed', (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data) as TargetStatusChanged
        onTargetStatus({ site_id: data.site_id ?? '', target_ids: data.target_ids ?? [] })
      } catch {
        /* ignore — a full refresh on the next event/focus/reconnect converges */
      }
    })
  }

  return { close: () => es.close() }
}

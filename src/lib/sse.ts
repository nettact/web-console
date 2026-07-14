// Thin wrapper over the browser EventSource for the /events issue stream. The
// server pushes FULL issue state on connect and on every change, so consumers
// replace their state wholesale on each `onIssues`. `onOpen` fires on every
// (re)connect — EventSource reconnects natively — so the caller can refetch and
// converge after a dropped connection.

import type { Issue } from '../api'

export interface IssueStreamState {
  issues: Issue[]
  unread_count: number
}

export interface EventStreamHandlers {
  onIssues: (state: IssueStreamState) => void
  onOpen?: () => void
}

export interface EventStream {
  close: () => void
}

export function openEventStream({ onIssues, onOpen }: EventStreamHandlers): EventStream {
  const es = new EventSource('/api/v1/events', { withCredentials: true })

  es.addEventListener('open', () => onOpen?.())

  es.addEventListener('issues', (ev) => {
    try {
      const data = JSON.parse((ev as MessageEvent).data) as IssueStreamState
      onIssues({ issues: data.issues ?? [], unread_count: data.unread_count ?? 0 })
    } catch {
      /* ignore a malformed frame — the next full-state push corrects it */
    }
  })

  return { close: () => es.close() }
}

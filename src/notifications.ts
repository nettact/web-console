import { reactive } from 'vue'
import type { RouteLocationRaw } from 'vue-router'
import { api, type Issue } from './api'
import { openEventStream, type EventStream } from './lib/sse'
import { pushToast } from './toasts'
import { i18n } from './i18n'

// Module-level reactive notification state (mirrors auth.ts's singleton pattern).
// The badge count is server-authoritative (`unread`); `issues` is the full issue
// list pushed over SSE (replaced wholesale on every event); `live` reflects the
// stream connection. Consumers import this reactive object directly.
export const notifications = reactive<{ unread: number; issues: Issue[]; live: boolean }>({
  unread: 0,
  issues: [],
  live: false,
})

let stream: EventStream | null = null
let started = false

// Last-seen state per issue id, used purely for toast de-duplication (spec §3.7):
// a toast fires only on a transition INTO `active` from unknown/resolved. The very
// first apply primes this baseline WITHOUT toasting, so opening the console never
// replays the whole active backlog as toasts.
const lastState = new Map<string, 'active' | 'resolved'>()
let primed = false

// Deep-link a notification to the most relevant page: a monitor issue points at
// the monitor-group status page, focused on the stable target and Agent IDs;
// anything else lands on the Agent list.
export function issueLink(iss: Issue): RouteLocationRaw {
  if (iss.monitor_name && iss.ref_id) {
    return {
      path: '/target-status',
      query: { target: iss.ref_id, agent: iss.agent_id },
    }
  }
  return { path: '/agents', query: { agent: iss.agent_id } }
}

// Localized one-line reason for an issue (used by toasts and the bell).
export function issueReasonText(iss: Issue): string {
  const t = i18n.global.t
  const te = i18n.global.te
  const key = `issues.reason.${iss.reason}`
  const base = te(key) ? t(key) : iss.reason
  if (iss.missing_permissions.length) {
    return t('issues.missingSuffix', { base, perms: iss.missing_permissions.length })
  }
  return base
}

function toastForIssue(iss: Issue): void {
  const t = i18n.global.t
  pushToast({
    tone: 'warn',
    title: t('issues.toastTitle', { agent: iss.agent_name || iss.agent_id }),
    body: iss.monitor_name ? `${iss.monitor_name} · ${issueReasonText(iss)}` : issueReasonText(iss),
    to: issueLink(iss),
  })
}

function applyState(issues: Issue[], unread: number): void {
  if (primed) {
    for (const iss of issues) {
      if (iss.state === 'active' && lastState.get(iss.id) !== 'active') toastForIssue(iss)
    }
  }
  lastState.clear()
  for (const iss of issues) lastState.set(iss.id, iss.state)
  primed = true
  notifications.issues = issues
  notifications.unread = unread
}

async function refetch(): Promise<void> {
  try {
    const r = await api.listIssues()
    applyState(r.items, r.unread_count)
  } catch {
    /* transient — the SSE stream will re-push full state */
  }
}

// Open the issue stream and seed the initial state. Idempotent; call once from
// App.vue after auth is established.
export function initNotifications(): void {
  if (started) return
  started = true
  refetch()
  stream = openEventStream({
    onIssues: (s) => applyState(s.issues, s.unread_count),
    // Every (re)connect: refetch GET /issues to converge after any missed frames.
    onOpen: () => refetch(),
  })
  notifications.live = true
}

// Suspend the stream WITHOUT clearing the issue list — a hidden tab keeps the
// bell badge and its list rendered from the last known state (see
// stopTargetStatus()); the next initNotifications() refetches. The toast baseline
// is dropped so returning to the tab re-primes silently instead of replaying
// every issue that went active while we were not listening.
export function stopNotifications(): void {
  stream?.close()
  stream = null
  started = false
  primed = false
  lastState.clear()
  notifications.live = false
}

// Full teardown for session end (logout, app unmount).
export function resetNotifications(): void {
  stopNotifications()
  notifications.issues = []
  notifications.unread = 0
}

// Mark issues read: specific ids, or 'all' active issues. The server pushes fresh
// state over SSE; we also refetch to converge immediately.
export async function markRead(ids: string[] | 'all'): Promise<void> {
  try {
    await api.markIssuesRead(ids === 'all' ? undefined : ids)
    await refetch()
  } catch {
    /* ignore — badge will re-sync on the next push */
  }
}

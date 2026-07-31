import { reactive } from 'vue'
import { api, type User } from './api'
import { setConsoleBase } from './consoleBaseUrl'

// Global auth state. `ready` gates the router guard until the first /auth/me.
export const auth = reactive<{ user: User | null; ready: boolean }>({
  user: null,
  ready: false,
})

export async function refresh(): Promise<void> {
  try {
    const u = await api.me()
    auth.user = u && u.id ? u : null
  } catch {
    auth.user = null
  } finally {
    auth.ready = true
  }
  if (auth.user) await ensureConsoleBaseURL()
}

export async function login(username: string, password: string): Promise<void> {
  auth.user = await api.login(username, password)
  auth.ready = true
  await ensureConsoleBaseURL()
}

// ensureConsoleBaseURL defaults the console base URL — used to build deep links
// in alert notifications — to the address the admin is actually using, the first
// time they enter the console with it unset. This spares the user from having to
// configure it manually (and from the placeholder-looks-like-a-value trap on the
// Settings page). Best-effort: never blocks entry, and never overwrites a value
// the admin has already set. The resolved value is published to the shared
// console-address state, so enrollment commands can point Agents at it without
// a second settings read.
async function ensureConsoleBaseURL(): Promise<void> {
  try {
    const s = await api.settings()
    if (!s['console_base_url']) {
      await api.updateSettings({ console_base_url: window.location.origin })
      setConsoleBase(window.location.origin)
    } else {
      setConsoleBase(s['console_base_url'])
    }
  } catch {
    // ignore — the Settings page still lets the admin set/override it manually
  }
}

export async function logout(): Promise<void> {
  try {
    await api.logout()
  } finally {
    auth.user = null
  }
}

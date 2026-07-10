import { reactive } from 'vue'
import { api, type User } from './api'

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
}

export async function login(username: string, password: string): Promise<void> {
  auth.user = await api.login(username, password)
  auth.ready = true
}

export async function logout(): Promise<void> {
  try {
    await api.logout()
  } finally {
    auth.user = null
  }
}

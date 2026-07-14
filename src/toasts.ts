import { reactive } from 'vue'

// Minimal module-level toast bus. Components call pushToast(); Toasts.vue renders
// the queue. Kept deliberately tiny — the notification center (NotificationBell)
// owns the durable list; toasts are only transient nudges.

export type ToastTone = 'info' | 'warn' | 'danger'

export interface Toast {
  id: number
  tone: ToastTone
  title: string
  body?: string
  // Optional deep-link target (vue-router location) for a "view" affordance.
  to?: import('vue-router').RouteLocationRaw
}

const state = reactive<{ toasts: Toast[] }>({ toasts: [] })
let seq = 0

export function useToasts() {
  return state
}

export function pushToast(t: Omit<Toast, 'id'>, ttlMs = 6000): number {
  const id = ++seq
  state.toasts.push({ ...t, id })
  if (ttlMs > 0) window.setTimeout(() => dismissToast(id), ttlMs)
  return id
}

export function dismissToast(id: number): void {
  const i = state.toasts.findIndex((x) => x.id === id)
  if (i >= 0) state.toasts.splice(i, 1)
}

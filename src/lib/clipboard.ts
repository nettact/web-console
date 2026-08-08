// Copying text out of the console has to work on plain HTTP, which rules out
// relying on `navigator.clipboard` alone.
//
// A self-hosted console is normally reached at http://<lan-ip>:12450, and that
// is not a *secure context*, so the async Clipboard API is not merely denied —
// the whole `navigator.clipboard` object is **absent**. The tempting one-liner
// `navigator.clipboard?.writeText(text)` therefore evaluates to `undefined` and
// does nothing at all, while the button next to it happily flips to "Copied".
// Silently lying about a copy is worse than not offering one: the operator
// pastes whatever was in the clipboard before into a root shell.
//
// So this returns whether the copy actually happened, and falls back to the
// deprecated `document.execCommand('copy')` — which is not legacy cruft here but
// the only mechanism that still works outside a secure context.
//
// Ordering matters for the user-gesture requirement: when the async API is
// missing we go straight to the synchronous fallback, still inside the click's
// task, rather than awaiting anything first. The fallback after a *rejected*
// `writeText` is best-effort — some browsers consider the gesture spent by then,
// which is exactly why the caller is handed a boolean instead of a promise of
// success.
export async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Permission denied, document not focused, or a transport error. Fall
      // through: the legacy path is often still allowed.
    }
  }
  return legacyCopy(text)
}

function legacyCopy(text: string): boolean {
  if (typeof document === 'undefined' || typeof document.execCommand !== 'function') return false
  const ta = document.createElement('textarea')
  ta.value = text
  // Off-screen rather than hidden: `display:none` / `visibility:hidden` elements
  // cannot hold a selection, so the copy would be a no-op. `readonly` keeps the
  // on-screen keyboard from opening on mobile.
  ta.setAttribute('readonly', '')
  ta.style.position = 'fixed'
  ta.style.top = '0'
  ta.style.left = '-9999px'
  ta.style.opacity = '0'
  const restore = document.activeElement as HTMLElement | null
  document.body.appendChild(ta)
  try {
    ta.focus()
    ta.select()
    ta.setSelectionRange(0, text.length)
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    ta.remove()
    restore?.focus?.()
  }
}

// Shrink a one-line figure until it fits the card it is in.
//
// # Why this exists rather than letting the text wrap
//
// A stat card's value is one line by construction, and its box is a fixed
// height. Wrapping would make the card's height depend on how long the value
// happens to be — and these values change as a reader drags a selection across
// the charts, so the grid reflowed on every pointer move and the charts below it
// walked out from under the pointer drawing on them. "7 分 8 秒" wraps at the
// grid's narrowest column and "34 秒" does not, which is the whole of the bug.
//
// Clipping instead of wrapping would hold the height but lose digits, and a
// figure missing its last digit is worse than a small one. So the text stays on
// one line and the size comes down to meet it.
//
// # Why the height is fixed in CSS rather than left to this
//
// This can fail to fit — a very long value floors at MIN_SCALE and is clipped —
// and it can be skipped entirely where ResizeObserver is missing. The card must
// keep its height in both cases, so the height is a CSS invariant and this only
// decides how much of it the glyphs use. It also means writing a font size never
// changes the element's box, which is what keeps the observer below from
// retriggering on its own output.

import type { Directive } from 'vue'

// The floor, as a fraction of the stylesheet's size. Below about half, a figure
// is small enough that a reader scanning a grid of them will misread it, and an
// ellipsis is the more honest failure.
const MIN_SCALE = 0.5

const observers = new WeakMap<HTMLElement, ResizeObserver>()

// fitText sizes one element's text to its width. Idempotent, and cheap to call
// again with nothing changed.
export function fitText(el: HTMLElement): void {
  // Text and width together are what the answer depends on. A drag changes most
  // values every move but not all of them, and the ones that did not change are
  // worth not measuring again.
  const stamp = `${el.textContent ?? ''}@${el.clientWidth}`
  if (el.dataset.fit === stamp) return

  // Back to the stylesheet's size before measuring: the question is whether the
  // text fits at full size, and measuring it at the size chosen last time would
  // answer about the wrong one — a value that got shorter would never grow back.
  el.style.fontSize = ''
  const avail = el.clientWidth
  if (!avail) return
  const need = el.scrollWidth
  el.dataset.fit = stamp
  if (need <= avail) return

  const base = Number.parseFloat(getComputedStyle(el).fontSize)
  if (!Number.isFinite(base) || base <= 0) return
  el.style.fontSize = `${Math.max(base * MIN_SCALE, (base * avail) / need)}px`
}

// vFitText keeps an element's text fitted: on mount, whenever the component
// re-renders it, and whenever its column changes width.
export const vFitText: Directive<HTMLElement> = {
  mounted(el) {
    fitText(el)
    if (typeof ResizeObserver === 'undefined') return
    // Observes the element itself, which is safe only because its height is
    // fixed in CSS: a font-size write leaves the box exactly as it was, so this
    // fires for real column resizes and never for our own output.
    const ro = new ResizeObserver(() => fitText(el))
    ro.observe(el)
    observers.set(el, ro)
  },
  updated(el) {
    fitText(el)
  },
  unmounted(el) {
    observers.get(el)?.disconnect()
    observers.delete(el)
  },
}

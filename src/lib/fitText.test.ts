import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { fitText } from './fitText'

// jsdom does not lay text out, so each element's widths are stubbed. The base
// size comes from a real stylesheet rule rather than an inline style, because
// that is where it comes from in the app — and because fitText CLEARS the inline
// size before measuring, so a base kept there would be the thing it wipes.

const BASE = 30

let sheet: HTMLStyleElement

beforeEach(() => {
  sheet = document.createElement('style')
  sheet.textContent = `.fit-base { font-size: ${BASE}px; }`
  document.head.append(sheet)
})

afterEach(() => {
  sheet.remove()
  document.body.replaceChildren()
})

// el makes an element whose text is `naturalWidth` wide AT THE BASE SIZE, inside
// a box `available` wide. scrollWidth follows the rendered size the way a real
// one does — text at half the size takes half the room — which is what makes
// measuring at the wrong size give the wrong answer.
function el(available: number, naturalWidth: number, text: string): HTMLElement {
  const node = document.createElement('div')
  node.className = 'fit-base'
  node.textContent = text
  document.body.append(node)
  Object.defineProperty(node, 'clientWidth', { get: () => available })
  Object.defineProperty(node, 'scrollWidth', {
    configurable: true,
    get: () => (naturalWidth * rendered(node)) / BASE,
  })
  return node
}

const rendered = (node: HTMLElement) => Number.parseFloat(getComputedStyle(node).fontSize)

describe('fitText', () => {
  it('leaves a value that already fits alone', () => {
    const node = el(200, 150, '34 秒')
    fitText(node)
    expect(node.style.fontSize).toBe('')
    expect(rendered(node)).toBe(BASE)
  })

  it('shrinks a value that overflows to the width available', () => {
    const node = el(200, 300, '7 分 8 秒')
    fitText(node)
    // 200/300 of the base, which is the size at which it exactly fits.
    expect(rendered(node)).toBeCloseTo(BASE * (200 / 300))
  })

  // The floor. Below about half, a figure in a grid of them is small enough to
  // be misread, and clipping is the more honest failure than a value nobody can
  // read.
  it('will not shrink past its floor', () => {
    const node = el(30, 3000, 'a very long value indeed')
    fitText(node)
    expect(rendered(node)).toBeCloseTo(BASE * 0.5)
  })

  // The defect this order of operations exists to prevent. A value that got
  // SHORTER has to grow back: measuring at the size chosen last time would find
  // it fitting and leave it small, so every card that ever held a long value
  // would stay shrunk for the rest of the session.
  it('grows back when the value gets shorter', () => {
    const node = el(200, 400, '110984.4 ms')
    fitText(node)
    expect(rendered(node)).toBeLessThan(BASE)

    // A shorter value in the same element, as a drag produces.
    Object.defineProperty(node, 'scrollWidth', {
      configurable: true,
      get: () => (100 * rendered(node)) / BASE,
    })
    node.textContent = '9'
    fitText(node)
    expect(node.style.fontSize).toBe('')
    expect(rendered(node)).toBe(BASE)
  })

  // A drag calls this on fifteen cards per pointer move. The ones whose value
  // did not change are worth not measuring again.
  it('does nothing when neither the text nor the width changed', () => {
    let reads = 0
    const node = document.createElement('div')
    node.className = 'fit-base'
    node.textContent = '61'
    document.body.append(node)
    Object.defineProperty(node, 'clientWidth', { get: () => 200 })
    Object.defineProperty(node, 'scrollWidth', {
      get: () => {
        reads++
        return 150
      },
    })

    fitText(node)
    expect(reads).toBe(1)
    fitText(node)
    fitText(node)
    expect(reads).toBe(1)

    node.textContent = '62'
    fitText(node)
    expect(reads).toBe(2)
  })

  // Before layout there is nothing to fit to, and dividing by a zero width would
  // produce an infinite size.
  it('does nothing for an element with no width yet', () => {
    const node = el(0, 300, '61')
    fitText(node)
    expect(node.style.fontSize).toBe('')
  })
})

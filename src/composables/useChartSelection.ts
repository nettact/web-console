// Dragging a time span across a chart, and mirroring it onto every other chart
// on the page.
//
// # Why this is a hand-rolled overlay and not ECharts' brush
//
// The deciding argument is mirroring, not authoring cost.
//
//   - There is no toolbox on these charts, so `brush` has to be armed with
//     dispatchAction — and re-armed after every setOption(opt, true), because
//     notMerge discards component state. Every locale switch, theme switch and
//     data refresh would silently disarm all fourteen charts.
//   - Mirroring one drag onto the other thirteen is a dispatchAction per chart
//     per pointermove, each triggering an internal layout pass and echoing a
//     brushSelected that has to be told apart from a real drag, or the charts
//     feed each other in a loop.
//   - An armed brush takes over the pointer, so the axis tooltip stops working
//     during the drag — exactly when a reader wants to see values.
//
// The overlay is an absolutely-positioned div with pointer-events: none. NO
// chart runs setOption during a drag; mirroring onto thirteen charts is thirteen
// style writes. And it is one code path, shared verbatim by the two chart
// components.
//
// # The one thing that must not be got wrong
//
// Both chart components re-render on a DEEP watcher over their whole prop list.
// The selection prop must be excluded from that list and handled by its own
// shallow watcher, or a drag becomes fourteen full setOption(opt, true) calls
// per pointer event.

import { onBeforeUnmount, watch, type Ref } from 'vue'
import type { ECharts } from 'echarts'

// A selected span in epoch ms, or nothing selected.
export type TimeSelection = [number, number] | null

// How far the pointer must travel before a press counts as a drag. Under it, a
// pointerup is a click — which clears the selection, so a reader who has finished
// reading a span dismisses it the way they would expect to.
const CLICK_SLOP = 4

export interface ChartSelectionHost {
  // The chart's container element.
  el: () => HTMLElement | undefined
  // The live ECharts instance, or null before mount and after dispose. Read
  // through a getter rather than passed once, because the caller replaces it on
  // mount and clears it on unmount.
  chart: () => ECharts | null
  // The shared selection, owned by the page and prop-drilled in. Written here on
  // drag and read by every chart to draw its own overlay.
  selection: Ref<TimeSelection>
  // Whether this chart may be dragged at all.
  //
  // It exists because the shared chart component is used on pages that have no
  // selection UI. defineModel hands back a writable local ref whether or not a
  // parent bound it, so without this every dashboard and history chart in the
  // app would silently become draggable and grow a highlight that nothing
  // explains and no panel reports. A chart is selectable only where a page
  // actually owns the selection.
  //
  // Checked on each press rather than once, so a component whose binding appears
  // later behaves correctly without being remounted.
  enabled?: () => boolean
}

// roundToSeconds snaps a raw drag to whole seconds.
//
// A bucket IS a second, so a selection ending halfway through one would either
// include a second the reader did not drag over or exclude one they did — and
// the statistics cannot express a fraction of a bucket either way. `from` floors
// and `to` ceils, so the span always covers every second the pointer crossed.
export function roundToSeconds(a: number, b: number): [number, number] {
  const lo = Math.min(a, b)
  const hi = Math.max(a, b)
  return [Math.floor(lo / 1000) * 1000, Math.ceil(hi / 1000) * 1000]
}

// covers reports whether a bucket closing at ts falls inside a span.
//
// Half-open at the start, matching the convention the bands use and the meaning
// of a bucket's timestamp: it names the moment the second CLOSED, so the second
// ending exactly at `from` belongs to whatever came before.
export const covers = (span: TimeSelection, ts: number): boolean => !!span && ts > span[0] && ts <= span[1]

// The two conversions between a horizontal pixel and a moment on the axis.
//
// # Why these take a NUMBER and not a point
//
// convertFromPixel and convertToPixel are overloaded. Given an {xAxisIndex}
// finder they convert ALONG that axis and take a scalar; given a point array
// they convert a position INSIDE THE GRID RECTANGLE, and a point outside that
// rectangle comes back as an empty array rather than as an error.
//
// The array form was tried first, with a y of 0. Zero is the top of the
// container, which is above the grid — every conversion returned nothing, so no
// drag ever started and no highlight was ever placed. The scalar form has no
// grid rectangle to fall outside of, which is the whole reason it is the right
// one here: the selection is about x and has no y at all.
//
// They are exported so that can be pinned by a test rather than rediscovered.
export function timeAtPixel(chart: ECharts, offsetX: number): number | null {
  const ms = chart.convertFromPixel({ xAxisIndex: 0 }, offsetX)
  return Number.isFinite(ms) ? ms : null
}

export function pixelAtTime(chart: ECharts, ms: number): number | null {
  const x = chart.convertToPixel({ xAxisIndex: 0 }, ms)
  return Number.isFinite(x) ? x : null
}

// useChartSelection makes one chart draggable and keeps the shared selection in
// step. It returns nothing: everything it does is through the host's refs.
export function useChartSelection(host: ChartSelectionHost) {
  let anchor: number | null = null
  let anchorX = 0
  let moved = false
  let captured: number | null = null

  // The epoch ms under a client x coordinate, or null when the chart cannot
  // answer yet — before mount, or before it has laid out an axis.
  function timeAt(clientX: number): number | null {
    const chart = host.chart()
    const el = host.el()
    if (!chart || !el) return null
    return timeAtPixel(chart, clientX - el.getBoundingClientRect().left)
  }

  function onPointerDown(e: PointerEvent) {
    if (host.enabled && !host.enabled()) return
    // Mouse and pen only. Claiming touch would need touch-action: none, which
    // kills page scrolling on a page that is thirteen charts tall — a reader
    // scrolling on a phone would find the page frozen wherever their thumb
    // landed.
    if (e.pointerType !== 'mouse' && e.pointerType !== 'pen') return
    if (e.button !== 0) return
    const ms = timeAt(e.clientX)
    if (ms === null) return
    anchor = ms
    anchorX = e.clientX
    moved = false
    // Captured so a drag that leaves the chart — which is most of them, since
    // the reader is comparing against the chart below — keeps tracking.
    const el = host.el()
    if (el) {
      el.setPointerCapture(e.pointerId)
      captured = e.pointerId
    }
  }

  function onPointerMove(e: PointerEvent) {
    if (anchor === null) return
    if (!moved && Math.abs(e.clientX - anchorX) < CLICK_SLOP) return
    moved = true
    const ms = timeAt(e.clientX)
    if (ms === null) return
    host.selection.value = roundToSeconds(anchor, ms)
  }

  function endDrag(e: PointerEvent) {
    if (anchor === null) return
    const el = host.el()
    if (el && captured !== null) {
      // releasePointerCapture throws when the capture has already gone, which
      // happens on a pointercancel the browser issued itself.
      try {
        el.releasePointerCapture(captured)
      } catch {
        /* already released */
      }
    }
    captured = null
    // A press that never became a drag is a click, and a click clears.
    if (!moved) host.selection.value = null
    anchor = null
    moved = false
    // A zero-width span is not a selection. It happens when a drag ends inside
    // one second, and keeping it would leave a panel reporting a span of nothing.
    const sel = host.selection.value
    if (sel && sel[1] <= sel[0]) host.selection.value = null
    void e
  }

  function onKeyDown(e: KeyboardEvent) {
    if (host.enabled && !host.enabled()) return
    if (e.key === 'Escape') host.selection.value = null
  }

  function attach() {
    const el = host.el()
    if (!el) return
    // Bubble phase, so ECharts' own canvas listeners fire too and the axis
    // tooltip keeps working through the drag.
    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('pointermove', onPointerMove)
    el.addEventListener('pointerup', endDrag)
    el.addEventListener('pointercancel', endDrag)
    window.addEventListener('keydown', onKeyDown)
  }

  function detach() {
    const el = host.el()
    if (el) {
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('pointermove', onPointerMove)
      el.removeEventListener('pointerup', endDrag)
      el.removeEventListener('pointercancel', endDrag)
    }
    window.removeEventListener('keydown', onKeyDown)
  }

  // Attached once the element exists. The caller mounts the chart first, so this
  // runs after it rather than racing it.
  watch(host.el, (el) => (el ? attach() : detach()), { flush: 'post' })
  onBeforeUnmount(detach)

  return { attach, detach }
}

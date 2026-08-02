// Shaded spans behind a chart's lines: the seconds that hitched, and the
// stretches that produced no frames at all.
//
// They live together because they are drawn by one mechanism and would collide
// if they were not. ECharts hangs a markArea off a series, so a chart gets ONE —
// and two kinds of band sharing it must not be merged into each other, or a
// stutter would silently absorb the alt-tab beside it and the tooltip would
// explain the wrong thing.
//
// The rule this file exists to enforce: merge within a kind, never across.

// What a band means, which decides how it is coloured and what it says.
//
// It is a string rather than a closed union because the gap vocabulary belongs
// to the sensor and is open: a code this build does not recognize must still be
// drawn, as an unlabelled band, because the stretch happened either way and
// hiding it puts back the blank the record was added to remove.
export type BandKind = 'stutter' | 'gapBackground' | 'gapNoFrames' | 'gapUnknown'

// One span to shade. `from` is exclusive and `to` inclusive, matching how a
// bucket's timestamp names the moment its second CLOSED: a band over the second
// ending at T covers (T-1000, T], and two touching seconds do not both claim the
// boundary between them.
export interface ChartBand {
  kind: BandKind
  from: number
  to: number
  // The sentence the tooltip adds for the seconds this band covers. Empty for a
  // band whose kind carries no detail worth a sentence.
  text: string
}

// mergeBands collapses touching or overlapping spans OF THE SAME KIND into one,
// and returns them grouped by kind in the order the kinds first appear.
//
// Merging matters because a run that stuttered through a whole minute would
// otherwise render as sixty bands, each with its own edge; and an hour spent
// minimized arrives as one interval already, but a clock step can split it into
// two overlapping ones and those should draw as a single stretch.
//
// Merging ACROSS kinds is what must never happen. A stutter is a long frame
// inside a second that had frames; a gap is a second that had none. A band that
// claimed to be both would be drawn in one colour and explained by whichever
// tooltip won, and the reader would have no way to tell which they were looking
// at.
export function mergeBands(bands: readonly ChartBand[]): { kind: BandKind; spans: [number, number][] }[] {
  const order: BandKind[] = []
  const byKind = new Map<BandKind, ChartBand[]>()
  for (const b of bands) {
    let list = byKind.get(b.kind)
    if (!list) {
      list = []
      byKind.set(b.kind, list)
      order.push(b.kind)
    }
    list.push(b)
  }
  return order.map((kind) => {
    const spans: [number, number][] = []
    for (const b of [...byKind.get(kind)!].sort((a, c) => a.from - c.from)) {
      const last = spans[spans.length - 1]
      if (last && b.from <= last[1]) last[1] = Math.max(last[1], b.to)
      else spans.push([b.from, b.to])
    }
    return { kind, spans }
  })
}

// bandAt returns the band covering an instant, searched against the UNMERGED
// list so each second keeps its own figures — a run that stuttered through a
// minute draws one band and still explains each second individually.
//
// A stutter wins a tie with a gap, though the two should never overlap: a second
// either held frames or did not. If a source ever produces both, the stutter is
// the more specific claim and the one worth surfacing.
export function bandAt(bands: readonly ChartBand[] | undefined, ms: number): ChartBand | undefined {
  if (!bands?.length) return undefined
  let hit: ChartBand | undefined
  for (const b of bands) {
    if (ms <= b.from || ms > b.to) continue
    if (!hit || (hit.kind !== 'stutter' && b.kind === 'stutter')) hit = b
  }
  return hit
}

// The frame-time histogram, ported one-for-one from protocol/gamesense/histogram.go.
//
// It is here because the console now computes figures for a span the reader
// selected, and those figures cannot be averaged out of the per-second ones. A
// "1% low" is the slowest one percent of frames across a WHOLE span, and a mean
// of per-second percentiles is not that number — it is not any number. The
// histogram is the additive form: sum the selected seconds bin by bin and the
// low figures follow.
//
// # Keeping this in step with the Go implementation
//
// This is a second copy of arithmetic that already exists, and the copy is the
// thing that can drift. Two guards:
//
//   - histogram.golden.json beside this file is read by BOTH suites —
//     histogram.test.ts here and histogram_golden_test.go in protocol. Go going
//     red means Go moved, vitest going red means this port moved, and there is no
//     way for the two to move together silently.
//   - the edge table is asserted structurally in the tests, so a mistyped digit
//     fails even without the fixture.
//
// Numeric note: Go counts bins in uint32 and totals in uint64, while JavaScript
// numbers are exact integers to 2^53. At a run's magnitudes — 10^4 to 10^7
// frames — the port is exact. It does not wrap where Go would, which is
// unreachable at these counts.

// HIST_LAYOUT_LOG24_V1 names the layout on the wire and in storage. The name is
// the compatibility contract: a reader that meets an unfamiliar layout must
// decline to interpret the counts rather than apply its own edges, which would
// turn a bin index into a frame time nobody measured.
export const HIST_LAYOUT_LOG24_V1 = 'log24_v1'

export const HIST_BINS = 24

// The bin boundaries in milliseconds: bin i covers [EDGES[i], EDGES[i+1]).
//
// Literals rather than a loop over 0.5*10^(i/8), for the reason the Go table
// gives: they are stored data. Buckets recorded today are read back and merged
// years from now, possibly by a different runtime, and every one of them must
// agree on where bin 12 begins. A formula is a promise that every future runtime
// rounds the same way; a table is not a promise at all.
export const HIST_EDGES_LOG24_V1: readonly number[] = [
  0.5,
  0.666760716081662,
  0.8891397050194614,
  1.1856868528308277,
  1.5811388300841898,
  2.108482517142911,
  2.8117066259517456,
  3.7494710466622802,
  5.0,
  6.66760716081662,
  8.891397050194614,
  11.856868528308277,
  15.811388300841898,
  21.08482517142911,
  28.117066259517456,
  37.494710466622802,
  50.0,
  66.6760716081662,
  88.91397050194614,
  118.56868528308277,
  158.11388300841898,
  210.8482517142911,
  281.17066259517456,
  374.94710466622802,
  500.0,
]

// The representative frame time of each bin: what a bin's frames are taken to
// have when a statistic is computed from counts alone.
//
// Geometric rather than arithmetic centres, because the bins are geometric. The
// arithmetic middle of [50, 66.68) is 58.3 ms, which is not the value that
// splits the bin evenly in the space it was drawn in; the geometric middle,
// 57.7 ms, is.
//
// DERIVED here rather than tabulated, unlike the edges, and the difference is
// deliberate: IEEE-754 requires sqrt to be correctly rounded, so V8 and Go
// produce bit-identical results from the same table. The edges could not be
// derived that way because they come from a power, which is not.
export const HIST_MIDPOINTS_LOG24_V1: readonly number[] = HIST_EDGES_LOG24_V1.slice(0, HIST_BINS).map((lo, i) =>
  Math.sqrt(lo * HIST_EDGES_LOG24_V1[i + 1]),
)

export function histTotal(counts: readonly number[]): number {
  let total = 0
  for (const c of counts) total += c
  return total
}

// histAdd accumulates src into dst bin by bin. This is the whole reason the
// histogram exists: a span's distribution is the sum of its seconds'.
//
// Mismatched lengths are refused rather than merged, so a bucket recorded under
// a different layout cannot contaminate a total. Callers compare the layout
// first; this is the backstop for when someone forgets.
export function histAdd(dst: number[], src: readonly number[]): boolean {
  if (dst.length !== src.length) return false
  for (let i = 0; i < src.length; i++) dst[i] += src[i]
  return true
}

// sumHistograms merges a span's histograms, or returns null when it cannot.
//
// Null when ANY of them names a layout this build does not know. Interpreting
// the rest and quietly dropping that one would report a distribution missing an
// unknown share of its frames as though it were the span's — and a reader has no
// way to see the omission. Refusing is the honest answer, and the caller renders
// the figures as unavailable with a reason.
export function sumHistograms(hists: readonly { layout: string; counts: number[] }[]): number[] | null {
  const out = new Array<number>(HIST_BINS).fill(0)
  for (const h of hists) {
    if (h.layout !== HIST_LAYOUT_LOG24_V1) return null
    // A second whose counts came back empty contributes nothing and is not an
    // error: bucket retention can leave the row with its layout intact.
    if (!h.counts.length) continue
    if (!histAdd(out, h.counts)) return null
  }
  return out
}

// histMeanFPS returns the mean frame rate a histogram implies: the reciprocal of
// its mean frame time.
//
// Null for an empty histogram rather than 0, which would claim the machine
// rendered nothing.
export function histMeanFPS(counts: readonly number[]): number | null {
  if (counts.length !== HIST_BINS) return null
  const total = histTotal(counts)
  if (total === 0) return null
  let sum = 0
  for (let i = 0; i < counts.length; i++) sum += counts[i] * HIST_MIDPOINTS_LOG24_V1[i]
  if (sum <= 0) return null
  return 1000 / (sum / total)
}

// histLowFPS returns the "N% low" for a merged histogram: the mean frame time of
// the slowest fraction of frames, as frames per second. Pass 0.01 for the 1%
// low, 0.001 for the 0.1% low.
//
// The result is an estimate, because a histogram knows which bin a frame landed
// in and not where inside it. With this layout the error is bounded by the bin
// width — under 15%, and in practice far less, since the slow tail usually
// spreads over several bins.
//
// Null when the histogram holds too few frames for the fraction to mean
// anything. One slow frame out of two hundred is not a 1% low, it is one slow
// frame, and publishing it as a statistic invites conclusions the data cannot
// support.
export function histLowFPS(counts: readonly number[], fraction: number): number | null {
  if (counts.length !== HIST_BINS || fraction <= 0 || fraction >= 1) return null
  const total = histTotal(counts)
  // At least ten frames must fall inside the fraction. Below that the figure is
  // dominated by whichever single frame happened to be slowest.
  //
  // Rounded UP, matching the nearest-rank convention used elsewhere: the slowest
  // 1% of 999 frames is ten of them, not nine, and truncating would both measure
  // a slightly smaller tail than asked for and — right at the boundary — fail
  // this minimum for a span that clears it.
  const want = Math.ceil(total * fraction)
  if (want < 10) return null
  // Walk from the slow end, accumulating frame time until the fraction is
  // covered. The last bin is taken partially, so the answer moves smoothly as
  // frames accumulate instead of stepping whenever a bin boundary is crossed.
  let taken = 0
  let sum = 0
  for (let i = HIST_BINS - 1; i >= 0 && taken < want; i--) {
    let n = counts[i]
    if (n === 0) continue
    if (n > want - taken) n = want - taken
    sum += n * HIST_MIDPOINTS_LOG24_V1[i]
    taken += n
  }
  if (taken === 0 || sum <= 0) return null
  return 1000 / (sum / taken)
}

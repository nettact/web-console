import { describe, it, expect } from 'vitest'
import {
  CAP_BUSIEST_CORE,
  CAP_CPU_SPLIT,
  CAP_DISPLAYED,
  CAP_FRAME_TYPE,
  CAP_GPU_SPLIT,
  CAP_GPU_TEL,
  CAP_LATENCY,
  CAP_PRESENT_META,
  CAP_PROC_CPU,
  CAP_PROC_MEM,
  CAP_PROC_VRAM,
  CAP_STUTTER,
  type GameBucket,
  type GameRun,
} from '../api'
import {
  bucketsAbsence,
  bucketsTruncated,
  chartFloor,
  diagAbsence,
  DIAG_CAPS,
  isRunning,
  missingCause,
  observes,
  presentCause,
  qualityFlags,
  seriesHasValue,
  stutterMarkState,
  stutterPerMinute,
  stutterSeconds,
} from './gameRun'

function bucket(over: Partial<GameBucket> = {}): GameBucket {
  return {
    run_id: 'r1',
    ts: '2026-08-01T10:00:00Z',
    frames: { presented: 120 },
    ft: { avg: 8.3, p50: 8.2, p95: 9.1, p99: 12.4, max: 20, sd: 1.1 },
    ft_hist: { layout: 'log24_v1', counts: [] },
    ...over,
  }
}

describe('missingCause', () => {
  it('blames the capability the source lacks', () => {
    expect(missingCause('dropped', [CAP_FRAME_TYPE])).toEqual({ kind: 'source', cap: CAP_DISPLAYED })
    expect(missingCause('app', [CAP_DISPLAYED])).toEqual({ kind: 'source', cap: CAP_FRAME_TYPE })
    expect(missingCause('present', [])).toEqual({ kind: 'source', cap: CAP_PRESENT_META })
  })

  it('distinguishes a declared-but-empty capability from a missing one', () => {
    expect(missingCause('displayed', [CAP_DISPLAYED])).toEqual({ kind: 'notRecorded' })
  })

  it('backs the stutter and process-resource fields with their own capabilities', () => {
    expect(missingCause('stutter', [CAP_DISPLAYED])).toEqual({ kind: 'source', cap: CAP_STUTTER })
    expect(missingCause('procCpu', [CAP_PROC_MEM])).toEqual({ kind: 'source', cap: CAP_PROC_CPU })
    expect(missingCause('procWs', [CAP_PROC_CPU])).toEqual({ kind: 'source', cap: CAP_PROC_MEM })
    expect(missingCause('procPriv', [CAP_PROC_CPU])).toEqual({ kind: 'source', cap: CAP_PROC_MEM })
  })

  // A source can read the game's memory without being able to read its CPU, so
  // one capability must not stand in for the other.
  it('does not let one process capability answer for the other', () => {
    expect(missingCause('procCpu', [CAP_PROC_CPU])).toEqual({ kind: 'notRecorded' })
    expect(missingCause('procWs', [CAP_PROC_MEM])).toEqual({ kind: 'notRecorded' })
  })

  // The diagnostic depth is six capabilities and not one, because they come from
  // four different acquisition paths and a machine can support any subset. A run
  // whose driver publishes no adapter telemetry still has its frame breakdown,
  // and the blank where the GPU chart would be has to say which of the two it is.
  it('names the diagnostic capability behind each family', () => {
    const base = [CAP_DISPLAYED, CAP_STUTTER]
    expect(missingCause('cpuSplit', base)).toEqual({ kind: 'source', cap: CAP_CPU_SPLIT })
    expect(missingCause('gpuSplit', base)).toEqual({ kind: 'source', cap: CAP_GPU_SPLIT })
    expect(missingCause('presentChain', base)).toEqual({ kind: 'source', cap: CAP_GPU_SPLIT })
    expect(missingCause('displayLatency', base)).toEqual({ kind: 'source', cap: CAP_LATENCY })
    expect(missingCause('animError', base)).toEqual({ kind: 'source', cap: CAP_LATENCY })
    expect(missingCause('gpuUtil', base)).toEqual({ kind: 'source', cap: CAP_GPU_TEL })
    expect(missingCause('gpuMem', base)).toEqual({ kind: 'source', cap: CAP_GPU_TEL })
    expect(missingCause('procVram', base)).toEqual({ kind: 'source', cap: CAP_PROC_VRAM })
    expect(missingCause('busiestCore', base)).toEqual({ kind: 'source', cap: CAP_BUSIEST_CORE })
  })

  // The whole-card telemetry and the game's own video memory are different
  // readings from different queries, and conflating them is exactly the error
  // the labels on those two charts exist to prevent.
  it('does not let whole-GPU telemetry answer for the process figures', () => {
    expect(missingCause('procVram', [CAP_GPU_TEL])).toEqual({ kind: 'source', cap: CAP_PROC_VRAM })
    expect(missingCause('gpuUtil', [CAP_PROC_VRAM])).toEqual({ kind: 'source', cap: CAP_GPU_TEL })
    expect(missingCause('busiestCore', [CAP_PROC_CPU])).toEqual({ kind: 'source', cap: CAP_BUSIEST_CORE })
  })

  // A declared diag capability whose seconds came back empty is a different
  // story from one that was never offered: the first is what `diag_degraded`
  // leaves behind mid-run, and it must not be reported as a missing sensor.
  it('separates a declared diagnostic capability from a missing one', () => {
    expect(missingCause('cpuSplit', [CAP_CPU_SPLIT])).toEqual({ kind: 'notRecorded' })
    expect(missingCause('gpuUtil', [CAP_GPU_TEL])).toEqual({ kind: 'notRecorded' })
    expect(missingCause('busiestCore', [CAP_BUSIEST_CORE])).toEqual({ kind: 'notRecorded' })
  })

  // A null 1% low says the run was too short to support the figure. Blaming a
  // capability for it would send the user off installing something that would not
  // have helped.
  it('attributes a null run-level FPS figure to the frame count, not to a capability', () => {
    expect(missingCause('fpsStat', [])).toEqual({ kind: 'tooFewFrames' })
    expect(missingCause('fpsStat', [CAP_DISPLAYED, CAP_FRAME_TYPE])).toEqual({ kind: 'tooFewFrames' })
  })
})

describe('observes', () => {
  it('gates the optional series on their capability', () => {
    expect(observes('displayed', [CAP_DISPLAYED])).toBe(true)
    expect(observes('displayed', [])).toBe(false)
    expect(observes('generated', [CAP_FRAME_TYPE])).toBe(true)
  })

  it('treats an always-present field as observed', () => {
    expect(observes('fpsStat', [])).toBe(true)
  })

  it('gates the stutter markers and the two process charts separately', () => {
    expect(observes('stutter', [CAP_STUTTER])).toBe(true)
    expect(observes('stutter', [CAP_PROC_CPU, CAP_PROC_MEM])).toBe(false)
    expect(observes('procCpu', [CAP_PROC_MEM])).toBe(false)
    expect(observes('procWs', [CAP_PROC_MEM])).toBe(true)
  })

  // A base-tier run declares none of the diagnostic capabilities, so none of
  // those charts may be drawn at all — an empty axis under a title promising a
  // CPU/GPU breakdown reads as a game that used no GPU time.
  it('draws no diagnostic chart for a run that declared none of it', () => {
    const base = [CAP_DISPLAYED, CAP_FRAME_TYPE, CAP_PRESENT_META, CAP_STUTTER, CAP_PROC_CPU, CAP_PROC_MEM]
    for (const f of ['cpuSplit', 'gpuSplit', 'presentChain', 'displayLatency', 'gpuUtil', 'procVram', 'busiestCore'] as const) {
      expect(observes(f, base), f).toBe(false)
    }
  })

  // The mixed case a partly-supported machine actually produces: frame-derived
  // breakdowns registered, adapter telemetry not published by the driver.
  it('lets one diagnostic family be observed while another is not', () => {
    const caps = [CAP_CPU_SPLIT, CAP_GPU_SPLIT, CAP_LATENCY]
    expect(observes('cpuSplit', caps)).toBe(true)
    expect(observes('presentChain', caps)).toBe(true)
    expect(observes('displayLatency', caps)).toBe(true)
    expect(observes('gpuUtil', caps)).toBe(false)
    expect(observes('gpuMem', caps)).toBe(false)
    expect(observes('procVram', caps)).toBe(false)
    expect(observes('busiestCore', caps)).toBe(false)
  })
})

// The section notice under the charts tells the reader what to do about six
// missing chart rows, and the three answers are not interchangeable: one is a
// profile setting, one is an agent permission, one is a machine that could not
// provide the reading. Getting this wrong sends someone to re-select a capture
// depth that is already Diagnostic and leaves the real cause unsaid.
describe('diagAbsence', () => {
  const BASE = [CAP_DISPLAYED, CAP_FRAME_TYPE, CAP_PRESENT_META, CAP_STUTTER, CAP_PROC_CPU, CAP_PROC_MEM]

  it('says nothing when the run carries every diagnostic capability', () => {
    expect(diagAbsence([...BASE, ...DIAG_CAPS])).toBe('none')
  })

  // The base-depth run: not one diagnostic capability, and the profile's tier is
  // the only thing that decides it.
  it('blames the capture depth when no diagnostic capability is declared', () => {
    expect(diagAbsence(BASE)).toBe('tier')
    expect(diagAbsence([])).toBe('tier')
  })

  // The run WAS captured at the diagnostic depth and the GPU-sourced pair is
  // exactly what is missing — game.gpu.read not granted or not effective, or a
  // machine that publishes no GPU telemetry. Re-selecting the tier fixes nothing.
  it('blames the GPU permission when only the GPU-sourced pair is missing', () => {
    expect(diagAbsence([...BASE, CAP_CPU_SPLIT, CAP_GPU_SPLIT, CAP_LATENCY, CAP_BUSIEST_CORE])).toBe('gpu')
  })

  // Either GPU capability alone counts: a source can publish adapter telemetry
  // without being able to answer the per-process video memory query.
  it('treats one absent GPU capability the same way', () => {
    const caps = [...BASE, CAP_CPU_SPLIT, CAP_GPU_SPLIT, CAP_LATENCY, CAP_BUSIEST_CORE, CAP_GPU_TEL]
    expect(diagAbsence(caps)).toBe('gpu')
    expect(diagAbsence([...caps.filter((c) => c !== CAP_GPU_TEL), CAP_PROC_VRAM])).toBe('gpu')
  })

  // A diagnostic run missing something that has nothing to do with the GPU: a
  // source that did not initialize. Still not a tier problem, so the notice must
  // not offer the tier as the fix.
  it('reports a partly-initialized diagnostic run without blaming the depth', () => {
    expect(diagAbsence([...BASE, CAP_CPU_SPLIT, CAP_GPU_SPLIT, CAP_LATENCY, CAP_GPU_TEL, CAP_PROC_VRAM])).toBe(
      'partial',
    )
    expect(diagAbsence([...BASE, CAP_CPU_SPLIT, CAP_BUSIEST_CORE])).toBe('partial')
  })

  // The boundary between 'tier' and the other two: a single diagnostic
  // capability is enough to prove the run asked for the depth, and from there the
  // profile page is the wrong advice.
  it('stops blaming the depth as soon as one diagnostic capability is present', () => {
    for (const cap of DIAG_CAPS) {
      expect(diagAbsence([...BASE, cap]), cap).not.toBe('tier')
    }
  })
})

describe('isRunning', () => {
  it('reads a null ended_at as still presenting', () => {
    expect(isRunning({ ended_at: null })).toBe(true)
    expect(isRunning({ ended_at: '2026-08-01T11:00:00Z' })).toBe(false)
  })
})

describe('bucketsTruncated', () => {
  const run = (durationSeconds: number) =>
    ({ summary: { duration_seconds: durationSeconds } } as Pick<GameRun, 'summary'>)

  it('flags a run longer than the seconds actually fetched', () => {
    expect(bucketsTruncated(run(7200), new Array(3600).fill(bucket()), 3600)).toBe(true)
  })

  it('leaves a fully fetched run alone', () => {
    expect(bucketsTruncated(run(600), new Array(600).fill(bucket()), 3600)).toBe(false)
  })

  // Idle seconds produce no bucket at all, so a run can span more wall-clock
  // seconds than it has buckets without being truncated.
  it('does not flag a short run that simply paused', () => {
    expect(bucketsTruncated(run(1200), new Array(600).fill(bucket()), 3600)).toBe(false)
  })
})

// A run whose seconds were pruned keeps its totals, so `presented` is what tells
// the two empty charts apart: frames were counted, and then their detail expired.
function summarized(presented: number): Pick<GameRun, 'summary'> {
  return {
    summary: {
      duration_seconds: 600,
      mean_fps: presented > 0 ? 120 : null,
      low_1pct_fps: null,
      low_0_1pct_fps: null,
      presented,
      displayed: null,
      dropped: null,
    },
  }
}

describe('bucketsAbsence', () => {
  it('reads counted frames with no seconds left as retention, not as a run that measured nothing', () => {
    expect(bucketsAbsence(summarized(842_000))).toBe('aged-out')
  })

  it('reads a run that never counted a frame as never recorded', () => {
    expect(bucketsAbsence(summarized(0))).toBe('never-recorded')
  })
})

describe('presentCause', () => {
  it('blames retention once the seconds the block lived on are gone', () => {
    expect(presentCause(summarized(842_000), [], [CAP_PRESENT_META])).toEqual({ kind: 'expired' })
  })

  // The capability is a property of the whole run and was already true before
  // retention ran, so it stays the answer — installing a source that can read
  // presentation details is the actionable advice, expiry is not.
  it('keeps blaming a missing capability over retention', () => {
    expect(presentCause(summarized(842_000), [], [])).toEqual({ kind: 'source', cap: CAP_PRESENT_META })
  })

  it('leaves a run whose seconds are loaded to the ordinary reasons', () => {
    expect(presentCause(summarized(842_000), [bucket()], [CAP_PRESENT_META])).toEqual({ kind: 'notRecorded' })
    expect(presentCause(summarized(0), [], [CAP_PRESENT_META])).toEqual({ kind: 'notRecorded' })
  })
})

describe('stutterSeconds', () => {
  const at = (iso: string, over: Partial<GameBucket> = {}) => bucket({ ts: iso, ...over })

  it('marks only the seconds that actually hitched', () => {
    const marks = stutterSeconds([
      at('2026-08-01T10:00:01Z', { stutter: { count: 2, excess_ms: 180.4 } }),
      at('2026-08-01T10:00:02Z', { stutter: { count: 0, excess_ms: 0 } }),
      at('2026-08-01T10:00:03Z'),
      at('2026-08-01T10:00:04Z', { stutter: { count: 1, excess_ms: 62 } }),
    ])
    expect(marks.map((m) => m.count)).toEqual([2, 1])
    expect(marks[0].excessMs).toBe(180.4)
  })

  // A watched second that held nothing is the good news the block exists to
  // carry, and shading it would say the opposite. Only 0/0 qualifies.
  it('leaves a watched but smooth second unmarked', () => {
    expect(stutterSeconds([at('2026-08-01T10:00:01Z', { stutter: { count: 0, excess_ms: 0 } })])).toEqual([])
  })

  // A merged event is counted in the second it STARTED in, while the time it
  // cost is booked to every second it spanned. A freeze crossing a boundary
  // therefore leaves count 0 with a positive excess behind it — a second the
  // screen was still frozen through, which must be shaded like any other.
  it('marks the continuation second of a freeze that spans a boundary', () => {
    const marks = stutterSeconds([
      at('2026-08-01T10:00:01Z', { stutter: { count: 1, excess_ms: 420 } }),
      at('2026-08-01T10:00:02Z', { stutter: { count: 0, excess_ms: 180 } }),
      at('2026-08-01T10:00:03Z', { stutter: { count: 0, excess_ms: 0 } }),
    ])
    expect(marks.map((m) => m.kind)).toEqual(['start', 'continuation'])
    expect(marks.map((m) => m.excessMs)).toEqual([420, 180])
  })

  // The kind is what picks the tooltip wording: a continuation second must not
  // be described as "0 stutters" underneath a band that says otherwise.
  it('calls a second holding an event a start even with no measured excess', () => {
    const [m] = stutterSeconds([at('2026-08-01T10:00:01Z', { stutter: { count: 1, excess_ms: 0 } })])
    expect(m.kind).toBe('start')
  })

  // The bucket timestamp is the moment the second CLOSED, so the span it
  // describes ends there. Shading forward would mark the second after the hitch.
  it('spans the second ending at the bucket timestamp', () => {
    const [m] = stutterSeconds([at('2026-08-01T10:00:05Z', { stutter: { count: 1, excess_ms: 90 } })])
    const ts = Date.parse('2026-08-01T10:00:05Z')
    expect(m).toMatchObject({ from: ts - 1000, to: ts })
  })
})

describe('chartFloor', () => {
  const bucketAt = (iso: string) => bucket({ ts: iso })

  // The boundary that motivates this: a run whose first bucket CLOSES at
  // started_at. That second began a second earlier, so a band drawn for it lands
  // entirely left of an axis pinned at started_at and gets clipped to nothing —
  // the single hitch in a single-second run vanishing off the chart while the
  // card above still counts it.
  it('reaches back to where the first loaded second began', () => {
    const start = Date.parse('2026-08-01T10:00:00Z')
    expect(chartFloor(start, [bucketAt('2026-08-01T10:00:00Z')])).toBe(start - 1000)
  })

  it('keeps a stutter band inside the window it will be drawn in', () => {
    const start = Date.parse('2026-08-01T10:00:00Z')
    const buckets = [bucket({ ts: '2026-08-01T10:00:00Z', stutter: { count: 1, excess_ms: 120 } })]
    const [mark] = stutterSeconds(buckets)
    expect(mark.from).toBeGreaterThanOrEqual(chartFloor(start, buckets))
    expect(mark.to).toBeGreaterThan(chartFloor(start, buckets))
  })

  // The ordinary run, whose first second closes after it started: the run's own
  // start is already early enough and must not be pushed back for no reason.
  it('leaves a run whose first second closes after it started alone', () => {
    const start = Date.parse('2026-08-01T10:00:00Z')
    expect(chartFloor(start, [bucketAt('2026-08-01T10:00:05Z')])).toBe(start)
  })

  it('has nothing to widen for when no second was loaded', () => {
    const start = Date.parse('2026-08-01T10:00:00Z')
    expect(chartFloor(start, [])).toBe(start)
  })
})

describe('stutterMarkState', () => {
  const run = (stutter_count: number | null) => ({ stutter_count })

  it('says nothing about stutter when the source cannot detect it', () => {
    expect(stutterMarkState(run(null), 0, [])).toBe('unwatched')
    expect(stutterMarkState(run(4), 2, [CAP_DISPLAYED])).toBe('unwatched')
  })

  it('reports shaded seconds as marked', () => {
    expect(stutterMarkState(run(4), 2, [CAP_STUTTER])).toBe('marked')
  })

  // The whole point: a clipped run whose hitches fell past the last loaded
  // second must not be called smooth, because the card above it says otherwise.
  it('refuses to call a run smooth when its own count disagrees', () => {
    expect(stutterMarkState(run(37), 0, [CAP_STUTTER])).toBe('elsewhere')
  })

  // A segment holding only the tail of a freeze that began before it is shaded,
  // so it is 'marked' — saying the hitches lie outside the displayed detail
  // would contradict the bands the reader can see.
  it('treats a segment of continuation-only bands as marked', () => {
    const marks = stutterSeconds([
      bucket({ ts: '2026-08-01T10:00:02Z', stutter: { count: 0, excess_ms: 180 } }),
    ])
    expect(marks).toHaveLength(1)
    expect(stutterMarkState(run(1), marks.length, [CAP_STUTTER])).toBe('marked')
  })

  it('reads a whole-run zero as genuinely smooth', () => {
    expect(stutterMarkState(run(0), 0, [CAP_STUTTER])).toBe('smooth')
  })

  it('separates a declared detector that produced no figure from a quiet one', () => {
    expect(stutterMarkState(run(null), 0, [CAP_STUTTER])).toBe('notRecorded')
  })
})

describe('stutterPerMinute', () => {
  it('scales the count by the run length', () => {
    expect(stutterPerMinute(30, 600)).toBe(3)
  })

  // Dividing an unmeasured count would manufacture a rate of 0 for a run nobody
  // watched — the one statement this module exists to prevent.
  it('declines a rate for a count that was never measured', () => {
    expect(stutterPerMinute(null, 600)).toBeNull()
  })

  it('declines a rate rather than dividing by a zero duration', () => {
    expect(stutterPerMinute(4, 0)).toBeNull()
  })

  // Zero stutters over a real duration is a measurement, not an absence.
  it('reports a measured zero as a zero rate', () => {
    expect(stutterPerMinute(0, 600)).toBe(0)
  })
})

describe('seriesHasValue', () => {
  it('separates an all-null series from one with a reading', () => {
    expect(seriesHasValue([[1, null], [2, null]])).toBe(false)
    expect(seriesHasValue([[1, null], [2, 0]])).toBe(true)
    expect(seriesHasValue([])).toBe(false)
  })
})

describe('qualityFlags', () => {
  it('collects distinct flags in first-seen order', () => {
    const buckets = [
      bucket({ quality: ['hist_clipped'] }),
      bucket(),
      bucket({ quality: ['consume_backlog', 'hist_clipped'] }),
    ]
    expect(qualityFlags(buckets)).toEqual(['hist_clipped', 'consume_backlog'])
  })

  // diag_degraded is raised part-way through a run — the second the sensor gave
  // up on the polled diagnostics — so every earlier second is unflagged. Reading
  // only the first second would leave the page silent about why the GPU charts
  // stop halfway down the axis.
  it('surfaces a flag that only appears part-way through the run', () => {
    expect(qualityFlags([bucket(), bucket(), bucket({ quality: ['diag_degraded'] })])).toEqual(['diag_degraded'])
  })
})

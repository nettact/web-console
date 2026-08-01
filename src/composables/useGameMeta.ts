// i18n-bound labels and number formatting for the game performance views. The
// pure logic — which capability backs which field, and why a value is missing —
// lives in lib/gameRun.ts; only the wording is here.

import { useI18n } from 'vue-i18n'
import type { BucketsAbsence, MissingCause } from '../lib/gameRun'

export function useGameMeta() {
  const { t, te } = useI18n()

  const keyed = (prefix: string, id: string) => {
    const key = `${prefix}.${id}`
    return te(key) ? t(key) : id
  }

  const capLabel = (cap: string) => keyed('gameRuns.cap', cap)
  const capDesc = (cap: string) => keyed('gameRuns.capDesc', cap)
  const sourceLabel = (source: string) => keyed('gameRuns.source', source)
  const qualityLabel = (flag: string) => keyed('gameRuns.quality', flag)
  const qualityDesc = (flag: string) => keyed('gameRuns.qualityDesc', flag)
  const presentModeLabel = (mode: string) => keyed('gameRuns.presentMode', mode)
  const graphicsApiLabel = (api: string) => keyed('gameRuns.api', api)

  // The tooltip behind every dash. It names the reason AND, for a missing
  // capability, what that capability would have observed — otherwise the reader
  // learns only that something is absent, not whether it is worth fixing.
  const missingText = (cause: MissingCause): string => {
    if (cause.kind === 'source') {
      return `${t('gameRuns.missingSource', { cap: capLabel(cause.cap) })}\n${capDesc(cause.cap)}`
    }
    if (cause.kind === 'tooFewFrames') return t('gameRuns.missingTooFewFrames')
    if (cause.kind === 'expired') return t('gameRuns.missingExpired')
    return t('gameRuns.missingNotRecorded')
  }

  // What a chartless run gets told. The two answers are opposites — one run has
  // data the reader can no longer see, the other never produced any — so they are
  // kept apart here rather than collapsed into one "no data" line.
  const bucketsAbsenceText = (absence: BucketsAbsence): string =>
    absence === 'aged-out' ? t('gameRuns.noBucketsAgedOut') : t('gameRuns.noBucketsNeverRecorded')

  const fmtFps = (v: number) => v.toFixed(1)
  const fmtCount = (v: number) => v.toLocaleString()

  // Whole-run duration as h/m/s. Deliberately not the shared fmtDur, which rounds
  // to a single unit: a run is a session someone sat through, and "1.4 hours" is a
  // worse answer than "1h 24m" for a thing measured in seconds.
  const fmtRunDuration = (sec: number): string => {
    const s = Math.max(0, Math.floor(sec))
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    if (h > 0) return t('gameRuns.durHM', { h, m })
    if (m > 0) return t('gameRuns.durMS', { m, s: s % 60 })
    return t('gameRuns.durS', { s })
  }

  return {
    capLabel,
    capDesc,
    sourceLabel,
    qualityLabel,
    qualityDesc,
    presentModeLabel,
    graphicsApiLabel,
    missingText,
    bucketsAbsenceText,
    fmtFps,
    fmtCount,
    fmtRunDuration,
  }
}

// Human-readable capacity formatting. Raw byte / byte-per-second counts get huge
// fast (a NIC's RX counter is easily billions of bytes), so scale them to
// KB/MB/GB/TB/PB instead of dumping the raw "B" value.

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']

export function fmtBytes(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return '—'
  const neg = v < 0
  let n = Math.abs(v)
  let i = 0
  while (n >= 1024 && i < BYTE_UNITS.length - 1) {
    n /= 1024
    i++
  }
  return `${neg ? '-' : ''}${n.toFixed(n >= 100 || i === 0 ? 0 : 1)} ${BYTE_UNITS[i]}`
}

export const fmtBps = (v: number | null | undefined): string =>
  v == null || Number.isNaN(v) ? '—' : `${fmtBytes(v)}/s`

// True for the wire units whose values are capacity counts and should be scaled.
export const isByteUnit = (u: string): boolean => u === 'bytes' || u === 'bps'

// Format a value according to its wire unit's capacity scale ('bytes' → B/KB/…,
// 'bps' → …/s). Callers should gate on isByteUnit first.
export const fmtByUnit = (u: string, v: number): string => (u === 'bps' ? fmtBps(v) : fmtBytes(v))

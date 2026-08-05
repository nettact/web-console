import { describe, expect, it } from 'vitest'
import { reportFilename } from './reportPdf'

describe('reportFilename', () => {
  it('keeps Chinese and ordinary characters', () => {
    expect(reportFilename('路由器不可达', new Date(2026, 7, 5))).toBe('NetTact-路由器不可达-2026-08-05.pdf')
  })

  it('replaces characters illegal in a path', () => {
    expect(reportFilename('a/b\\c:d*e?f"g<h>i|j', new Date(2026, 7, 5))).toBe(
      'NetTact-a b c d e f g h i j-2026-08-05.pdf',
    )
  })

  it('collapses whitespace and bounds the title', () => {
    const long = 'x'.repeat(120)
    expect(reportFilename(`  ${long}  `, new Date(2026, 7, 5))).toBe(
      `NetTact-${'x'.repeat(40)}-2026-08-05.pdf`,
    )
  })

  it('falls back to a plain name for an empty title', () => {
    expect(reportFilename('', new Date(2026, 7, 5))).toBe('NetTact-report-2026-08-05.pdf')
    expect(reportFilename('   ', new Date(2026, 7, 5))).toBe('NetTact-report-2026-08-05.pdf')
  })
})

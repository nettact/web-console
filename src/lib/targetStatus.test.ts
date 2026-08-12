import { describe, expect, it } from 'vitest'
import { formatAvailability, formatAvailabilityRounds } from './targetStatus'

describe('formatAvailability', () => {
  it('never rounds an observed failure up to 100%', () => {
    expect(formatAvailability(0.99999)).toBe('99.999%')
    expect(formatAvailability(1)).toBe('100%')
  })

  it('truncates availability instead of rounding it', () => {
    expect(formatAvailability(0.99949)).toBe('99.94%')
    expect(formatAvailability(0.9299)).toBe('92.9%')
  })

  it('keeps missing availability unknown', () => {
    expect(formatAvailability(undefined)).toBeNull()
    expect(formatAvailability(Number.NaN)).toBeNull()
  })

  it('formats the exact successful and total round counts', () => {
    expect(formatAvailabilityRounds(10_079, 10_080)).toBe('10,079 / 10,080')
    expect(formatAvailabilityRounds(0, 0)).toBeNull()
  })
})

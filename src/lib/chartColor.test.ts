import { computed } from 'vue'
import * as echarts from 'echarts'
import { afterEach, describe, expect, it } from 'vitest'
import { chartColor, oklchToRgb } from './chartColor'
import { theme } from '../theme'

afterEach(() => {
  document.documentElement.style.removeProperty('--test-chart-color')
  theme.value = 'dark'
})

describe('chartColor', () => {
  it('normalizes OKLCH tokens to a canvas-safe RGB string', () => {
    const color = oklchToRgb('oklch(76% 0.12 235)')

    expect(color).toMatch(/^rgb\(\d+, \d+, \d+\)$/)
    expect(color).not.toContain('oklch')
    expect(echarts.color.modifyAlpha(color!, 0.33)).toMatch(/^rgba\(/)
  })

  it('preserves token alpha while normalizing the color space', () => {
    expect(oklchToRgb('oklch(60% 0.18 250 / 40%)')).toMatch(
      /^rgba\(\d+, \d+, \d+, 0\.4\)$/,
    )
  })

  it('re-resolves a token when the reactive theme changes', () => {
    document.documentElement.style.setProperty('--test-chart-color', 'oklch(76% 0.12 235)')
    const color = computed(() => chartColor('--test-chart-color', '#38bdf8'))
    const dark = color.value

    document.documentElement.style.setProperty('--test-chart-color', 'oklch(58% 0.15 235)')
    theme.value = 'light'

    expect(color.value).not.toBe(dark)
  })
})

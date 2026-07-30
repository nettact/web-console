import { theme } from '../theme'

const OKLCH_RE =
  /^oklch\(\s*([+-]?(?:\d+\.?\d*|\.\d+))(%?)\s+([+-]?(?:\d+\.?\d*|\.\d+))\s+([+-]?(?:\d+\.?\d*|\.\d+))(?:deg)?(?:\s*\/\s*([+-]?(?:\d+\.?\d*|\.\d+))(%?))?\s*\)$/i

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value))

function linearToSrgb(value: number): number {
  const encoded = value <= 0.0031308
    ? 12.92 * value
    : 1.055 * Math.pow(value, 1 / 2.4) - 0.055
  return Math.round(clamp(encoded) * 255)
}

/**
 * Convert the opaque OKLCH tokens used by the design system into a colour
 * format understood by zrender's colour utilities and every Canvas 2D engine.
 */
export function oklchToRgb(input: string): string | null {
  const match = OKLCH_RE.exec(input.trim())
  if (!match) return null

  const lightness = Number(match[1]) / (match[2] ? 100 : 1)
  const chroma = Number(match[3])
  const hue = Number(match[4]) * Math.PI / 180
  const alpha = match[5] == null ? 1 : Number(match[5]) / (match[6] ? 100 : 1)
  if (![lightness, chroma, hue, alpha].every(Number.isFinite)) return null

  const a = chroma * Math.cos(hue)
  const b = chroma * Math.sin(hue)
  const lRoot = lightness + 0.3963377774 * a + 0.2158037573 * b
  const mRoot = lightness - 0.1055613458 * a - 0.0638541728 * b
  const sRoot = lightness - 0.0894841775 * a - 1.291485548 * b
  const l = lRoot ** 3
  const m = mRoot ** 3
  const s = sRoot ** 3

  const red = linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)
  const green = linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)
  const blue = linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)
  const normalizedAlpha = clamp(alpha)

  return normalizedAlpha < 1
    ? `rgba(${red}, ${green}, ${blue}, ${Number(normalizedAlpha.toFixed(3))})`
    : `rgb(${red}, ${green}, ${blue})`
}

/**
 * Resolve a CSS design token for ECharts. Reading theme.value deliberately
 * registers a Vue dependency so canvas series update with the rest of the UI.
 */
export function chartColor(token: string, fallback: string): string {
  void theme.value
  if (typeof document === 'undefined') return fallback
  const raw = getComputedStyle(document.documentElement).getPropertyValue(token).trim()
  if (!raw) return fallback
  return oklchToRgb(raw) ?? raw
}

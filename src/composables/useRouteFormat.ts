import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { toDateLocale } from '../i18n'
import { humanizeSpan, type SpanUnits } from '../lib/routePath'
import { secondsSince } from '../lib/routeStatus'

// Localized formatting shared by the route-monitor status views: absolute
// timestamps, and "how long since" spans humanized to d/h/m.
export function useRouteFormat() {
  const { t, locale } = useI18n()
  const units = computed<SpanUnits>(() => ({
    d: t('route.unit.d'),
    h: t('route.unit.h'),
    m: t('route.unit.m'),
    lessThanMinute: t('route.unit.lessThanMinute'),
  }))
  function fmtTime(value: string | null | undefined): string {
    return value ? new Date(value).toLocaleString(toDateLocale(locale.value), { hour12: false }) : '—'
  }
  // Span from `value` to `now`, e.g. "3d 4h"; '—' when unknown.
  function since(value: string | null | undefined, now: number): string {
    const s = secondsSince(value, now)
    return s == null ? '—' : humanizeSpan(s, units.value)
  }
  return { fmtTime, since }
}

// i18n-bound display names for agent permission IDs, policy sources and target
// selector scopes. Permission IDs contain dots (vue-i18n path separators), so the
// keys under permission.* use underscores; we map an ID to its key by swapping
// dots and fall back to the raw ID when a key is missing.

import { useI18n } from 'vue-i18n'

export function usePermissionMeta() {
  const { t, te } = useI18n()

  const permLabel = (id: string): string => {
    const key = `permission.${id.replace(/\./g, '_')}`
    return te(key) ? t(key) : id
  }

  // Optional per-permission remediation hint (e.g. "needs Administrator"), shown
  // as visible text rather than just a tooltip. Empty when no hint is defined for
  // this ID, so callers can skip rendering it.
  const permHint = (id: string): string => {
    const key = `permissionHint.${id.replace(/\./g, '_')}`
    return te(key) ? t(key) : ''
  }

  const sourceLabel = (source: string): string => {
    const key = `permissionSource.${source}`
    return te(key) ? t(key) : source
  }

  // Selector scopes are named (loopback, lan, public, …) or prefixed
  // (cidr:/ip:/host:). Prefixed selectors are shown verbatim; named ones are
  // localized.
  const selectorLabel = (scope: string): string => {
    const i = scope.indexOf(':')
    if (i > 0) {
      const prefix = scope.slice(0, i)
      if (prefix === 'cidr' || prefix === 'ip' || prefix === 'host') return scope
    }
    const key = `selector.${scope}`
    return te(key) ? t(key) : scope
  }

  return { permLabel, permHint, sourceLabel, selectorLabel }
}

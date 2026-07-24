// i18n-bound display names for agent permission IDs, policy sources and target
// selector scopes. Permission IDs contain dots (vue-i18n path separators), so the
// keys under permission.* use underscores; we map an ID to its key by swapping
// dots and fall back to the raw ID when a key is missing.

import { useI18n } from 'vue-i18n'

// Permissions whose "granted but not supported" state is caused by insufficient
// OS privilege (fixable by re-running the Agent elevated) rather than a hard
// platform/build capability gap. Only raw-socket TCP traceroute today: it is
// granted by policy and reported unsupported until the Agent runs as
// Administrator/root. Every other granted-but-unsupported permission is a genuine
// platform/build gap that no policy change or elevation can resolve.
const ELEVATION_IDS = new Set<string>(['diagnostic.traceroute.tcp'])

// Whether a blocked (granted − supported) permission is remediable by elevation.
export function isElevationPermission(id: string): boolean {
  return ELEVATION_IDS.has(id)
}

// The remediation category of a blocked (granted but not supported) permission:
// `elevation` when re-running the Agent with more privilege enables it, else a
// hard `unsupported` platform/build gap.
export function blockedCategory(id: string): 'elevation' | 'unsupported' {
  return isElevationPermission(id) ? 'elevation' : 'unsupported'
}

export function usePermissionMeta() {
  const { t, te } = useI18n()

  const permLabel = (id: string): string => {
    const key = `permission.${id.replace(/\./g, '_')}`
    return te(key) ? t(key) : id
  }

  // One-line purpose of a permission (what the probe/collector uses it for),
  // shown in the remediation dialog. Empty when no purpose is defined for this ID.
  const permPurpose = (id: string): string => {
    const key = `permissionHint.${id.replace(/\./g, '_')}`
    return te(key) ? t(key) : ''
  }

  // Optional per-permission platform-availability note for a hard `unsupported`
  // block (e.g. "only the Windows build implements this today"). Empty when none
  // is defined, so the dialog falls back to the generic explanation.
  const permPlatforms = (id: string): string => {
    const key = `permissionPlatforms.${id.replace(/\./g, '_')}`
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

  return { permLabel, permPurpose, permPlatforms, sourceLabel, selectorLabel }
}

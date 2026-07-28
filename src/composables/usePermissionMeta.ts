// i18n-bound display names for agent permission IDs, policy sources and target
// selector scopes. Permission IDs contain dots (vue-i18n path separators), so the
// keys under permission.* use underscores; we map an ID to its key by swapping
// dots and fall back to the raw ID when a key is missing.

import { useI18n } from 'vue-i18n'

// Whether a "granted but not supported" permission is fixable by elevation is a
// per-PLATFORM question, so it lives with the platform capability table in
// lib/permissionSelection.ts rather than here. Deciding it from the permission id
// alone was wrong in both directions: it told Linux operators that elevation
// could not enable ICMP probing (it can, with CAP_NET_RAW) and told macOS
// operators to run as Administrator for a capability that build does not have.

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

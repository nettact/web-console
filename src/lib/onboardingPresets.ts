// First-run onboarding target catalog. A data-only, client-owned catalog (mirrors
// the style of ./conditionPresets.ts): the server treats region ids as opaque
// strings, so adding a region here needs no server change. Every preset uses an
// existing probe kind and passes the server's validateTarget.
//
// The wizard creates one monitor group per bucket:
//   - local  — region-independent LAN checks (gateway + NAT); lands in the site's
//              default monitor group.
//   - global — universally-reachable anycast anchors (1.1.1.1 / 8.8.8.8) plus a
//              global site; its own "Global" monitor group, created only when the
//              user ticks it in the region step (it is a choice, not a freebie).
//   - <region> — region-specific anchors; one monitor group per selected region.
// Splitting regions into their own groups keeps region health independent, and
// keeps the shared anycast anchors out of every region (they live once, globally).
//
// HTTP anchors deliberately favor sites that are mostly locally hosted and NOT
// behind a global CDN, so the probe measures the real path into that region rather
// than a nearby CDN edge.
//
// No i18n here — `nameKey`/`labelKey` carry i18n keys the wizard resolves with the
// active locale before the target name (or monitor group name) is stored.

import type { ProbeParams, ProbeTarget } from '../api'

export type RegionID = 'cn' | 'hmt' | 'apac' | 'eu' | 'na' | 'sa' | 'me' | 'af'

// What the region step can carry. `global` is not a region — it is the universal
// anchor bucket offered as one more checkbox next to them, because a user who
// only cares about their own region should not be handed 1.1.1.1 / 8.8.8.8
// monitors they never asked for. `local` is deliberately NOT in here: LAN checks
// are region-independent and always created.
export type SelectionID = RegionID | 'global'

export type PresetKind = 'icmp' | 'http' | 'dns' | 'gateway' | 'nat'

// The monitor-group bucket a preset belongs to.
export type GroupKey = 'local' | SelectionID

// One recommended target. `key` is a stable id used for the checkbox model and
// must be unique across the whole selection.
export interface RegionPreset {
  key: string
  kind: PresetKind
  target: string
  nameKey: string
  params?: ProbeParams
  checked: boolean
  // Marks a secondary/failover endpoint (e.g. a DERP backup node). Off by default;
  // the wizard appends a "backup" suffix to its display/monitor name.
  backup?: boolean
}

export interface Region {
  id: RegionID
  labelKey: string
  presets: RegionPreset[]
}

// A bucket of presets that maps to a single monitor group.
export interface SelectionGroup {
  key: GroupKey
  nameKey: string
  presets: RegionPreset[]
}

function icmp(key: string, target: string, nameKey: string): RegionPreset {
  return { key, kind: 'icmp', target, nameKey, checked: true }
}

function http(key: string, target: string, nameKey: string): RegionPreset {
  return { key, kind: 'http', target, nameKey, checked: true }
}

// derp builds a city's pair of Tailscale DERP connectivity-check probes: the
// primary node (checked) and its backup node (off by default). Both are HTTPS
// /generate_204 endpoints (204 => reachable). Region-specific by actual node
// location — a good HTTP reachability anchor that is not behind a website CDN.
function derp(city: string, nameKey: string, primary: string, backup: string): RegionPreset[] {
  return [
    { key: `derp_${city}`, kind: 'http', target: `https://${primary}.tailscale.com/generate_204`, nameKey, checked: true },
    {
      key: `derp_${city}_b`,
      kind: 'http',
      target: `https://${backup}.tailscale.com/generate_204`,
      nameKey,
      checked: false,
      backup: true,
    },
  ]
}

// dnsPreset builds a DNS probe: resolve `query` via a region-appropriate resolver.
//
// `query` must NOT be a host that an HTTP preset in the same bucket already hits:
// a successful HTTP probe already proves the name resolved, so such a DNS probe is
// pure duplication (and doubles the noise when the host goes down). Point DNS
// probes at a host no HTTP preset covers. Enforced by a catalog-invariant test.
function dnsPreset(key: string, query: string, resolver: string, nameKey: string): RegionPreset {
  return { key, kind: 'dns', target: query, nameKey, params: { resolver_server: resolver }, checked: true }
}

// ---- local network bucket (region-independent) ----
const GATEWAY_PRESET: RegionPreset = {
  key: 'gateway',
  kind: 'gateway',
  target: 'gateway',
  nameKey: 'setup.preset_gateway',
  checked: true,
}

const NAT_STUN_CN = 'stun.miwifi.com'
const NAT_STUN_GLOBAL = 'stun.hot-chilli.net'

// STUN servers offered for NAT detection. stun.miwifi.com is mainland-China only,
// so it must not be the default for users outside the mainland; the wizard lets the
// user pick from this list and defaults it by region (see natPresetFor). Mirrors
// the list in MonitorForm.
export const STUN_SERVERS = [
  'stun.hot-chilli.net',
  'stun.fitauto.ru',
  'stun.internetcalls.com',
  'stun.voip.aebc.com',
  'stun.voipbuster.com',
  'stun.voipstunt.com',
  'stun.miwifi.com',
] as const

// defaultStunServer picks a STUN server the user's network can actually reach: the
// mainland-China server only when cn is among the chosen regions, else a global one
// (stun.miwifi.com is unreachable outside the mainland).
export function defaultStunServer(ids: readonly SelectionID[]): string {
  return ids.includes('cn') ? NAT_STUN_CN : NAT_STUN_GLOBAL
}

// natPresetFor builds the NAT preset with a region-appropriate default STUN server.
export function natPresetFor(ids: readonly SelectionID[]): RegionPreset {
  return { key: 'nat', kind: 'nat', target: defaultStunServer(ids), nameKey: 'setup.preset_nat', checked: true }
}

// ---- global bucket (universal anycast anchors + a global site) ----
const GLOBAL_PRESETS: readonly RegionPreset[] = [
  icmp('cf_dns', '1.1.1.1', 'setup.preset_cf_dns'),
  icmp('google_dns', '8.8.8.8', 'setup.preset_google_dns'),
  http('global_gstatic', 'http://www.gstatic.com/generate_204', 'setup.preset_gstatic'),
]

// ---- region buckets (region-specific anchors only; no shared anycast IPs) ----
export const REGIONS: readonly Region[] = [
  {
    id: 'cn',
    labelKey: 'setup.region_cn',
    presets: [
      icmp('cn_ali_dns', '223.5.5.5', 'setup.preset_ali_dns'),
      icmp('cn_dnspod', '119.29.29.29', 'setup.preset_dnspod'),
      http('cn_miui', 'http://connect.rom.miui.com/generate_204', 'setup.preset_miui'),
      http('cn_hicloud', 'http://connectivitycheck.platform.hicloud.com/generate_204', 'setup.preset_hicloud'),
    ],
  },
  {
    id: 'hmt',
    labelKey: 'setup.region_hmt',
    presets: [
      icmp('hmt_hinet', '168.95.1.1', 'setup.preset_hinet_dns'),
      ...derp('hk', 'setup.preset_derp_hk', 'derp20b', 'derp20c'),
      dnsPreset('hmt_dns', 'www.pchome.com.tw', '168.95.1.1', 'setup.preset_hmt_dns'),
    ],
  },
  {
    id: 'apac',
    labelKey: 'setup.region_apac',
    presets: [
      ...derp('singapore', 'setup.preset_derp_singapore', 'derp3e', 'derp3f'),
      ...derp('tokyo', 'setup.preset_derp_tokyo', 'derp7e', 'derp7f'),
      ...derp('sydney', 'setup.preset_derp_sydney', 'derp5e', 'derp5f'),
      dnsPreset('apac_dns', 'www.yahoo.co.jp', '1.1.1.1', 'setup.preset_apac_dns'),
    ],
  },
  {
    id: 'eu',
    labelKey: 'setup.region_eu',
    presets: [
      icmp('eu_quad9', '9.9.9.9', 'setup.preset_quad9'),
      ...derp('frankfurt', 'setup.preset_derp_frankfurt', 'derp4f', 'derp4g'),
      ...derp('london', 'setup.preset_derp_london', 'derp8e', 'derp8f'),
      ...derp('amsterdam', 'setup.preset_derp_amsterdam', 'derp14b', 'derp14c'),
      dnsPreset('eu_dns', 'www.heise.de', '9.9.9.9', 'setup.preset_eu_dns'),
    ],
  },
  {
    id: 'na',
    labelKey: 'setup.region_na',
    presets: [
      ...derp('newyork', 'setup.preset_derp_newyork', 'derp1f', 'derp1g'),
      ...derp('losangeles', 'setup.preset_derp_losangeles', 'derp17b', 'derp17c'),
      ...derp('toronto', 'setup.preset_derp_toronto', 'derp21b', 'derp21c'),
      dnsPreset('na_dns', 'www.craigslist.org', '8.8.8.8', 'setup.preset_na_dns'),
    ],
  },
  {
    id: 'sa',
    labelKey: 'setup.region_sa',
    presets: [
      ...derp('saopaulo', 'setup.preset_derp_saopaulo', 'derp11e', 'derp11f'),
      dnsPreset('sa_dns', 'www.uol.com.br', '1.1.1.1', 'setup.preset_sa_dns'),
    ],
  },
  {
    id: 'me',
    labelKey: 'setup.region_me',
    presets: [
      ...derp('dubai', 'setup.preset_derp_dubai', 'derp23b', 'derp23c'),
      dnsPreset('me_dns', 'www.etisalat.ae', '8.8.8.8', 'setup.preset_me_dns'),
    ],
  },
  {
    id: 'af',
    labelKey: 'setup.region_af',
    presets: [
      ...derp('johannesburg', 'setup.preset_derp_johannesburg', 'derp15b', 'derp15c'),
      ...derp('nairobi', 'setup.preset_derp_nairobi', 'derp25b', 'derp25c'),
      dnsPreset('af_dns', 'www.telkom.co.za', '8.8.8.8', 'setup.preset_af_dns'),
    ],
  },
]

const REGION_IDS = new Set<string>(REGIONS.map((r) => r.id))

// The one non-region choice in the region step. Shaped like a Region's identity
// half so the chooser can render it from the same template; it carries no presets
// of its own because its bucket is assembled by buildSelection.
export const GLOBAL_OPTION: { id: SelectionID; labelKey: string } = {
  id: 'global',
  labelKey: 'setup.group_global',
}

export function isRegionID(id: string): id is RegionID {
  return REGION_IDS.has(id)
}

// isSelectionID accepts everything the region step can persist — the regions plus
// `global`. Used when restoring a saved selection, where anything else (an id from
// a newer catalog) is dropped.
export function isSelectionID(id: string): id is SelectionID {
  return id === 'global' || REGION_IDS.has(id)
}

export function regionByID(id: string): Region | undefined {
  return REGIONS.find((r) => r.id === id)
}

// buildSelection returns the monitor-group buckets the wizard will create: the
// local network group, the global anchors group when it was chosen, and one group
// per chosen region (in catalog order). Buckets never share a target by
// construction, so there is no cross-bucket de-duplication to do.
export function buildSelection(ids: readonly SelectionID[]): SelectionGroup[] {
  const out: SelectionGroup[] = [
    { key: 'local', nameKey: 'setup.group_local', presets: [GATEWAY_PRESET, natPresetFor(ids)] },
  ]
  if (ids.includes('global')) {
    out.push({ key: 'global', nameKey: 'setup.group_global', presets: [...GLOBAL_PRESETS] })
  }
  for (const region of REGIONS) {
    if (ids.includes(region.id)) {
      out.push({ key: region.id, nameKey: region.labelKey, presets: region.presets })
    }
  }
  return out
}

// A dedupe key: same probe kind + same target is the same monitor. gateway/nat
// match on kind alone (a network needs only one of each).
function dedupeKey(kind: string, target: string): string {
  if (kind === 'gateway' || kind === 'nat') return kind
  return `${kind} ${target.trim()}`
}

// presetExists reports whether an equivalent target already exists on the site
// (in any monitor group), so the wizard can disable it and avoid creating a
// duplicate. Matches the same kind+target (gateway/nat match on kind alone).
export function presetExists(existing: readonly ProbeTarget[], p: RegionPreset): boolean {
  const key = dedupeKey(p.kind, p.target)
  return existing.some((t) => dedupeKey(t.kind, t.target) === key)
}

// presetToTarget materializes a preset into a ProbeTarget for the given monitor
// group, with the display name already resolved to the active locale.
export function presetToTarget(p: RegionPreset, groupId: string, name: string): ProbeTarget {
  return {
    group_id: groupId,
    kind: p.kind,
    name,
    target: p.target,
    params: p.params ?? {},
    enabled: true,
  }
}

// Middle-Eastern IANA zones checked before the generic Asia/* fallthrough.
const ME_ZONES = new Set<string>([
  'Asia/Dubai',
  'Asia/Riyadh',
  'Asia/Qatar',
  'Asia/Kuwait',
  'Asia/Bahrain',
  'Asia/Baghdad',
  'Asia/Amman',
  'Asia/Beirut',
  'Asia/Jerusalem',
  'Asia/Tehran',
  'Asia/Muscat',
  'Asia/Aden',
  'Asia/Damascus',
])

const CN_ZONES = new Set<string>(['Asia/Shanghai', 'Asia/Urumqi', 'Asia/Chongqing', 'Asia/Harbin'])
const HMT_ZONES = new Set<string>(['Asia/Hong_Kong', 'Asia/Macau', 'Asia/Taipei'])

// South-American zones checked before the generic America/* → na fallthrough.
// Argentina is matched by the America/Argentina/ prefix in detectRegion; the rest
// of the continent has no shared prefix, so every populated zone is listed to keep
// SA users off the North-American default.
const SA_ZONES = new Set<string>([
  // Brazil
  'America/Sao_Paulo',
  'America/Manaus',
  'America/Fortaleza',
  'America/Recife',
  'America/Belem',
  'America/Bahia',
  'America/Campo_Grande',
  'America/Cuiaba',
  'America/Porto_Velho',
  'America/Boa_Vista',
  'America/Rio_Branco',
  'America/Maceio',
  'America/Araguaina',
  'America/Santarem',
  'America/Eirunepe',
  'America/Noronha',
  // Rest of the continent
  'America/Bogota',
  'America/Lima',
  'America/Santiago',
  'America/Punta_Arenas',
  'America/Caracas',
  'America/Montevideo',
  'America/La_Paz',
  'America/Asuncion',
  'America/Guayaquil',
  'America/Guyana',
  'America/Paramaribo',
  'America/Cayenne',
])

// detectRegion guesses a single recommended region from the browser timezone
// (falling back to language). Returns null when no specific region matches — the
// local checks are created regardless, so a null just means "no region
// pre-selected". Used only to seed the UI (pin + pre-check the suggestion).
export function detectRegion(): RegionID | null {
  let tz = ''
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''
  } catch {
    tz = ''
  }
  if (tz) {
    if (CN_ZONES.has(tz)) return 'cn'
    if (HMT_ZONES.has(tz)) return 'hmt'
    if (ME_ZONES.has(tz)) return 'me'
    if (tz.startsWith('Asia/') || tz.startsWith('Australia/') || tz.startsWith('Pacific/')) return 'apac'
    if (tz.startsWith('Europe/')) return 'eu'
    if (tz.startsWith('Africa/')) return 'af'
    if (SA_ZONES.has(tz) || tz.startsWith('America/Argentina/')) return 'sa'
    if (tz.startsWith('America/')) return 'na'
  }
  const lang = typeof navigator !== 'undefined' ? navigator.language || '' : ''
  if (lang.toLowerCase().startsWith('zh')) return 'cn'
  return null
}

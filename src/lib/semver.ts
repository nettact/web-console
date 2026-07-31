// Version comparison for the release versions the server reports. It is a port of
// `Newer` in server-core/updatecheck/updatecheck.go, so both ends agree on what
// counts as "newer": a leading `v` is stripped, the numeric parts split on `.`
// and compare left to right (the shorter form padding with zeros), and a
// pre-release suffix after `-` loses to the plain release of the same numbers.
// Two pre-releases compare lexically.
//
// DIVERGENCE FROM THE GO VERSION: Go's `Newer` treats an unparsable *current*
// version as the oldest possible, so an unstamped local build ("dev", "") sees
// every release as an update — right for the server's own "should I tell someone
// to upgrade" decision. Here the comparison drives a per-row icon in the agent
// table, where the same rule would flag every agent that reports "" or "dev" as
// outdated. That is noise, not signal, so this returns true only when BOTH sides
// parse; anything unparsable is simply not flagged.

interface Semver {
  nums: number[]
  pre: string
}

// parse returns null for anything that is not a dotted run of non-negative
// integers (with an optional `v` prefix and `-suffix` pre-release tag).
function parse(v: string): Semver | null {
  let s = v.trim()
  if (s.startsWith('v')) s = s.slice(1)
  let pre = ''
  const dash = s.indexOf('-')
  if (dash >= 0) {
    pre = s.slice(dash + 1)
    s = s.slice(0, dash)
  }
  if (s === '') return null
  const nums: number[] = []
  for (const part of s.split('.')) {
    // Number() would accept '1e3', '0x2' and ' ' — require plain digits.
    if (!/^\d+$/.test(part)) return null
    nums.push(Number(part))
  }
  return { nums, pre }
}

// updateAvailable reports whether `latest` is a newer version than `current`.
// It is false whenever either side cannot be parsed (see the note above).
export function updateAvailable(latest: string, current: string): boolean {
  const cur = parse(current)
  if (!cur) return false
  const lat = parse(latest)
  if (!lat) return false

  const n = Math.max(lat.nums.length, cur.nums.length)
  for (let i = 0; i < n; i++) {
    const l = lat.nums[i] ?? 0
    const c = cur.nums[i] ?? 0
    if (l !== c) return l > c
  }
  // Equal numeric parts: a release beats a pre-release; between two pre-releases
  // compare the suffixes lexically.
  if (lat.pre === cur.pre) return false
  if (lat.pre === '') return true
  if (cur.pre === '') return false
  return lat.pre > cur.pre
}

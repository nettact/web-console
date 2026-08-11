// Hash routing, by hand.
//
// The app has exactly one route parameter — which page to show — so a router
// library would be a dependency for a single string. Hash routing (not history)
// is the deliberate part: it means a deployer can drop the built directory onto
// any static host, including ones with no rewrite rules, and deep links still
// resolve without the host serving index.html for unknown paths.

/**
 * Extracts the page slug from a location hash. Accepts '#/slug', '#slug' and a
 * trailing slash, and returns '' for an empty or malformed hash (which renders
 * the "no page selected" view rather than a failed request).
 */
export function slugFromHash(hash: string): string {
  const raw = hash.replace(/^#\/?/, '').split(/[?#]/)[0].replace(/\/+$/, '')
  if (!raw) return ''
  try {
    return decodeURIComponent(raw).trim()
  } catch {
    // A malformed percent-escape is not a slug; treat it as no selection.
    return ''
  }
}

/**
 * The page to render for a hash, falling back to the deployment's configured
 * default (config.defaultSlug) when the hash addresses none.
 *
 * Kept here rather than inlined at the two call sites because both of them — the
 * initial render and every hashchange — must agree: a fallback applied only on
 * load would strand a reader who navigated back to '#' on the empty state, on a
 * deployment whose whole point is that '/' shows a board.
 */
export function resolveSlug(hash: string, fallback: string): string {
  return slugFromHash(hash) || fallback
}

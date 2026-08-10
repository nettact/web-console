// The public address of a status page, as the console shows and copies it.
//
// This is the URL of the status app the SERVER hosts, at /status/. A deployer who
// copies dist/status/ onto a different host (a bucket, a CDN, another domain)
// serves the same page from their own origin instead — the console cannot know
// that address, so the UI labels this one as the server-hosted link rather than
// promising it is the only one.
//
// Hash routing (#/slug) is what makes the page work on a dumb static host with no
// rewrite rules, and it is why the slug lives after the '#' rather than in the
// path.
export function publicStatusUrl(base: string, slug: string): string {
  const origin = base.trim().replace(/\/+$/, '')
  return `${origin}/status/#/${slug}`
}

// A suggested slug for a new page.
//
// Deliberately NOT derived from the title: titles here are routinely Chinese, and
// slugifying one yields either an empty string or a transliteration nobody
// recognizes. A short random suffix is honest about being an address rather than
// a name, and it never collides with an existing page on the first try.
export function suggestStatusSlug(random: () => number = Math.random): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let out = ''
  for (let i = 0; i < 6; i++) out += alphabet[Math.floor(random() * alphabet.length)]
  return `status-${out}`
}

// Mirrors statuspage.SlugPattern server-side: 1–64 chars, lowercase alphanumerics
// with interior dashes. Kept in sync by hand, like the rest of api.ts.
export const STATUS_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import {
  NotFoundError,
  api,
  type PublicAgentRow,
  type PublicPage,
  type PublicTargetRow,
} from './api'
import { slugFromHash } from './route'
import { theme, toggleTheme } from './theme'
import { setLocale, toDateLocale } from './i18n'
import {
  STATUS_TONE,
  agentRowLabel,
  formatAvailability,
  kindLabel,
  relativeUpdated,
  targetRowLabel,
} from './labels'

// The public page polls rather than subscribing. SSE is console-only (it is
// session-authenticated and pushes far more than a status page may see), and an
// anonymous page with an unknown number of viewers is exactly where a cheap
// fixed-interval poll beats a connection per reader.
const POLL_MS = 30_000
// Drives the relative "updated Ns ago" line, which would otherwise sit still
// between polls and make a live page look frozen.
const TICK_MS = 5_000

const { t, locale } = useI18n()

const slug = ref(slugFromHash(location.hash))
const page = ref<PublicPage | null>(null)
const agents = ref<PublicAgentRow[] | null>(null)
const targets = ref<PublicTargetRow[] | null>(null)
const generatedAt = ref('')
const loading = ref(true)
const notFound = ref(false)
/** A failed refresh keeps the last good board on screen and says so, rather than
 *  blanking a page that was fine two seconds ago. */
const stale = ref(false)
const now = ref(Date.now())

let pollTimer: number | undefined
let tickTimer: number | undefined
// Navigation generation. Bumped ONLY when the addressed page changes, never by a
// poll: a counter that every tick advanced would invalidate any load still in
// flight when the next tick arrived, so on a slow link nothing would ever paint.
let navGeneration = 0
// Loads currently in flight. A poll skips while one is running rather than
// stacking another on top of it.
let running = 0

const onlineAgents = computed(() => (agents.value ?? []).filter((a) => a.online).length)
const upTargets = computed(() => (targets.value ?? []).filter((tg) => tg.status === 'up').length)
const updatedLabel = computed(() => (generatedAt.value ? relativeUpdated(generatedAt.value, now.value, t) : ''))

function sinceLabel(iso: string | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return t('agents.since', { time: d.toLocaleString(toDateLocale(locale.value)) })
}

/**
 * Loads everything the page shows, metadata included — every time, not only on
 * first paint.
 *
 * Re-reading the metadata on every poll is what keeps a long-open tab honest.
 * The toggles decide which endpoints to call, so a cached copy of them goes
 * wrong in both directions: a view the operator has since enabled would never
 * appear, and a view they DISABLED would keep being requested, 404, and take the
 * whole board down as "page not found" while it is still perfectly published.
 *
 * A 'navigate' load is the user arriving at a page — it shows the loading state
 * and owns the board. A 'poll' load is a background refresh: it never blanks
 * what is on screen, and it yields to a load already in progress.
 */
async function load(kind: 'navigate' | 'poll'): Promise<void> {
  if (!slug.value) {
    loading.value = false
    return
  }
  if (kind === 'poll' && running > 0) return
  if (kind === 'navigate') {
    navGeneration++
    loading.value = true
  }
  const nav = navGeneration
  const wanted = slug.value
  // Every await below is a chance for the address to change under us. A load the
  // user has already navigated away from must write nothing.
  const current = () => nav === navGeneration && wanted === slug.value
  running++
  try {
    const meta = await api.page(wanted)
    // Only fetch the views this page publishes. The server enforces the same
    // toggles, so asking for a hidden one would 404 and mark the board stale.
    const [agentData, targetData] = await Promise.all([
      meta.show_agent_view ? api.agentStatuses(wanted) : Promise.resolve(null),
      meta.show_target_view ? api.targetStatuses(wanted) : Promise.resolve(null),
    ])
    if (!current()) return
    // Commit metadata and rows together. Applied separately, a refresh whose
    // metadata lands but whose rows fail would pair the new toggles with the old
    // (or absent) data — a freshly enabled view would render "publishes no
    // nodes", which is an assertion, not a loading state.
    page.value = meta
    notFound.value = false
    document.title = `${meta.title} · NetTact`
    agents.value = agentData?.agents ?? null
    targets.value = targetData?.targets ?? null
    generatedAt.value = targetData?.generated_at ?? agentData?.generated_at ?? meta.generated_at
    now.value = Date.now()
    stale.value = false
  } catch (err) {
    if (!current()) return
    if (err instanceof NotFoundError) {
      // A page unpublished while someone was watching becomes the not-found view,
      // exactly like a link that was never valid.
      notFound.value = true
      page.value = null
      agents.value = null
      targets.value = null
      return
    }
    // A failed refresh keeps the last good board on screen and says so; only a
    // failed arrival has nothing to keep.
    if (kind === 'navigate') page.value = null
    stale.value = true
  } finally {
    running--
    // `loading` means "nothing decided yet for this page", not "a request is in
    // flight" — re-raising it per poll would blink the not-found and error views
    // through the loading state every thirty seconds.
    if (current()) loading.value = false
  }
}

function onHashChange(): void {
  const next = slugFromHash(location.hash)
  if (next === slug.value) return
  slug.value = next
}

watch(slug, () => {
  page.value = null
  agents.value = null
  targets.value = null
  generatedAt.value = ''
  notFound.value = false
  void load('navigate')
})

onMounted(() => {
  void load('navigate')
  // Polls re-read the metadata too (see load), so a page that was unreachable on
  // first paint recovers by itself, and a toggle flipped in the console reaches
  // an already-open tab.
  pollTimer = window.setInterval(() => void load('poll'), POLL_MS)
  tickTimer = window.setInterval(() => (now.value = Date.now()), TICK_MS)
  window.addEventListener('hashchange', onHashChange)
})

onUnmounted(() => {
  window.clearInterval(pollTimer)
  window.clearInterval(tickTimer)
  window.removeEventListener('hashchange', onHashChange)
})
</script>

<template>
  <div class="page">
    <template v-if="page">
      <header class="head">
        <div>
          <h1>{{ page.title }}</h1>
          <p v-if="page.description">{{ page.description }}</p>
        </div>
        <div class="controls">
          <button
            type="button"
            class="control"
            :title="theme === 'dark' ? t('theme.toLight') : t('theme.toDark')"
            @click="toggleTheme"
          >
            {{ theme === 'dark' ? t('theme.toLight') : t('theme.toDark') }}
          </button>
          <button
            type="button"
            class="control"
            @click="setLocale(locale === 'zh' ? 'en' : 'zh')"
          >
            {{ t('lang.toggle') }}
          </button>
        </div>
      </header>

      <section v-if="page.show_agent_view" class="section">
        <div class="section-head">
          <h2>{{ t('agents.title') }}</h2>
          <span v-if="agents?.length" class="section-count">
            {{ t('agents.summary', { online: onlineAgents, total: agents.length }) }}
          </span>
        </div>
        <ul v-if="agents?.length" class="rows">
          <li v-for="(agent, i) in agents" :key="`agent-${i}`" class="row">
            <div class="row-main">
              <div class="row-name">{{ agentRowLabel(agent, t) }}</div>
              <div v-if="agent.status_since" class="row-sub">{{ sinceLabel(agent.status_since) }}</div>
            </div>
            <div class="row-side">
              <span class="badge" :class="agent.online ? 'badge-good' : 'badge-bad'">
                {{ agent.online ? t('agents.online') : t('agents.offline') }}
              </span>
            </div>
          </li>
        </ul>
        <p v-else class="empty">{{ t('agents.empty') }}</p>
      </section>

      <section v-if="page.show_target_view" class="section">
        <div class="section-head">
          <h2>{{ t('targets.title') }}</h2>
          <span v-if="targets?.length" class="section-count">
            {{ t('targets.summary', { up: upTargets, total: targets.length }) }}
          </span>
        </div>
        <ul v-if="targets?.length" class="rows">
          <li v-for="(target, i) in targets" :key="`target-${i}`" class="row">
            <div class="row-main">
              <div class="row-name">
                <!-- The chip is dropped for an unnamed target: its fallback label
                     already leads with the kind, and both would read "Ping Ping
                     target 1". -->
                <span v-if="target.name" class="chip">{{ kindLabel(target.kind, t) }}</span>
                {{ targetRowLabel(target, t) }}
              </div>
              <div v-if="target.address" class="row-sub"><code>{{ target.address }}</code></div>
            </div>
            <div class="row-side">
              <span class="avail">
                <template v-if="formatAvailability(target.availability_24h)">
                  {{ formatAvailability(target.availability_24h) }}
                </template>
                <template v-else>—</template>
                <small>{{ t('targets.availability') }}</small>
              </span>
              <span class="badge" :class="`badge-${STATUS_TONE[target.status]}`">
                {{ t(`targets.status.${target.status}`) }}
              </span>
            </div>
          </li>
        </ul>
        <p v-else class="empty">{{ t('targets.empty') }}</p>
      </section>

      <p class="meta">
        <span v-if="updatedLabel">{{ updatedLabel }}</span>
        <span v-if="stale" class="meta-warn">{{ t('stale') }}</span>
      </p>
    </template>

    <div v-else-if="loading" class="notice">
      <p>{{ t('loading') }}</p>
    </div>

    <div v-else-if="notFound" class="notice">
      <h1>{{ t('notFound.title') }}</h1>
      <p>{{ t('notFound.body') }}</p>
    </div>

    <div v-else-if="!slug" class="notice">
      <h1>{{ t('noSlug.title') }}</h1>
      <p>{{ t('noSlug.body') }}</p>
    </div>

    <div v-else class="notice">
      <h1>{{ t('error.title') }}</h1>
      <p>{{ t('error.body') }}</p>
    </div>

    <p class="foot">{{ t('poweredBy') }}</p>
  </div>
</template>

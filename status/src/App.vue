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
// Generation counter for in-flight loads. A hash change starts a new load while
// the previous one is still awaiting I/O, and without this the slower response
// wins: the board would end up showing one page's title and toggles over
// another page's rows.
let generation = 0

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
 * `initial` therefore controls presentation only — whether to show the loading
 * state, and whether a failure clears the board or merely marks it stale.
 */
async function load(initial: boolean): Promise<void> {
  if (!slug.value) {
    loading.value = false
    return
  }
  const mine = ++generation
  const wanted = slug.value
  // Every await below is a chance for the hash to change under us. A load that is
  // no longer the current one must write nothing.
  const current = () => mine === generation && wanted === slug.value
  try {
    const meta = await api.page(wanted)
    if (!current()) return
    page.value = meta
    notFound.value = false
    document.title = `${meta.title} · NetTact`

    // Only fetch the views this page publishes. The server enforces the same
    // toggles, so asking for a hidden one would 404 and mark the board stale.
    const [agentData, targetData] = await Promise.all([
      meta.show_agent_view ? api.agentStatuses(wanted) : Promise.resolve(null),
      meta.show_target_view ? api.targetStatuses(wanted) : Promise.resolve(null),
    ])
    if (!current()) return
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
    // failed FIRST load has nothing to keep.
    if (initial) page.value = null
    stale.value = true
  } finally {
    // `loading` means "nothing has been decided yet", not "a request is in
    // flight". Re-raising it per poll would make the not-found and error views
    // blink through the loading state every 30 seconds.
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
  void load(true)
})

onMounted(() => {
  void load(true)
  // Polls re-read the metadata too (see load), so a page that was unreachable on
  // first paint recovers by itself, and a toggle flipped in the console reaches
  // an already-open tab.
  pollTimer = window.setInterval(() => void load(page.value === null), POLL_MS)
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

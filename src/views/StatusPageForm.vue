<script setup lang="ts">
// Create/edit a public status page.
//
// This is the only form in the console whose output is readable by strangers, so
// it is built to make that fact impossible to miss: the public URL is shown live
// as the slug is typed, the two view toggles are labelled by what they publish,
// and revealing target addresses is an explicit opt-in that says what it exposes.
//
// Everything is visible at once — no collapsed advanced section. What a page
// publishes is the whole point of the form; hiding half of it behind a disclosure
// is how someone publishes more than they meant to.
import { computed, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import {
  api,
  ApiError,
  type AgentGroup,
  type ProbeTarget,
  type StatusPageAgentMetrics,
  type StatusPageInput,
  type StatusPage,
} from '../api'
import { consoleBase, ensureConsoleBase } from '../consoleBaseUrl'
import { copyToClipboard } from '../lib/clipboard'
import { STATUS_SLUG_RE, publicStatusUrl, suggestStatusSlug } from '../lib/statusPage'
import { targetLabel, typeLabel } from '../lib/targetLabels'
import { pushToast } from '../toasts'

const { t: tr } = useI18n()
const route = useRoute()
const router = useRouter()

const SITE = 'site_default'
const editingId = computed(() => (route.params.id as string) || '')

// Least-disclosing first, so the list reads as a ramp rather than a menu.
const AGENT_METRICS_OPTIONS: StatusPageAgentMetrics[] = ['off', 'basic', 'full']

const form = reactive<StatusPageInput>(blank())
const agentGroups = ref<AgentGroup[]>([])
const targets = ref<ProbeTarget[]>([])
// Every page in the site, read only so the form can name whichever one currently
// holds the home flag.
const allPages = ref<StatusPage[]>([])
const error = ref('')
const busy = ref(false)
const saved = ref(false)
const notFound = ref(false)
const loaded = ref(false)
const copied = ref(false)

function blank(): StatusPageInput {
  return {
    slug: '',
    title: '',
    description: '',
    enabled: true,
    show_target_address: false,
    show_agent_view: true,
    show_target_view: true,
    show_incidents: false,
    agent_metrics: 'basic',
    is_home: false,
    agent_group_ids: [],
    target_ids: [],
  }
}

const publicUrl = computed(() =>
  form.slug ? publicStatusUrl(consoleBase.url, form.slug) : '',
)

// The page that holds the home flag today, excluding the one being edited.
// Saving with "set as home page" on takes the flag from it, so the form says so
// before the save rather than leaving it to be discovered afterwards.
const currentHome = computed(() =>
  allPages.value.find((p) => p.is_home && p.id !== editingId.value) ?? null,
)

function toggle(list: string[], id: string) {
  const i = list.indexOf(id)
  if (i === -1) list.push(id)
  else list.splice(i, 1)
}

async function copyUrl() {
  if (!publicUrl.value) return
  if (await copyToClipboard(publicUrl.value)) {
    copied.value = true
    window.setTimeout(() => (copied.value = false), 1600)
  } else {
    pushToast({ tone: 'warn', title: tr('statusPages.copyFailed') })
  }
}

async function load() {
  // The pickers are the form's substance, so a failure to load them is a real
  // error rather than something to degrade past.
  try {
    ;[agentGroups.value, targets.value, allPages.value] = await Promise.all([
      api.agentGroups(SITE),
      api.listTargets(SITE),
      // Needed only to name the page that is about to lose the home flag. A
      // failure here is not worth blocking the form over — the toggle still
      // works, it just says less.
      api.statusPages().catch(() => [] as StatusPage[]),
    ])
  } catch (e) {
    error.value = String((e as Error).message || e)
    return
  }
  if (!editingId.value) {
    form.slug = suggestStatusSlug()
    loaded.value = true
    return
  }
  try {
    const page = await api.statusPage(editingId.value)
    form.slug = page.slug
    form.title = page.title
    form.description = page.description
    form.enabled = page.enabled
    form.show_target_address = page.show_target_address
    form.show_agent_view = page.show_agent_view
    form.show_target_view = page.show_target_view
    form.show_incidents = page.show_incidents
    form.agent_metrics = page.agent_metrics
    form.is_home = page.is_home
    form.agent_group_ids = [...page.agent_group_ids]
    form.target_ids = [...page.target_ids]
    loaded.value = true
  } catch (e) {
    // Only a real 404 means the page is gone. A network blip or a 500 answered
    // with "No such status page" would tell the operator their configuration had
    // been deleted, which is both false and unrecoverable-looking — those stay
    // ordinary load errors they can retry.
    if (e instanceof ApiError && e.status === 404) {
      notFound.value = true
      return
    }
    error.value = String((e as Error).message || e)
  }
}

// Mirrors statuspage.Spec.Validate server-side, so a value the server would reject
// is reported next to the field instead of after a round trip.
function validationError(): string {
  if (!form.title.trim()) return tr('spform.errTitle')
  if (!STATUS_SLUG_RE.test(form.slug)) return tr('spform.errSlug')
  if (!form.show_agent_view && !form.show_target_view && !form.show_incidents) return tr('spform.errNoView')
  return ''
}

function payload(): StatusPageInput {
  return {
    ...form,
    slug: form.slug.trim(),
    title: form.title.trim(),
    description: form.description.trim(),
    agent_group_ids: [...form.agent_group_ids],
    target_ids: [...form.target_ids],
  }
}

async function save() {
  const verr = validationError()
  if (verr) {
    error.value = verr
    return
  }
  busy.value = true
  error.value = ''
  saved.value = false
  try {
    if (editingId.value) {
      await api.updateStatusPage(editingId.value, payload())
    } else {
      await api.createStatusPage(payload())
    }
    saved.value = true
    pushToast({ tone: 'info', title: tr('spform.saved', { name: form.title.trim() }) })
    router.push('/status-pages')
  } catch (e) {
    error.value = String((e as Error).message || e)
  } finally {
    busy.value = false
  }
}

onMounted(async () => {
  ensureConsoleBase()
  await load()
})
</script>

<template>
  <main class="page config-page" aria-labelledby="status-page-form-title">
    <div class="page-head config-head">
      <h2 id="status-page-form-title">
        {{ editingId ? tr('spform.editTitle') : tr('spform.newTitle') }}
      </h2>
      <p class="sub">{{ tr('spform.sub') }}</p>
    </div>
    <p v-if="error" class="err" role="alert">{{ error }}</p>

    <p v-if="notFound" class="hint">
      {{ tr('spform.notFound') }}
      <router-link to="/status-pages">{{ tr('spform.back') }}</router-link>
    </p>

    <form v-else class="config-workflow" @submit.prevent="save">
      <div class="form-layout">
        <section class="panel details-panel" aria-labelledby="status-page-general-title">
          <div class="panel-head">
            <h3 id="status-page-general-title">{{ tr('spform.secGeneral') }}</h3>
          </div>
          <div class="pbody details-body">
            <div class="identity-grid">
              <label class="field field-title">
                <span>{{ tr('spform.title') }}</span>
                <input
                  v-model="form.title"
                  maxlength="128"
                  size="40"
                  :placeholder="tr('spform.titlePlaceholder')"
                />
              </label>
              <label class="field field-slug">
                <span>{{ tr('spform.slug') }}</span>
                <input
                  v-model="form.slug"
                  maxlength="64"
                  size="32"
                  spellcheck="false"
                  autocapitalize="off"
                  aria-describedby="status-page-slug-hint"
                />
                <small id="status-page-slug-hint" class="hint tiny">{{ tr('spform.slugHint') }}</small>
              </label>
            </div>

            <div v-if="publicUrl" class="url-preview">
              <span class="url-label">{{ tr('spform.publicUrl') }}</span>
              <code class="mono">{{ publicUrl }}</code>
              <button type="button" class="link-btn" @click="copyUrl">
                {{ copied ? tr('statusPages.copied') : tr('statusPages.copy') }}
              </button>
              <!-- The console only knows the address IT is reachable at. A copy of
                   the status app hosted elsewhere serves the same page from its own
                   origin, so this is "the link this server serves", not "the link". -->
              <p class="hint tiny">{{ tr('spform.urlHint') }}</p>
              <p class="hint tiny">
                {{ tr('statusPages.domainHint') }}
                <a :href="tr('docs.statusPageDomainUrl')" target="_blank" rel="noopener noreferrer">
                  {{ tr('statusPages.domainLink') }}
                </a>
              </p>
            </div>

            <label class="field field-description">
              <span>{{ tr('spform.description') }}</span>
              <textarea
                v-model="form.description"
                maxlength="1024"
                rows="4"
                :placeholder="tr('spform.descriptionPlaceholder')"
                aria-describedby="status-page-description-hint"
              ></textarea>
              <small id="status-page-description-hint" class="hint tiny">{{ tr('spform.descriptionHint') }}</small>
            </label>
          </div>
        </section>

        <aside class="panel publication-panel" aria-labelledby="status-page-publication-title">
          <div class="panel-head">
            <h3 id="status-page-publication-title">{{ tr('spform.secPublication') }}</h3>
          </div>
          <div class="pbody publication-body">
            <label class="toggle-row">
              <span class="toggle-copy">
                <strong>{{ tr('spform.enabled') }}</strong>
                <small>
                  {{ form.enabled ? tr('spform.enabledOnHint') : tr('spform.enabledOffHint') }}
                </small>
              </span>
              <input type="checkbox" v-model="form.enabled" />
            </label>
            <label class="toggle-row">
              <span class="toggle-copy">
                <strong>{{ tr('spform.showIncidents') }}</strong>
                <small>
                  {{ form.show_incidents ? tr('spform.incidentsOnHint') : tr('spform.incidentsOffHint') }}
                </small>
              </span>
              <input type="checkbox" v-model="form.show_incidents" />
            </label>
            <label class="toggle-row">
              <span class="toggle-copy">
                <strong>{{ tr('spform.setHome') }}</strong>
                <small>
                  {{ form.is_home ? tr('spform.setHomeOnHint') : tr('spform.setHomeOffHint') }}
                </small>
              </span>
              <input type="checkbox" v-model="form.is_home" />
            </label>
            <!-- Both consequences of the toggle are stated before the save, not
                 after: which page loses the flag, and that an unpublished page
                 cannot serve as one. -->
            <p v-if="form.is_home && currentHome" class="hint tiny home-note warn">
              {{ tr('spform.homeTakeover', { name: currentHome.title }) }}
            </p>
            <p v-if="form.is_home && !form.enabled" class="hint tiny home-note warn">
              {{ tr('spform.homeNeedsPublished') }}
            </p>
            <p v-if="form.is_home" class="hint tiny home-note">
              {{ tr('spform.homeVsDomain') }}
              <a :href="tr('docs.statusPageDomainUrl')" target="_blank" rel="noopener noreferrer">
                {{ tr('statusPages.domainLink') }}
              </a>
            </p>
          </div>
        </aside>
      </div>

      <div class="selection-grid">
        <section class="panel content-panel" aria-labelledby="status-page-agents-title">
          <div class="panel-head content-head">
            <h3 id="status-page-agents-title">{{ tr('spform.secAgents') }}</h3>
            <label class="view-toggle">
              <input type="checkbox" v-model="form.show_agent_view" />
              <span>{{ tr('spform.showAgentView') }}</span>
            </label>
            <p class="hint tiny content-description">{{ tr('spform.agentsHint') }}</p>
          </div>
          <div v-if="form.show_agent_view" class="pbody content-body">
            <div class="selection-main">
              <p v-if="!agentGroups.length" class="hint tiny empty-selection">
                {{ tr('spform.noAgentGroups') }}
                <!-- ?tab=groups, not bare /agents: that view opens on the status
                     list and only shows group management when the query asks. -->
                <router-link to="/agents?tab=groups">{{ tr('spform.manageAgentGroups') }}</router-link>
              </p>
              <div v-else class="selection-list">
                <label v-for="g in agentGroups" :key="g.id" class="selection-item">
                  <input
                    type="checkbox"
                    :checked="form.agent_group_ids.includes(g.id)"
                    @change="toggle(form.agent_group_ids, g.id)"
                  />
                  <span>{{ g.name }}</span>
                  <em>{{ tr('spform.groupMembers', { n: g.agent_ids.length }) }}</em>
                </label>
              </div>
              <!-- An empty selection is legal (the page simply shows no nodes), but
                   it is almost always an oversight. -->
              <p v-if="agentGroups.length && !form.agent_group_ids.length" class="hint tiny warn selection-warning">
                {{ tr('spform.noAgentsPicked') }}
              </p>
            </div>

            <!-- Presets rather than a field list: the operator is choosing how
                 much a stranger learns about their machines, and "percentages
                 only" answers that where a set of checkboxes would not. -->
            <fieldset class="privacy-option metrics-option">
              <legend class="toggle-copy"><strong>{{ tr('spform.agentMetrics') }}</strong></legend>
              <label v-for="opt in AGENT_METRICS_OPTIONS" :key="opt" class="metrics-choice">
                <input type="radio" :value="opt" v-model="form.agent_metrics" />
                <span class="toggle-copy">
                  <strong>{{ tr(`spform.agentMetricsOpt.${opt}`) }}</strong>
                  <small :class="{ warn: opt === 'full' && form.agent_metrics === 'full' }">
                    {{ tr(`spform.agentMetricsHint.${opt}`) }}
                  </small>
                </span>
              </label>
            </fieldset>
          </div>
        </section>

        <section class="panel content-panel" aria-labelledby="status-page-targets-title">
          <div class="panel-head content-head">
            <h3 id="status-page-targets-title">{{ tr('spform.secTargets') }}</h3>
            <label class="view-toggle">
              <input type="checkbox" v-model="form.show_target_view" />
              <span>{{ tr('spform.showTargetView') }}</span>
            </label>
            <p class="hint tiny content-description">{{ tr('spform.targetsHint') }}</p>
          </div>
          <div v-if="form.show_target_view" class="pbody content-body">
            <div class="selection-main">
              <p v-if="!targets.length" class="hint tiny empty-selection">{{ tr('spform.noTargets') }}</p>
              <div v-else class="selection-list target-list">
                <label v-for="t in targets" :key="t.id" class="selection-item">
                  <input
                    type="checkbox"
                    :checked="!!t.id && form.target_ids.includes(t.id)"
                    @change="t.id && toggle(form.target_ids, t.id)"
                  />
                  <span>{{ t.name || targetLabel(t, tr) }}</span>
                  <em>{{ typeLabel(t, tr) }}</em>
                </label>
              </div>
              <p v-if="targets.length && !form.target_ids.length" class="hint tiny warn selection-warning">
                {{ tr('spform.noTargetsPicked') }}
              </p>
            </div>

            <label class="toggle-row privacy-option">
              <span class="toggle-copy">
                <strong>{{ tr('spform.showTargetAddress') }}</strong>
                <small :class="{ warn: form.show_target_address }">
                  {{
                    form.show_target_address
                      ? tr('spform.addressOnHint')
                      : tr('spform.addressOffHint')
                  }}
                </small>
              </span>
              <input type="checkbox" v-model="form.show_target_address" />
            </label>
          </div>
        </section>
      </div>

      <div class="form-foot">
        <span v-if="saved" class="ok" role="status" aria-live="polite">{{ tr('spform.savedShort') }}</span>
        <router-link to="/status-pages" class="btn">{{ tr('spform.cancel') }}</router-link>
        <button type="submit" class="btn btn-primary" :disabled="busy || !loaded">
          {{ busy ? tr('spform.saving') : editingId ? tr('spform.save') : tr('spform.create') }}
        </button>
      </div>
    </form>
  </main>
</template>

<style scoped>
/* Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V4
 * Hallmark · genre: custom application system · macrostructure: Narrative Workflow
 * design-system: design.md · designed-as-app · page: Status page form
 */
.config-head h2 {
  font-family: var(--font-display);
  letter-spacing: -0.028em;
}
.config-page {
  max-width: none;
  margin-inline: 0;
}
.config-workflow {
  display: grid;
  gap: var(--space-md);
  width: 100%;
}
.form-layout,
.selection-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-md);
  align-items: start;
}
.details-panel,
.publication-panel,
.content-panel {
  margin: 0;
}
.pbody {
  padding: var(--space-md);
}
.details-body {
  display: grid;
  gap: var(--space-md);
}
.identity-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-sm) var(--space-md);
}
.field {
  display: grid;
  align-content: start;
  gap: var(--space-2xs);
  min-width: 0;
}
.field > span,
.url-label {
  color: var(--color-ink-2);
  font-size: var(--text-sm);
  font-weight: 600;
}
.field input,
.field textarea {
  width: 100%;
}
.field-title {
  max-width: 42rem;
}
.field-slug {
  max-width: 30rem;
}
.field-description {
  max-width: 64rem;
}
.field-description textarea {
  min-height: 8rem;
}
.url-preview {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--space-2xs) var(--space-sm);
  padding-block: var(--space-sm);
  border-block: var(--rule-hair) solid var(--color-rule);
  overflow-wrap: anywhere;
}
.url-label,
.url-preview .hint {
  grid-column: 1 / -1;
}
.url-preview code {
  min-width: 0;
  color: var(--color-ink);
  overflow-wrap: anywhere;
}
.url-preview .hint,
.content-head .hint,
.toggle-copy small,
.selection-warning,
.empty-selection {
  margin: 0;
}
.publication-body {
  padding-block: var(--space-sm);
}
.publication-body .toggle-row + .toggle-row {
  margin-top: var(--space-xs);
  padding-top: var(--space-xs);
  border-top: var(--rule-hair) solid var(--color-rule);
}
/* Consequences of the home toggle, shown under it rather than as a separate row:
   they belong to that control, not to the panel. */
.home-note {
  margin: var(--space-2xs) 0 0;
}
.home-note.warn {
  color: var(--color-warning-text);
}
.toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
  min-height: 2.75rem;
  cursor: pointer;
}
.toggle-copy {
  display: grid;
  gap: var(--space-3xs);
  min-width: 0;
}
.toggle-copy strong {
  color: var(--color-ink);
  font-size: var(--text-sm);
}
.toggle-copy small {
  max-width: 42ch;
  color: var(--color-muted);
  line-height: 1.5;
}
.toggle-row > input,
.view-toggle > input,
.selection-item > input {
  flex: 0 0 auto;
}
.content-head {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: flex-start;
  gap: var(--space-2xs) var(--space-md);
}
.content-head h3 {
  align-self: center;
}
.content-description {
  grid-column: 1 / -1;
  max-width: 72ch;
  line-height: 1.5;
}
.view-toggle {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2xs);
  min-height: 2.75rem;
  flex: 0 0 auto;
  color: var(--color-ink);
  font-size: var(--text-sm);
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
}
.content-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  padding: 0;
}
.selection-main {
  min-width: 0;
  padding: 0 var(--space-md);
}
.selection-list {
  width: 100%;
}
.selection-item {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--space-xs);
  min-height: 2.75rem;
  padding: var(--space-2xs) var(--space-xs);
  border-bottom: var(--rule-hair) solid var(--color-rule);
  color: var(--color-ink);
  cursor: pointer;
}
.selection-item:last-child {
  border-bottom: 0;
}
.selection-item span {
  min-width: 0;
  overflow-wrap: anywhere;
}
.selection-item em {
  color: var(--color-muted);
  font-size: var(--text-xs);
  font-style: normal;
  white-space: nowrap;
}
.selection-item:has(input:checked) {
  background: var(--color-glass-subtle);
}
.selection-item:has(input:focus-visible),
.metrics-choice:has(input:focus-visible),
.toggle-row:has(input:focus-visible),
.view-toggle:has(input:focus-visible) {
  outline: var(--rule-fine) solid var(--color-focus);
  outline-offset: calc(var(--rule-fine) * -1);
}
.selection-warning {
  padding-block: var(--space-xs);
}
.hint.warn {
  color: var(--color-warning-text);
}
.metrics-option {
  display: grid;
  gap: 0;
  min-width: 0;
  margin: 0;
  border: 0;
  padding: var(--space-md);
  background: var(--color-glass-subtle);
}
.metrics-option legend {
  width: 100%;
  padding: 0 0 var(--space-xs);
}
.metrics-choice {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: flex-start;
  gap: var(--space-xs);
  min-height: 3rem;
  padding: var(--space-xs);
  border-top: var(--rule-hair) solid var(--color-rule);
  cursor: pointer;
}
.metrics-choice input {
  margin-top: 0.25em;
  flex: none;
}
.metrics-choice:has(input:checked) {
  background: var(--color-glass-hover);
}
.privacy-option {
  margin: 0;
  padding: var(--space-md);
  border-top: var(--rule-hair) solid var(--color-rule);
  background: var(--color-glass-subtle);
}
.form-foot {
  position: sticky;
  bottom: max(var(--space-sm), env(safe-area-inset-bottom));
  z-index: var(--z-sticky);
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-2xs);
  padding: var(--space-xs);
  border: var(--rule-hair) solid var(--color-rule);
  border-radius: var(--radius-card);
  background: var(--color-glass-strong);
  box-shadow: var(--shadow-float);
  backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
}
.form-foot .ok {
  margin-inline-end: auto;
}

@media (hover: hover) and (pointer: fine) {
  .selection-item:hover,
  .metrics-choice:hover {
    background: var(--color-glass-hover);
  }
}

@media (min-width: 48rem) {
  .identity-grid {
    grid-template-columns: minmax(18rem, 36rem) minmax(16rem, 26rem);
  }
}

@media (min-width: 72rem) {
  .content-panel {
    display: grid;
    grid-template-columns: minmax(17rem, 21rem) minmax(0, 1fr);
    align-items: stretch;
  }

  .content-head {
    grid-template-columns: minmax(0, 1fr);
    align-content: start;
    border-inline-end: var(--rule-hair) solid var(--color-rule);
    border-bottom: 0;
  }

  .content-head .view-toggle,
  .content-head .content-description {
    grid-column: 1;
    justify-self: start;
  }

  .content-body {
    grid-template-columns: minmax(22rem, 1fr) minmax(18rem, 24rem);
  }

  .privacy-option {
    border-top: 0;
    border-inline-start: var(--rule-hair) solid var(--color-rule);
  }
}

@media (min-width: 84rem) {
  .form-layout {
    grid-template-columns: minmax(0, 1fr) minmax(18rem, 22rem);
  }
}

@media (max-width: 40rem) {
  .content-head {
    display: grid;
  }

  .view-toggle {
    justify-self: stretch;
  }

  .url-preview {
    grid-template-columns: minmax(0, 1fr);
  }

  .url-preview .link-btn {
    justify-self: start;
  }

  .form-foot .btn {
    flex: 1 1 0;
  }
}
</style>

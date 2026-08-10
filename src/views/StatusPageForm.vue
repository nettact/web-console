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
import { api, ApiError, type AgentGroup, type ProbeTarget, type StatusPageInput } from '../api'
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

const form = reactive<StatusPageInput>(blank())
const agentGroups = ref<AgentGroup[]>([])
const targets = ref<ProbeTarget[]>([])
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
    agent_group_ids: [],
    target_ids: [],
  }
}

const publicUrl = computed(() =>
  form.slug ? publicStatusUrl(consoleBase.url, form.slug) : '',
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
    ;[agentGroups.value, targets.value] = await Promise.all([
      api.agentGroups(SITE),
      api.listTargets(SITE),
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
  if (!form.show_agent_view && !form.show_target_view) return tr('spform.errNoView')
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

    <template v-else>
      <div class="config-canvas">
        <section class="panel">
          <div class="panel-head"><h3>{{ tr('spform.secGeneral') }}</h3></div>
          <div class="pbody">
            <label class="field">
              <span>{{ tr('spform.title') }}</span>
              <input v-model="form.title" :placeholder="tr('spform.titlePlaceholder')" />
            </label>
            <label class="field">
              <span>{{ tr('spform.slug') }}</span>
              <input v-model="form.slug" spellcheck="false" autocapitalize="off" />
              <small class="hint tiny">{{ tr('spform.slugHint') }}</small>
            </label>
            <div v-if="publicUrl" class="url-preview">
              <code class="mono">{{ publicUrl }}</code>
              <button type="button" class="link-btn" @click="copyUrl">
                {{ copied ? tr('statusPages.copied') : tr('statusPages.copy') }}
              </button>
              <!-- The console only knows the address IT is reachable at. A copy of
                   the status app hosted elsewhere serves the same page from its own
                   origin, so this is "the link this server serves", not "the link". -->
              <p class="hint tiny">{{ tr('spform.urlHint') }}</p>
            </div>
            <label class="field">
              <span>{{ tr('spform.description') }}</span>
              <textarea v-model="form.description" rows="2" :placeholder="tr('spform.descriptionPlaceholder')"></textarea>
              <small class="hint tiny">{{ tr('spform.descriptionHint') }}</small>
            </label>
            <label class="check">
              <input type="checkbox" v-model="form.enabled" />
              <span>{{ tr('spform.enabled') }}</span>
            </label>
            <p class="hint tiny">
              {{ form.enabled ? tr('spform.enabledOnHint') : tr('spform.enabledOffHint') }}
            </p>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head"><h3>{{ tr('spform.secAgents') }}</h3></div>
          <p class="hint panel-hint">{{ tr('spform.agentsHint') }}</p>
          <div class="pbody">
            <label class="check">
              <input type="checkbox" v-model="form.show_agent_view" />
              <span>{{ tr('spform.showAgentView') }}</span>
            </label>
            <div v-if="form.show_agent_view" class="pick">
              <p v-if="!agentGroups.length" class="hint tiny">
                {{ tr('spform.noAgentGroups') }}
                <router-link to="/agents">{{ tr('spform.manageAgentGroups') }}</router-link>
              </p>
              <label v-for="g in agentGroups" :key="g.id" class="pick-chip">
                <input
                  type="checkbox"
                  :checked="form.agent_group_ids.includes(g.id)"
                  @change="toggle(form.agent_group_ids, g.id)"
                />
                <span>{{ g.name }}</span>
                <em>{{ tr('spform.groupMembers', { n: g.agent_ids.length }) }}</em>
              </label>
              <!-- An empty selection is legal (the page simply shows no nodes), but
                   it is almost always an oversight. -->
              <p v-if="agentGroups.length && !form.agent_group_ids.length" class="hint tiny warn">
                {{ tr('spform.noAgentsPicked') }}
              </p>
            </div>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head"><h3>{{ tr('spform.secTargets') }}</h3></div>
          <p class="hint panel-hint">{{ tr('spform.targetsHint') }}</p>
          <div class="pbody">
            <label class="check">
              <input type="checkbox" v-model="form.show_target_view" />
              <span>{{ tr('spform.showTargetView') }}</span>
            </label>
            <div v-if="form.show_target_view" class="pick">
              <p v-if="!targets.length" class="hint tiny">{{ tr('spform.noTargets') }}</p>
              <label v-for="t in targets" :key="t.id" class="pick-chip">
                <input
                  type="checkbox"
                  :checked="!!t.id && form.target_ids.includes(t.id)"
                  @change="t.id && toggle(form.target_ids, t.id)"
                />
                <span>{{ t.name || targetLabel(t, tr) }}</span>
                <em>{{ typeLabel(t, tr) }}</em>
              </label>
              <p v-if="targets.length && !form.target_ids.length" class="hint tiny warn">
                {{ tr('spform.noTargetsPicked') }}
              </p>

              <label class="check address-opt">
                <input type="checkbox" v-model="form.show_target_address" />
                <span>{{ tr('spform.showTargetAddress') }}</span>
              </label>
              <p class="hint tiny" :class="{ warn: form.show_target_address }">
                {{
                  form.show_target_address
                    ? tr('spform.addressOnHint')
                    : tr('spform.addressOffHint')
                }}
              </p>
            </div>
          </div>
        </section>

        <div class="form-foot">
          <router-link to="/status-pages" class="btn">{{ tr('spform.cancel') }}</router-link>
          <button class="btn btn-primary" :disabled="busy || !loaded" @click="save">
            {{ busy ? tr('spform.saving') : editingId ? tr('spform.save') : tr('spform.create') }}
          </button>
          <span v-if="saved" class="ok" role="status" aria-live="polite">{{ tr('spform.savedShort') }}</span>
        </div>
      </div>
    </template>
  </main>
</template>

<style scoped>
/* Hallmark · designed-as-app · design-system: design.md · page: Status page form */
.config-canvas {
  width: 100%;
}
.config-head h2 {
  font-family: var(--font-display);
  letter-spacing: -0.028em;
}
.panel {
  margin-bottom: var(--space-md);
}
.panel-hint {
  margin: 0 18px 6px;
  padding-top: 8px;
}
.url-preview {
  margin: 6px 0 var(--space-sm);
  padding: var(--space-2xs) var(--space-xs);
  border: var(--rule-hair) solid var(--color-rule);
  border-radius: var(--radius-input);
  background: var(--color-glass-subtle);
  overflow-wrap: anywhere;
}
.url-preview code {
  margin-right: 8px;
}
.url-preview .hint {
  margin: 4px 0 0;
}
.pick {
  margin-top: var(--space-2xs);
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.pick > .hint,
.pick > .check {
  flex-basis: 100%;
}
.pick-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border: var(--rule-hair) solid var(--color-rule);
  border-radius: var(--radius-pill);
  background: var(--color-glass-subtle);
  cursor: pointer;
}
.pick-chip em {
  color: var(--text-dim);
  font-size: 12px;
  font-style: normal;
}
.address-opt {
  margin-top: var(--space-2xs);
}
.hint.warn {
  color: var(--color-warning-text);
}
.form-foot {
  display: flex;
  align-items: center;
  gap: var(--space-2xs);
  padding: var(--space-xs);
  border: var(--rule-hair) solid var(--color-rule);
  border-radius: var(--radius-card);
  background: var(--color-glass-strong);
  box-shadow: var(--shadow-float);
  backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
}

@media (max-width: 768px) {
  .panel-hint {
    margin-inline: 0;
    padding-inline: var(--space-sm);
  }
}
</style>

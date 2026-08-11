<script setup lang="ts">
// One-click reverse-proxy configuration for publishing ONE status page at the
// root of its own domain.
//
// This exists because the interesting part of that deployment is not the proxy
// syntax — it is the allowlist. Hand-written rules tend to forward /api/ or
// /api/v1/public/ wholesale, which quietly publishes every OTHER status page on
// the server, and there is no feedback loop that would ever reveal it. Generating
// the file from the page's own slug removes that class of mistake.
//
// The dialog only asks for what the server cannot know: the public domain, how
// the proxy reaches the server, and (static mode) where the copied files live.
// Everything else — the four endpoints, the /status/ remap, the deny-by-default
// rule — comes from the generator.
//
// Accessibility mirrors ReinstallDialog / ConfirmDialog: role=dialog, aria-modal,
// focus moves in on open and is restored on close, Escape and backdrop close,
// Tab is trapped.
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { StatusPage } from '../../api'
import { consoleBase } from '../../consoleBaseUrl'
import { copyToClipboard } from '../../lib/clipboard'
import {
  DOMAIN_RE,
  defaultUpstream,
  isValidUpstream,
  renderProxyConfig,
  type ProxyFlavor,
  type ProxyMode,
} from '../../lib/proxyConfig'

const props = defineProps<{ open: boolean; page: StatusPage | null }>()
const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()

const dialog = ref<HTMLElement | null>(null)
const closeBtn = ref<HTMLButtonElement | null>(null)
let lastFocused: HTMLElement | null = null

const flavor = ref<ProxyFlavor>('nginx')
const mode = ref<ProxyMode>('proxy')
const domain = ref('status.example.com')
const upstream = ref(defaultUpstream(consoleBase.url))
const root = ref('/var/www/nettact-status')
const copied = ref(false)
const copyFailed = ref(false)

const domainOk = computed(() => DOMAIN_RE.test(domain.value.trim()))
const upstreamOk = computed(() => isValidUpstream(upstream.value))
// A path, not a shell word: anything that could end a Caddy block or an nginx
// directive would be pasted into the file verbatim.
const rootOk = computed(() => mode.value !== 'static' || /^[^\s{};#]+$/.test(root.value.trim()))
const ready = computed(() => domainOk.value && upstreamOk.value && rootOk.value && !!props.page)

const config = computed(() => {
  const page = props.page
  if (!page || !ready.value) return ''
  return renderProxyConfig({
    flavor: flavor.value,
    mode: mode.value,
    domain: domain.value.trim(),
    slug: page.slug,
    upstream: upstream.value.trim(),
    root: root.value.trim(),
    comments: {
      header: t('spproxy.cHeader', { slug: page.slug }),
      api: t('spproxy.cApi'),
      config: t('spproxy.cConfig'),
      app: mode.value === 'proxy' ? t('spproxy.cApp') : t('spproxy.cAppStatic'),
      deny: t('spproxy.cDeny'),
      root: t('spproxy.cRoot'),
    },
  })
})

async function copyConfig() {
  if (!config.value) return
  // A console reached over plain HTTP has no Clipboard API; the helper reports
  // whether the copy really happened, and the text below stays selectable.
  if (!(await copyToClipboard(config.value))) {
    copyFailed.value = true
    return
  }
  copyFailed.value = false
  copied.value = true
  window.setTimeout(() => (copied.value = false), 1600)
}

function onClose() {
  emit('close')
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault()
    onClose()
    return
  }
  if (e.key !== 'Tab') return
  const focusable = dialog.value?.querySelectorAll<HTMLElement>(
    'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
  )
  if (!focusable || !focusable.length) return
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  const active = document.activeElement
  if (e.shiftKey && active === first) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && active === last) {
    e.preventDefault()
    first.focus()
  }
}

watch(
  () => props.open,
  async (open) => {
    if (open) {
      lastFocused = document.activeElement as HTMLElement | null
      copied.value = false
      copyFailed.value = false
      // Re-derived per open: the console's own address is discovered
      // asynchronously, so a dialog opened later should get the better default.
      upstream.value = defaultUpstream(consoleBase.url)
      await nextTick()
      closeBtn.value?.focus()
    } else if (lastFocused) {
      lastFocused.focus()
      lastFocused = null
    }
  },
)
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="open" class="pc-backdrop" @click="onClose">
        <div
          ref="dialog"
          class="pc-dialog card"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pc-title"
          @click.stop
          @keydown="onKeydown"
        >
          <header class="pc-head">
            <h3 id="pc-title" class="pc-title">{{ t('spproxy.title') }}</h3>
            <button ref="closeBtn" type="button" class="pc-x" :aria-label="t('common.close')" @click="onClose">
              ×
            </button>
          </header>

          <div class="pc-body">
            <p class="pc-intro">{{ t('spproxy.intro', { title: page?.title ?? '', slug: page?.slug ?? '' }) }}</p>

            <div class="pc-fields">
              <label class="pc-field">
                <span>{{ t('spproxy.domain') }}</span>
                <input v-model="domain" spellcheck="false" placeholder="status.example.com" />
                <small v-if="!domainOk" class="pc-bad">{{ t('spproxy.domainInvalid') }}</small>
                <small v-else class="hint tiny">{{ t('spproxy.domainHint') }}</small>
              </label>

              <label class="pc-field">
                <span>{{ t('spproxy.upstream') }}</span>
                <input v-model="upstream" spellcheck="false" placeholder="http://127.0.0.1:12450" />
                <small v-if="!upstreamOk" class="pc-bad">{{ t('spproxy.upstreamInvalid') }}</small>
                <small v-else class="hint tiny">{{ t('spproxy.upstreamHint') }}</small>
              </label>
            </div>

            <div class="pc-choices">
              <div class="pc-choice">
                <span id="pc-flavor-label" class="pc-choice-label">{{ t('spproxy.flavor') }}</span>
                <div class="segmented" role="group" aria-labelledby="pc-flavor-label">
                  <button
                    v-for="f in (['nginx', 'caddy'] as ProxyFlavor[])"
                    :key="f"
                    type="button"
                    :class="{ active: flavor === f }"
                    :aria-pressed="flavor === f"
                    @click="flavor = f"
                  >
                    {{ f === 'nginx' ? 'nginx' : 'Caddy' }}
                  </button>
                </div>
              </div>

              <div class="pc-choice">
                <span id="pc-mode-label" class="pc-choice-label">{{ t('spproxy.mode') }}</span>
                <div class="segmented" role="group" aria-labelledby="pc-mode-label">
                  <button
                    v-for="m in (['proxy', 'static'] as ProxyMode[])"
                    :key="m"
                    type="button"
                    :class="{ active: mode === m }"
                    :aria-pressed="mode === m"
                    @click="mode = m"
                  >
                    {{ m === 'proxy' ? t('spproxy.modeProxy') : t('spproxy.modeStatic') }}
                  </button>
                </div>
              </div>

              <!-- Last in the row, and only ever added to the right of the two
                   controls: appearing and disappearing then moves nothing that was
                   already on screen. Its guidance lives in the mode hint below
                   rather than under the input, so the row's height does not change
                   with it either. -->
              <label v-if="mode === 'static'" class="pc-choice pc-choice-field">
                <span class="pc-choice-label">{{ t('spproxy.root') }}</span>
                <input v-model="root" spellcheck="false" placeholder="/var/www/nettact-status" />
              </label>
            </div>

            <p class="hint tiny pc-mode-hint">
              {{ mode === 'proxy' ? t('spproxy.modeProxyHint') : t('spproxy.modeStaticHint') }}
            </p>
            <p v-if="!rootOk" class="pc-bad">{{ t('spproxy.rootInvalid') }}</p>

            <div class="code-wrap">
              <button type="button" class="copy" :disabled="!ready" @click="copyConfig">
                {{ copied ? t('common.copied') : t('statusPages.copy') }}
              </button>
              <pre><code>{{ config || t('spproxy.fixFirst') }}</code></pre>
            </div>
            <p v-if="copyFailed" class="pc-bad">{{ t('common.copyUnavailable') }}</p>

            <p class="hint tiny pc-docs">
              {{ t('spproxy.docsHint') }}
              <a :href="t('docs.statusPageDomainUrl')" target="_blank" rel="noopener noreferrer">
                {{ t('statusPages.domainLink') }} →
              </a>
            </p>
          </div>

          <div class="pc-actions">
            <button type="button" class="btn btn-primary" @click="onClose">{{ t('common.close') }}</button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* Hallmark · component: status page proxy config dialog · genre: custom application */
.pc-backdrop {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal, 60);
  display: grid;
  place-items: center;
  padding: 1.25rem;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(2px);
  overflow: auto;
}

.pc-dialog {
  width: min(46rem, 100%);
  max-height: min(88vh, 60rem);
  display: flex;
  flex-direction: column;
  padding: 0;
  background: var(--surface-solid);
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}

.pc-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 1rem 1.25rem 0.75rem;
  border-bottom: 1px solid var(--border);
}

.pc-title {
  margin: 0;
  font-size: 1.05rem;
}

.pc-x {
  border: 0;
  background: transparent;
  color: var(--text-muted);
  font-size: 1.4rem;
  line-height: 1;
  cursor: pointer;
  padding: 0 0.25rem;
  border-radius: var(--radius-sm);
}

.pc-x:hover {
  color: var(--text);
}

.pc-body {
  padding: 1rem 1.25rem;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.pc-intro {
  margin: 0;
  color: var(--text-dim);
  font-size: 0.9rem;
}

.pc-fields {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
  gap: 0.75rem;
}

.pc-field {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  font-size: 0.85rem;
}

.pc-field input {
  font-family: var(--mono);
  font-size: 0.85rem;
}

.pc-bad {
  color: var(--danger);
  font-size: 0.78rem;
}

.pc-choices {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 1.25rem;
}

.pc-choice {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

/* The static-directory input rides at the end of the choices row. It grows into
 * whatever is left, and its control height matches the segmented buttons, so
 * showing it neither reflows the row nor changes its height. */
.pc-choice-field {
  flex: 1 1 12rem;
  min-width: 9rem;
}

.pc-choice-field input {
  font-family: var(--mono);
  font-size: 0.82rem;
  padding: 6px 10px;
}

.pc-choice-label {
  font-size: 0.85rem;
  color: var(--text-dim);
}

/* The console's segmented control (same shape as RangePicker's), rather than the
 * underline tabs used for page-level sections: these two are settings that feed
 * the generated file, not navigation. Filled-accent for the selected segment
 * uses the primary-action tokens, so the "on" state survives both themes. */
.segmented {
  display: inline-flex;
  padding: 3px;
  gap: 2px;
  background: var(--input-bg);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
}

.segmented button {
  border: none;
  background: transparent;
  color: var(--text-dim);
  font: inherit;
  font-size: 0.82rem;
  padding: 6px 12px;
  border-radius: 6px;
  cursor: pointer;
  transition:
    color 120ms ease,
    background-color 120ms ease;
}

.segmented button:hover {
  color: var(--text);
}

.segmented button.active {
  color: var(--color-primary-action-text);
  background: var(--color-primary-action-bg);
  font-weight: 600;
}

@media (prefers-reduced-motion: reduce) {
  .segmented button {
    transition: none;
  }
}

.pc-mode-hint {
  margin: -0.35rem 0 0;
}

.code-wrap {
  position: relative;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--code-bg, var(--surface-2));
  overflow: hidden;
}

.code-wrap pre {
  margin: 0;
  padding: 0.85rem 1rem;
  overflow: auto;
  max-height: 22rem;
}

.code-wrap code {
  font-family: var(--mono);
  font-size: 0.8rem;
  line-height: 1.55;
  white-space: pre;
}

.copy {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
  z-index: 1;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--text);
  font-size: 0.78rem;
  padding: 0.2rem 0.6rem;
  cursor: pointer;
}

.copy:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.pc-docs {
  margin: 0;
}

.pc-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.6rem;
  padding: 0.75rem 1.25rem 1rem;
  border-top: 1px solid var(--border);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .fade-enter-active,
  .fade-leave-active {
    transition: none;
  }
}
</style>

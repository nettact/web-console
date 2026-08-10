<script setup lang="ts">
// Public status pages: the anonymous boards this server publishes.
//
// The list leads with the public address rather than the title, because the
// address is the thing an operator actually needs from this page — to copy it,
// to open it, or to check that a page they meant to unpublish is in fact off.
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { api, type StatusPage } from '../api'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import { consoleBase, ensureConsoleBase } from '../consoleBaseUrl'
import { copyToClipboard } from '../lib/clipboard'
import { publicStatusUrl } from '../lib/statusPage'
import { pushToast } from '../toasts'

const { t: tr } = useI18n()

const pages = ref<StatusPage[]>([])
const error = ref('')
const busy = ref(false)
const loaded = ref(false)
const copied = ref('')

async function load() {
  try {
    pages.value = await api.statusPages()
    loaded.value = true
  } catch (e) {
    error.value = String((e as Error).message || e)
  }
}

function urlOf(p: StatusPage): string {
  return publicStatusUrl(consoleBase.url, p.slug)
}

async function copyUrl(p: StatusPage) {
  // copyToClipboard reports whether the copy really happened — a console reached
  // over plain HTTP has no Clipboard API at all, and claiming success there would
  // hand the operator whatever was in the clipboard before.
  if (await copyToClipboard(urlOf(p))) {
    copied.value = p.id
    window.setTimeout(() => (copied.value = ''), 1600)
  } else {
    pushToast({ tone: 'warn', title: tr('statusPages.copyFailed') })
  }
}

// ---- delete ----
const pendingDelete = ref<StatusPage | null>(null)

async function confirmDelete() {
  const p = pendingDelete.value
  if (!p) return
  busy.value = true
  error.value = ''
  try {
    await api.deleteStatusPage(p.id)
    pendingDelete.value = null
    await load()
    pushToast({ tone: 'info', title: tr('statusPages.deleted', { name: p.title }) })
  } catch (e) {
    error.value = String((e as Error).message || e)
    pendingDelete.value = null
  } finally {
    busy.value = false
  }
}

onMounted(async () => {
  // The public URL is built from the console_base_url setting, not the address
  // this browser happens to be using — same reason the enrollment command does.
  ensureConsoleBase()
  await load()
})
</script>

<template>
  <main class="page data-workbench" aria-labelledby="status-pages-title">
    <div class="page-head workbench-head">
      <h2 id="status-pages-title">{{ tr('statusPages.title') }}</h2>
      <p class="sub">{{ tr('statusPages.sub') }}</p>
      <router-link to="/status-pages/new" class="btn btn-primary head-action">
        {{ tr('statusPages.create') }}
      </router-link>
    </div>
    <p v-if="error" class="err" role="alert">{{ error }}</p>

    <section class="panel table-sheet" aria-labelledby="status-pages-list-title">
      <div class="panel-head">
        <h3 id="status-pages-list-title">{{ tr('statusPages.listTitle') }}</h3>
        <span class="count">{{ pages.length }}</span>
      </div>
      <p class="hint panel-hint">{{ tr('statusPages.listHint') }}</p>

      <div
        v-if="pages.length"
        class="table-wrap"
        role="region"
        tabindex="0"
        :aria-label="tr('statusPages.listTitle')"
      >
        <table class="data-table">
          <thead>
            <tr>
              <th>{{ tr('statusPages.thTitle') }}</th>
              <th>{{ tr('statusPages.thUrl') }}</th>
              <th>{{ tr('statusPages.thPublished') }}</th>
              <th>{{ tr('statusPages.thContent') }}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in pages" :key="p.id">
              <td>{{ p.title }}</td>
              <td class="url-cell">
                <code class="mono">{{ urlOf(p) }}</code>
                <button class="link-btn" @click="copyUrl(p)">
                  {{ copied === p.id ? tr('statusPages.copied') : tr('statusPages.copy') }}
                </button>
                <a class="link-btn" :href="urlOf(p)" target="_blank" rel="noopener">
                  {{ tr('statusPages.open') }}
                </a>
              </td>
              <td>
                <span v-if="p.enabled" class="pill on">{{ tr('statusPages.published') }}</span>
                <span v-else class="pill off">{{ tr('statusPages.unpublished') }}</span>
              </td>
              <td>
                <span v-if="p.show_agent_view" class="chip">
                  {{ tr('statusPages.nAgentGroups', { n: p.agent_group_ids.length }) }}
                </span>
                <span v-if="p.show_target_view" class="chip">
                  {{ tr('statusPages.nTargets', { n: p.target_ids.length }) }}
                </span>
                <span v-if="p.show_target_address" class="chip warn">
                  {{ tr('statusPages.addressesShown') }}
                </span>
              </td>
              <td class="actions">
                <router-link :to="`/status-pages/${p.id}/edit`" class="link-btn">
                  {{ tr('statusPages.edit') }}
                </router-link>
                <button class="link-btn danger" :disabled="busy" @click="pendingDelete = p">
                  {{ tr('statusPages.delete') }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-else-if="loaded" class="hint tiny pbody-hint">{{ tr('statusPages.empty') }}</p>
    </section>

    <ConfirmDialog
      :open="!!pendingDelete"
      :title="tr('statusPages.deleteTitle')"
      :message="[tr('statusPages.deleteBody', { name: pendingDelete?.title ?? '' })]"
      :confirm-label="tr('statusPages.delete')"
      :cancel-label="tr('statusPages.cancel')"
      :busy="busy"
      tone="danger"
      @confirm="confirmDelete"
      @cancel="pendingDelete = null"
    />
  </main>
</template>

<style scoped>
/* Hallmark · designed-as-app · design-system: design.md · page: StatusPages */
.data-workbench {
  font-variant-numeric: tabular-nums;
}
.workbench-head h2 {
  font-family: var(--font-display);
  letter-spacing: -0.028em;
}
.page-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 10px;
}
.page-head .sub {
  flex: 1 1 320px;
}
.head-action {
  margin-left: auto;
}
.panel {
  margin-bottom: var(--space-md);
}
.table-sheet {
  background: var(--color-glass-strong);
  border-color: var(--color-rule);
  border-radius: var(--radius-panel);
  box-shadow: var(--shadow-card);
  backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
}
.table-sheet .panel-head {
  min-height: 56px;
  border-bottom-color: var(--color-rule);
}
.table-sheet .panel-head h3 {
  font-family: var(--font-display);
  letter-spacing: -0.018em;
}
.panel-hint {
  margin: 0 18px 6px;
  padding-top: 8px;
}
.pbody-hint {
  padding: 0 18px 16px;
}
.url-cell {
  white-space: nowrap;
}
.url-cell code {
  margin-right: 8px;
}
.pill {
  padding: 1px 8px;
  border-radius: var(--radius-pill);
  font-size: 12px;
  border: 1px solid var(--color-rule-2);
}
.pill.on {
  color: var(--color-success-text);
  border-color: var(--color-success);
}
.pill.off {
  color: var(--text-dim);
}
.chip {
  display: inline-block;
  margin-right: 6px;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 12px;
  background: var(--color-glass-subtle);
  color: var(--color-ink-2);
}
.chip.warn {
  color: var(--color-warning-text);
}
.actions {
  white-space: nowrap;
}
.link-btn.danger {
  color: var(--color-danger-text);
}
.table-wrap {
  overflow-x: auto;
  overscroll-behavior-inline: contain;
  scrollbar-gutter: stable;
}
.table-wrap:focus-visible {
  outline: var(--rule-fine) solid var(--color-focus);
  outline-offset: calc(-1 * var(--rule-fine));
}
.data-table {
  min-width: 860px;
}
.data-table thead th {
  background: var(--color-glass-subtle);
}

@media (max-width: 768px) {
  .page-head .sub {
    flex-basis: 100%;
  }
  .head-action {
    margin-left: 0;
  }
  .panel-hint,
  .pbody-hint {
    margin-inline: 0;
    padding-inline: var(--space-sm);
  }
}

@media (max-width: 414px) {
  .head-action {
    width: 100%;
  }
}
</style>

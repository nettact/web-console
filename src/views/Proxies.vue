<script setup lang="ts">
// Egress proxies: the site's reusable outbound paths a monitor can be pinned to.
//
// The list carries a health column rather than just configuration, because a proxy's
// only observable truth is what the monitors through it are reporting: a proxy whose
// pinned monitors are all failing with a proxy_* reason is broken, and that is the
// thing an operator needs to see the moment they open this page.
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { api, type Proxy, type ProbeTarget } from '../api'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import { refreshTargetStatus, targetIndex } from '../targetStatus'
import { pushToast } from '../toasts'

const { t: tr } = useI18n()

const SITE = 'site_default'
const proxies = ref<Proxy[]>([])
const targets = ref<ProbeTarget[]>([])
const error = ref('')
const busy = ref(false)
const loaded = ref(false)

async function load() {
  try {
    ;[proxies.value, targets.value] = await Promise.all([api.proxies(SITE), api.listTargets(SITE)])
    loaded.value = true
  } catch (e) {
    error.value = String((e as Error).message || e)
  }
}

// monitorsOf returns the monitors pinned to a proxy.
function monitorsOf(p: Proxy): ProbeTarget[] {
  return targets.value.filter((t) => t.proxy_id === p.id)
}

// blockedByProxy counts a proxy's monitors that are NOT RUNNING because of the pin
// itself — the agent reported proxy_missing / proxy_unsupported /
// proxy_remote_dns_denied as the block reason (see monitoreval's Reason* constants).
//
// This is the one proxy signal the status API exposes unambiguously, and it is the
// actionable one: those monitors are collecting nothing at all until the proxy is
// fixed. Runtime egress failures (a dead proxy, a rejected credential) surface as the
// monitor's own probe_* error class on its detail page — this page deliberately does
// not guess at them, because a down monitor through a healthy proxy looks the same
// from here and blaming the proxy would send the operator the wrong way.
function blockedByProxy(p: Proxy): number {
  let n = 0
  for (const t of monitorsOf(p)) {
    if (!t.id) continue
    const row = targetIndex.value.get(t.id)
    if (!row) continue
    if (row.agents.some((a) => a.block_reason.startsWith('proxy_'))) n++
  }
  return n
}

// abnormal counts a proxy's monitors that are currently not healthy, without
// attributing the cause.
function abnormal(p: Proxy): number {
  let n = 0
  for (const t of monitorsOf(p)) {
    if (!t.id) continue
    const row = targetIndex.value.get(t.id)
    if (!row) continue
    if (row.display_state !== 'healthy' && row.display_state !== 'disabled') n++
  }
  return n
}

function endpointLabel(p: Proxy): string {
  if (p.type === 'wireguard') return p.wg_endpoint || '—'
  if (!p.host) return '—'
  return p.port ? `${p.host}:${p.port}` : p.host
}

function authLabel(p: Proxy): string {
  if (p.type === 'wireguard') {
    return p.wg_preshared_key ? tr('proxies.authKeyPsk') : tr('proxies.authKey')
  }
  return p.username ? tr('proxies.authUserPass') : tr('proxies.authNone')
}

const anyProxies = computed(() => proxies.value.length > 0)

// ---- delete ----
const pendingDelete = ref<Proxy | null>(null)
// blockedDelete holds the monitors that made a delete impossible, so the refusal
// names them instead of just failing.
const blockedDelete = ref<{ proxy: Proxy; monitors: string[] } | null>(null)

function askDelete(p: Proxy) {
  // The reference check is also enforced server-side (409). Doing it here first means
  // the common case explains itself without a failed request.
  const used = monitorsOf(p)
  if (used.length > 0) {
    blockedDelete.value = {
      proxy: p,
      monitors: used.map((t) => t.name || t.target || t.id || ''),
    }
    return
  }
  pendingDelete.value = p
}

async function confirmDelete() {
  const p = pendingDelete.value
  if (!p) return
  busy.value = true
  error.value = ''
  try {
    await api.deleteProxy(p.id)
    pendingDelete.value = null
    await load()
    pushToast({ tone: 'info', title: tr('proxies.deleted', { name: p.name }) })
  } catch (e) {
    error.value = String((e as Error).message || e)
    pendingDelete.value = null
  } finally {
    busy.value = false
  }
}

onMounted(async () => {
  await load()
  // The shared status store feeds the usage column. It is already initialized
  // app-wide; refreshing here just makes this page's counts current on entry, and a
  // failure leaves the column blank rather than blocking the page.
  refreshTargetStatus()
})
</script>

<template>
  <main class="page data-workbench" aria-labelledby="proxies-title">
    <div class="page-head workbench-head">
      <h2 id="proxies-title">{{ tr('proxies.title') }}</h2>
      <p class="sub">{{ tr('proxies.sub') }}</p>
      <router-link to="/proxies/new" class="btn btn-primary head-action">
        {{ tr('proxies.create') }}
      </router-link>
    </div>
    <p v-if="error" class="err" role="alert">{{ error }}</p>

    <section class="panel table-sheet" :aria-labelledby="'proxies-list-title'">
      <div class="panel-head">
        <h3 id="proxies-list-title">{{ tr('proxies.listTitle') }}</h3>
        <span class="count">{{ proxies.length }}</span>
      </div>
      <p class="hint panel-hint">{{ tr('proxies.listHint') }}</p>

      <div
        class="table-wrap"
        v-if="anyProxies"
        role="region"
        tabindex="0"
        :aria-label="tr('proxies.listTitle')"
      >
        <table class="data-table">
          <thead>
            <tr>
              <th>{{ tr('proxies.thName') }}</th>
              <th>{{ tr('proxies.thType') }}</th>
              <th>{{ tr('proxies.thEndpoint') }}</th>
              <th>{{ tr('proxies.thAuth') }}</th>
              <th>{{ tr('proxies.thDNS') }}</th>
              <th class="center">{{ tr('proxies.thEnabled') }}</th>
              <th>{{ tr('proxies.thUsage') }}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in proxies" :key="p.id">
              <td>{{ p.name }}</td>
              <td>{{ tr(`proxies.type_${p.type}`) }}</td>
              <td class="mono">{{ endpointLabel(p) }}</td>
              <td>{{ authLabel(p) }}</td>
              <td>
                <!-- A tunnel resolves in-tunnel, so there is no proxy-side DNS choice. -->
                <span v-if="p.type === 'wireguard'" class="dim">—</span>
                <span v-else>{{ tr(`proxies.dns_${p.dns_mode || 'local'}`) }}</span>
              </td>
              <td class="center"><span :class="['dot', p.enabled ? 'up' : '']"></span></td>
              <td>
                <span v-if="!monitorsOf(p).length" class="dim">{{ tr('proxies.usedByNone') }}</span>
                <template v-else>
                  <span>{{ tr('proxies.usedByN', { n: monitorsOf(p).length }) }}</span>
                  <!-- Blocked-by-proxy outranks the generic abnormal count: those
                       monitors are collecting nothing until the pin is fixed. -->
                  <span v-if="blockedByProxy(p)" class="egress-bad">
                    {{ tr('proxies.blockedByProxy', { n: blockedByProxy(p) }) }}
                  </span>
                  <span v-else-if="abnormal(p)" class="egress-warn">
                    {{ tr('proxies.abnormalN', { n: abnormal(p) }) }}
                  </span>
                </template>
              </td>
              <td class="actions">
                <router-link :to="`/proxies/${p.id}/edit`" class="link-btn">{{ tr('proxies.edit') }}</router-link>
                <button class="link-btn danger" :disabled="busy" @click="askDelete(p)">
                  {{ tr('proxies.delete') }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-else-if="loaded" class="hint tiny pbody-hint">{{ tr('proxies.empty') }}</p>
    </section>

    <ConfirmDialog
      :open="!!pendingDelete"
      :title="tr('proxies.deleteTitle')"
      :message="[tr('proxies.deleteBody', { name: pendingDelete?.name ?? '' })]"
      :confirm-label="tr('proxies.delete')"
      :cancel-label="tr('proxies.cancel')"
      :busy="busy"
      tone="danger"
      @confirm="confirmDelete"
      @cancel="pendingDelete = null"
    />
    <!-- A referenced proxy cannot be deleted: unpinning automatically would change
         where those monitors egress from without anyone asking. -->
    <ConfirmDialog
      :open="!!blockedDelete"
      :title="tr('proxies.inUseTitle')"
      :message="[
        tr('proxies.inUseBody', {
          name: blockedDelete?.proxy.name ?? '',
          monitors: (blockedDelete?.monitors ?? []).join('、'),
        }),
        tr('proxies.inUseHow'),
      ]"
      :confirm-label="tr('proxies.inUseOk')"
      :cancel-label="tr('proxies.cancel')"
      tone="danger"
      @confirm="blockedDelete = null"
      @cancel="blockedDelete = null"
    />
  </main>
</template>

<style scoped>
/* Hallmark · designed-as-app · design-system: design.md · page: Proxies */
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
.dim {
  color: var(--text-dim);
}
.egress-bad,
.egress-warn {
  margin-left: 8px;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 12px;
}
.egress-bad {
  color: var(--color-danger-text);
  background: var(--color-glass-subtle);
}
.egress-warn {
  color: var(--color-warning-text);
  background: var(--color-glass-subtle);
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
  min-width: 820px;
}
.data-table thead th {
  background: var(--color-glass-subtle);
}
.data-table tbody tr:focus-within td {
  background: var(--color-glass-hover);
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

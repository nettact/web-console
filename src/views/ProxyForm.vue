<script setup lang="ts">
// Create/edit an egress proxy.
//
// Two shapes behind one type selector: socks5/http are relays (host/port/credentials),
// wireguard is a userspace tunnel (keys/endpoint/routes). Only the selected shape's
// fields are shown, because a form that offered both would invite configuring a
// WireGuard key on a SOCKS5 proxy and wondering why nothing changed.
//
// Credentials are WRITE-ONLY. A read returns REDACTED_SECRET when a secret is set;
// sending that value back means "keep it". So the field is prefilled with the
// placeholder on edit, and the user overwrites it to rotate or clears it to remove.
import { computed, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import {
  api,
  REDACTED_SECRET,
  type ProbeTarget,
  type Proxy,
  type ProxyInput,
} from '../api'
import { proxyCapable } from '../lib/proxyCapability'
import { pushToast } from '../toasts'

const { t: tr } = useI18n()
const route = useRoute()
const router = useRouter()

const SITE = 'site_default'
const editingId = computed(() => (route.params.id as string) || '')

const form = reactive<ProxyInput>(blank())
const targets = ref<ProbeTarget[]>([])
const error = ref('')
const busy = ref(false)
const saved = ref(false)
const notFound = ref(false)
const loaded = ref(false)

function blank(): ProxyInput {
  return {
    name: '',
    type: 'socks5',
    enabled: true,
    host: '',
    port: undefined,
    username: '',
    password: '',
    dns_mode: 'local',
    connect_timeout_ms: undefined,
    wg_private_key: '',
    wg_peer_public_key: '',
    wg_preshared_key: '',
    wg_endpoint: '',
    wg_allowed_ips: '',
    wg_local_addrs: '',
    wg_dns: '',
    wg_mtu: undefined,
    wg_keepalive_seconds: undefined,
  }
}

const isRelay = computed(() => form.type === 'socks5' || form.type === 'http')
const isTunnel = computed(() => form.type === 'wireguard')

// Monitors already pinned to this proxy, so a type change that would strand them is
// warned about HERE — the server refuses such a save, and a bare rejection would not
// say which monitors caused it.
const pinned = computed(() => targets.value.filter((t) => t.proxy_id === editingId.value))
const strandedByType = computed(() =>
  pinned.value.filter((t) => !proxyCapable(t.kind, t.params, form.type)),
)

async function load() {
  try {
    targets.value = await api.listTargets(SITE)
  } catch {
    // The pinned-monitor warning is advisory; the server enforces it regardless, so a
    // failure here must not block editing the proxy.
  }
  if (!editingId.value) {
    loaded.value = true
    return
  }
  try {
    const all = await api.proxies(SITE)
    const found = all.find((p) => p.id === editingId.value)
    if (!found) {
      notFound.value = true
      return
    }
    applyProxy(found)
    loaded.value = true
  } catch (e) {
    error.value = String((e as Error).message || e)
  }
}

// applyProxy copies a loaded proxy into the form. The redacted secrets come through
// as-is: leaving the placeholder in the field is what makes an untouched save keep the
// stored credential.
function applyProxy(p: Proxy) {
  form.name = p.name
  form.type = p.type
  form.enabled = p.enabled
  form.host = p.host ?? ''
  form.port = p.port || undefined
  form.username = p.username ?? ''
  form.password = p.password ?? ''
  form.dns_mode = p.dns_mode ?? 'local'
  form.connect_timeout_ms = p.connect_timeout_ms || undefined
  form.wg_private_key = p.wg_private_key ?? ''
  form.wg_peer_public_key = p.wg_peer_public_key ?? ''
  form.wg_preshared_key = p.wg_preshared_key ?? ''
  form.wg_endpoint = p.wg_endpoint ?? ''
  form.wg_allowed_ips = p.wg_allowed_ips ?? ''
  form.wg_local_addrs = p.wg_local_addrs ?? ''
  form.wg_dns = p.wg_dns ?? ''
  form.wg_mtu = p.wg_mtu || undefined
  form.wg_keepalive_seconds = p.wg_keepalive_seconds || undefined
}

// hasStoredSecret reports whether a field currently holds the read placeholder, so
// the hint can say "a secret is stored; leave this alone to keep it".
const hasStoredPassword = computed(() => form.password === REDACTED_SECRET)
const hasStoredPrivateKey = computed(() => form.wg_private_key === REDACTED_SECRET)
const hasStoredPSK = computed(() => form.wg_preshared_key === REDACTED_SECRET)

// isBareIPv6 reports whether a host field holds an unbracketed IPv6 literal. Detected
// by shape (two or more colons and only hex/colon characters) rather than by full
// parsing: the server is authoritative on validity, and all this decides is whether the
// colons are address separators or a misplaced port.
function isBareIPv6(host: string): boolean {
  return (host.match(/:/g)?.length ?? 0) >= 2 && /^[0-9a-fA-F:.]+$/.test(host)
}

// A local shape check mirroring server-core/api/proxyvalidate.go, so a value the
// server would reject is reported next to the field instead of after a round trip.
function validationError(): string {
  if (!form.name.trim()) return tr('pform.errName')
  if (isRelay.value) {
    const host = (form.host ?? '').trim()
    if (!host) return tr('pform.errHost')
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(host)) return tr('pform.errHostURL')
    // A bare IPv6 literal is colon-dense, so it must be recognized BEFORE the colon is
    // read as a port separator — otherwise a valid IPv6-only proxy could not be entered
    // at all, even though the server accepts it and net.JoinHostPort brackets it with
    // the port field. Mirrors validateBareHost in server-core/api/probevalidate.go.
    if (!isBareIPv6(host) && host.includes(':')) return tr('pform.errHostPort')
    const port = Number(form.port)
    if (!Number.isInteger(port) || port < 1 || port > 65535) return tr('pform.errPort')
    // SOCKS5 sends the password only alongside a username, so a lone password would
    // be silently dropped — say so rather than let it look configured.
    if ((form.password ?? '') && !(form.username ?? '')) return tr('pform.errPasswordNeedsUser')
    if ((form.username ?? '').includes(':')) return tr('pform.errUserColon')
  }
  if (isTunnel.value) {
    if (!(form.wg_private_key ?? '').trim()) return tr('pform.errPrivKey')
    if (!(form.wg_peer_public_key ?? '').trim()) return tr('pform.errPeerKey')
    if (!(form.wg_endpoint ?? '').trim()) return tr('pform.errEndpoint')
    if (!(form.wg_endpoint ?? '').includes(':')) return tr('pform.errEndpointPort')
    if (!(form.wg_allowed_ips ?? '').trim()) return tr('pform.errAllowedIPs')
    if (!(form.wg_local_addrs ?? '').trim()) return tr('pform.errLocalAddrs')
  }
  return ''
}

// payload sends only the selected shape's fields. The server clears the other shape
// anyway; sending them would just be noise.
function payload(): ProxyInput {
  const base = { name: form.name.trim(), type: form.type, enabled: form.enabled }
  if (isTunnel.value) {
    return {
      ...blank(),
      ...base,
      wg_private_key: (form.wg_private_key ?? '').trim(),
      wg_peer_public_key: (form.wg_peer_public_key ?? '').trim(),
      wg_preshared_key: (form.wg_preshared_key ?? '').trim(),
      wg_endpoint: (form.wg_endpoint ?? '').trim(),
      wg_allowed_ips: (form.wg_allowed_ips ?? '').trim(),
      wg_local_addrs: (form.wg_local_addrs ?? '').trim(),
      wg_dns: (form.wg_dns ?? '').trim(),
      wg_mtu: form.wg_mtu || 0,
      wg_keepalive_seconds: form.wg_keepalive_seconds || 0,
    }
  }
  return {
    ...blank(),
    ...base,
    host: (form.host ?? '').trim(),
    port: Number(form.port) || 0,
    username: (form.username ?? '').trim(),
    password: form.password ?? '',
    dns_mode: form.dns_mode ?? 'local',
    connect_timeout_ms: form.connect_timeout_ms || 0,
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
      await api.updateProxy(editingId.value, payload())
    } else {
      await api.createProxy(SITE, payload())
    }
    saved.value = true
    pushToast({ tone: 'info', title: tr('pform.saved', { name: form.name.trim() }) })
    router.push('/proxies')
  } catch (e) {
    error.value = String((e as Error).message || e)
  } finally {
    busy.value = false
  }
}

// Switching the type deliberately does NOT touch the secret fields.
//
// An earlier version cleared the inactive shape's placeholder here, reasoning that its
// stored value was about to be discarded server-side. That is only true if the user
// SAVES as the other type — and it made an exploratory toggle destructive: switching
// SOCKS5 → WireGuard → SOCKS5 left `password` as '', which the API reads as "delete
// the credential", silently breaking every monitor pinned to the proxy.
//
// Nothing is needed instead: payload() builds from blank() and fills only the ACTIVE
// shape, so the inactive shape's placeholder is never sent, and the server clears that
// shape's columns itself.
onMounted(load)
</script>

<template>
  <main class="page config-page" aria-labelledby="proxy-form-title">
    <div class="page-head config-head">
      <h2 id="proxy-form-title">{{ editingId ? tr('pform.editTitle') : tr('pform.newTitle') }}</h2>
      <p class="sub">{{ tr('pform.sub') }}</p>
    </div>
    <p v-if="error" class="err" role="alert">{{ error }}</p>

    <p v-if="notFound" class="hint">
      {{ tr('pform.notFound') }}
      <router-link to="/proxies">{{ tr('pform.back') }}</router-link>
    </p>

    <template v-else>
      <div class="config-canvas">
      <section class="panel">
        <div class="panel-head"><h3>{{ tr('pform.secGeneral') }}</h3></div>
        <div class="pbody">
          <label class="field">
            <span>{{ tr('pform.name') }}</span>
            <input v-model="form.name" :placeholder="tr('pform.namePlaceholder')" />
          </label>
          <label class="field">
            <span>{{ tr('pform.type') }}</span>
            <select v-model="form.type">
              <option value="socks5">{{ tr('proxies.type_socks5') }}</option>
              <option value="http">{{ tr('proxies.type_http') }}</option>
              <option value="wireguard">{{ tr('proxies.type_wireguard') }}</option>
            </select>
          </label>
          <p class="hint tiny">{{ tr(`pform.typeHint_${form.type}`) }}</p>
          <label class="check">
            <input type="checkbox" v-model="form.enabled" />
            <span>{{ tr('pform.enabled') }}</span>
          </label>
          <!-- Disabling drops the proxy from the config push, which fails its pinned
               monitors closed rather than letting them dial directly. Say so. -->
          <p class="hint tiny" v-if="!form.enabled && pinned.length">
            {{ tr('pform.disabledWarn', { n: pinned.length }) }}
          </p>
        </div>
      </section>

      <!-- socks5 / http -->
      <section class="panel" v-if="isRelay">
        <div class="panel-head"><h3>{{ tr('pform.secRelay') }}</h3></div>
        <div class="pbody form-grid">
          <label class="field">
            <span>{{ tr('pform.host') }}</span>
            <input v-model="form.host" placeholder="proxy.example.com" />
          </label>
          <label class="field">
            <span>{{ tr('pform.port') }}</span>
            <input type="number" min="1" max="65535" v-model.number="form.port" :placeholder="form.type === 'socks5' ? '1080' : '8080'" />
          </label>
          <label class="field">
            <span>{{ tr('pform.username') }}</span>
            <input v-model="form.username" :placeholder="tr('pform.optional')" autocomplete="off" />
          </label>
          <label class="field">
            <span>{{ tr('pform.password') }}</span>
            <input type="password" v-model="form.password" :placeholder="tr('pform.optional')" autocomplete="new-password" />
            <small v-if="hasStoredPassword" class="hint tiny">{{ tr('pform.secretStored') }}</small>
          </label>
          <label class="field">
            <span>{{ tr('pform.dnsMode') }}</span>
            <select v-model="form.dns_mode">
              <option value="local">{{ tr('proxies.dns_local') }}</option>
              <option value="remote">{{ tr('proxies.dns_remote') }}</option>
            </select>
          </label>
          <label class="field">
            <span>{{ tr('pform.connectTimeout') }}</span>
            <input type="number" min="0" max="120000" v-model.number="form.connect_timeout_ms" placeholder="5000" />
          </label>
          <p class="hint tiny wide">{{ tr(`pform.dnsHint_${form.dns_mode || 'local'}`) }}</p>
          <p class="hint tiny wide">{{ tr('pform.connectTimeoutHint') }}</p>
        </div>
      </section>

      <!-- wireguard -->
      <section class="panel" v-if="isTunnel">
        <div class="panel-head"><h3>{{ tr('pform.secTunnel') }}</h3></div>
        <div class="pbody form-grid">
          <label class="field wide">
            <span>{{ tr('pform.wgPrivateKey') }}</span>
            <input type="password" v-model="form.wg_private_key" placeholder="base64" autocomplete="new-password" />
            <small v-if="hasStoredPrivateKey" class="hint tiny">{{ tr('pform.secretStored') }}</small>
          </label>
          <label class="field wide">
            <span>{{ tr('pform.wgPeerPublicKey') }}</span>
            <input v-model="form.wg_peer_public_key" placeholder="base64" autocomplete="off" />
          </label>
          <label class="field wide">
            <span>{{ tr('pform.wgPresharedKey') }}</span>
            <input type="password" v-model="form.wg_preshared_key" :placeholder="tr('pform.optional')" autocomplete="new-password" />
            <small v-if="hasStoredPSK" class="hint tiny">{{ tr('pform.secretStored') }}</small>
          </label>
          <label class="field">
            <span>{{ tr('pform.wgEndpoint') }}</span>
            <input v-model="form.wg_endpoint" placeholder="wg.example.com:51820" />
          </label>
          <label class="field">
            <span>{{ tr('pform.wgMtu') }}</span>
            <input type="number" min="576" max="1500" v-model.number="form.wg_mtu" placeholder="1420" />
          </label>
          <label class="field wide">
            <span>{{ tr('pform.wgAllowedIPs') }}</span>
            <input v-model="form.wg_allowed_ips" placeholder="10.7.0.0/24, 192.168.9.0/24" />
          </label>
          <p class="hint tiny wide">{{ tr('pform.wgAllowedIPsHint') }}</p>
          <label class="field wide">
            <span>{{ tr('pform.wgLocalAddrs') }}</span>
            <input v-model="form.wg_local_addrs" placeholder="10.7.0.2/32" />
          </label>
          <label class="field">
            <span>{{ tr('pform.wgDNS') }}</span>
            <input v-model="form.wg_dns" :placeholder="tr('pform.optional')" />
          </label>
          <label class="field">
            <span>{{ tr('pform.wgKeepalive') }}</span>
            <input type="number" min="0" max="65535" v-model.number="form.wg_keepalive_seconds" placeholder="25" />
          </label>
          <p class="hint tiny wide">{{ tr('pform.wgKeepaliveHint') }}</p>
        </div>
      </section>

      <!-- Pinned monitors, plus the warning for a type change that would strand them -->
      <section class="panel" v-if="editingId && pinned.length">
        <div class="panel-head">
          <h3>{{ tr('pform.usedByTitle') }}</h3>
          <span class="count">{{ pinned.length }}</span>
        </div>
        <p class="hint panel-hint">{{ tr('pform.usedByHint') }}</p>
        <p v-if="strandedByType.length" class="err strand-warn">
          {{ tr('pform.strandWarn', {
            type: tr(`proxies.type_${form.type}`),
            monitors: strandedByType.map((t) => t.name || t.target).join('、'),
          }) }}
        </p>
        <div
          class="table-wrap"
          role="region"
          tabindex="0"
          :aria-label="tr('pform.usedByTitle')"
        >
          <table class="data-table">
            <thead>
              <tr>
                <th>{{ tr('monitoring.thName') }}</th>
                <th>{{ tr('monitoring.thType') }}</th>
                <th>{{ tr('monitoring.thTarget') }}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="t in pinned" :key="t.id">
                <td>{{ t.name || tr('monitoring.unnamed') }}</td>
                <td>{{ tr(`mform.type${t.kind.charAt(0).toUpperCase()}${t.kind.slice(1)}`) }}</td>
                <td class="mono">{{ t.target }}</td>
                <td class="actions">
                  <router-link :to="`/monitoring/${t.id}/edit`" class="link-btn">
                    {{ tr('monitoring.editMonitor') }}
                  </router-link>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <div class="form-foot">
        <router-link to="/proxies" class="btn">{{ tr('pform.cancel') }}</router-link>
        <button class="btn btn-primary" :disabled="busy || !loaded" @click="save">
          {{ busy ? tr('pform.saving') : editingId ? tr('pform.save') : tr('pform.create') }}
        </button>
        <span v-if="saved" class="ok" role="status" aria-live="polite">{{ tr('pform.savedShort') }}</span>
      </div>
      </div>
    </template>
  </main>
</template>

<style scoped>
/* Hallmark · designed-as-app · design-system: design.md · page: Proxy form */
.config-canvas {
  width: min(100%, 1040px);
}
.config-head h2 {
  font-family: var(--font-display);
  letter-spacing: -0.028em;
}
.panel {
  margin-bottom: var(--space-md);
  background: var(--color-glass);
  border-color: var(--color-rule);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-card);
  backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
}
.panel-head {
  min-height: 52px;
  border-bottom-color: var(--color-rule);
}
.panel-head h3 {
  font-family: var(--font-display);
  letter-spacing: -0.018em;
}
.pbody {
  padding: 14px 18px;
}
.panel-hint {
  margin: 0 18px 6px;
  padding-top: 8px;
}
.form-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 12px 16px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  color: var(--text-dim);
}
.field input,
.field select {
  width: 100%;
}
.field.wide {
  grid-column: 1 / -1;
}
.wide {
  grid-column: 1 / -1;
}
.check {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
  font-size: 13px;
  color: var(--text);
}
.check input {
  width: auto;
}
.strand-warn {
  margin: 0 18px 10px;
}
.actions {
  white-space: nowrap;
}
.table-wrap {
  overflow-x: auto;
  overscroll-behavior-inline: contain;
}
.table-wrap:focus-visible {
  outline: var(--rule-fine) solid var(--color-focus);
  outline-offset: calc(-1 * var(--rule-fine));
}
.data-table {
  min-width: 640px;
  font-variant-numeric: tabular-nums;
}
.form-foot {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  position: sticky;
  bottom: var(--space-sm);
  z-index: var(--z-sticky);
  margin: var(--space-sm) 0 var(--space-md);
  padding: var(--space-xs);
  border: var(--rule-hair) solid var(--color-rule);
  border-radius: var(--radius-card);
  background: var(--color-glass-strong);
  box-shadow: var(--shadow-float);
  backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
}

@media (max-width: 768px) {
  .form-grid {
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-sm);
  }
  .field.wide,
  .wide {
    grid-column: auto;
  }
  .pbody,
  .panel-head {
    padding-inline: var(--space-sm);
  }
  .panel-hint {
    margin-inline: var(--space-sm);
  }
  .form-foot {
    position: static;
  }
}

@media (max-width: 414px) {
  .form-foot {
    align-items: stretch;
    flex-direction: column;
  }
  .form-foot .btn {
    width: 100%;
  }
}
</style>

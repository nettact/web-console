<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import {
  api,
  type Agent,
  type AgentPermission,
  type ProcessInfo,
  type ConnectionInfo,
  type HostSnapshot,
  type SnapshotScopeResult,
} from '../api'
import { fmtBytes } from '../lib/format'
import { agentLabel } from '../lib/agentLabel'
import { quickAddQuery } from '../lib/netaddr'
import {
  hasProcessScopes,
  hasConnectionScopes,
} from '../lib/permissions'
import { isDesktopFullAccess, type RemediationCategory } from '../lib/agentPermissions'
import { usePermissionMeta } from '../composables/usePermissionMeta'
import PermissionRemediationDialog from '../components/status/PermissionRemediationDialog.vue'

const { t, te } = useI18n()
const { permLabel } = usePermissionMeta()

// This page shows a live, on-demand snapshot of an agent's processes and network
// connections. Nothing is stored server-side: opening the page asks the agent to
// return its current lists once, and the result is held only in memory. Which
// columns appear depends on which permission SCOPES the agent actually collected.
//
// It only ever asks for scopes the agent can actually serve. Scopes it cannot are
// named from the agent's own permission sets, without a request — an agent that
// serves none of them (the default policy grants no process or connection scope)
// is a page that talks to nobody.
const route = useRoute()
const agents = ref<Agent[]>([])
const selected = ref<string>('')
const agent = ref<Agent | null>(null)
const snapshot = ref<HostSnapshot | null>(null)
const loading = ref(false)
const error = ref('')
// Scopes the agent WAS asked for and did not return data for (a runtime denial,
// an unsupported capability, a failed collection). Scopes it was never asked for
// are `withheld` below — the page knows those are missing before it asks.
const denialScopes = ref<SnapshotScopeResult[]>([])
const sortKey = ref<'cpu' | 'ram' | 'name'>('cpu')
const tab = ref<'processes' | 'connections'>('processes')
type ConnBasis = 'name' | 'pid'
type ConnFilter =
  | { basis: 'name'; name: string }
  | { basis: 'pid'; pid: number; name: string }
const connBasis = ref<ConnBasis>('name')
const connFilter = ref<ConnFilter | null>(null)
let poll: number | undefined

// Every process/connection snapshot scope, in the order the denial list shows
// them. Which of these are actually REQUESTED is decided per agent below — this
// is the desired set, not the asked-for set.
const ALL_SNAPSHOT_SCOPES = [
  'host.process.basic.read',
  'host.process.owner.read',
  'host.process.resource.read',
  'host.process.io.read',
  'host.connection.summary.read',
  'host.connection.local.read',
  'host.connection.remote.read',
  'host.connection.owner.read',
]

const effective = computed(() => agent.value?.effective ?? [])
const effectiveSet = computed(() => new Set(effective.value))
const supportedSet = computed(() => new Set(agent.value?.supported ?? []))
const canProcs = computed(() => hasProcessScopes(effective.value))
const canConns = computed(() => hasConnectionScopes(effective.value))
const permitted = computed(() => canProcs.value || canConns.value)

// What this agent is actually asked for. The page used to request the full
// desired set on purpose, so the response would enumerate every scope the agent
// cannot collect — but that answer only restates what `effective` already says,
// and it costs a request to hear it. Worse, the default agent policy grants no
// process or connection scope at all, so on an ordinary agent EVERY visit fired
// a request whose only possible outcome was a page-long list of denials. Ask for
// what can be collected; everything else is `withheld` and is explained locally.
//
// `effective` is dependency-closed by the server (a child whose base scope is
// not effective is pruned from it), so filtering by it can never produce a
// request that the agent would reject for an unsatisfied dependency.
const requestScopes = computed(() => ALL_SNAPSHOT_SCOPES.filter((s) => effectiveSet.value.has(s)))

// Scopes deliberately not requested, classified from the agent's own permission
// sets: a supported one is one policy grant away, an unsupported one is a
// platform gap no grant fixes.
const withheld = computed<SnapshotScopeResult[]>(() =>
  ALL_SNAPSHOT_SCOPES.filter((s) => !effectiveSet.value.has(s)).map((scope) => ({
    scope,
    status: supportedSet.value.has(scope) ? ('denied' as const) : ('unsupported' as const),
  })),
)

// Every scope this page wanted and did not get, in canonical order: what was
// withheld up front, overridden by whatever the agent actually reported for the
// scopes it WAS asked for.
const unmetScopes = computed<SnapshotScopeResult[]>(() => {
  const byScope = new Map<string, SnapshotScopeResult>()
  for (const sc of withheld.value) byScope.set(sc.scope, sc)
  for (const sc of denialScopes.value) byScope.set(sc.scope, sc)
  return ALL_SNAPSHOT_SCOPES.map((s) => byScope.get(s)).filter((s): s is SnapshotScopeResult => !!s)
})

// The denial panel's list. Empty when the agent serves nothing at all — the
// empty state below is then the whole story, and listing all eight scopes under
// it would just be that story eight more times. That wall on every visit, on
// every agent running the default policy (which grants no process or connection
// scope), is what this page was reporting as an error.
const missingScopes = computed<SnapshotScopeResult[]>(() =>
  permitted.value ? unmetScopes.value : [],
)

// Which permission scopes actually came back with data this round; drives the
// dynamic columns (a granted-but-uncollected scope shows in the denial panel).
const collectedSet = computed(() => {
  const s = new Set<string>()
  for (const sc of snapshot.value?.scopes ?? []) if (sc.status === 'collected') s.add(sc.scope)
  return s
})
const colBasic = computed(() => collectedSet.value.has('host.process.basic.read'))
const colOwner = computed(() => collectedSet.value.has('host.process.owner.read'))
const colResource = computed(() => collectedSet.value.has('host.process.resource.read'))
const colIo = computed(() => collectedSet.value.has('host.process.io.read'))
const colSummary = computed(() => collectedSet.value.has('host.connection.summary.read'))
const colLocal = computed(() => collectedSet.value.has('host.connection.local.read'))
const colRemote = computed(() => collectedSet.value.has('host.connection.remote.read'))
const colConnOwner = computed(() => collectedSet.value.has('host.connection.owner.read'))

const procCols = computed(
  () =>
    (colBasic.value ? 3 : 0) +
    (colOwner.value ? 1 : 0) +
    (colResource.value ? 4 : 0) +
    (colIo.value ? 1 : 0) +
    (colConnOwner.value ? 1 : 0),
)
const connCols = computed(
  () =>
    (colSummary.value ? 2 : 0) +
    (colLocal.value ? 1 : 0) +
    (colRemote.value ? 2 : 0) +
    (colConnOwner.value ? 2 : 0),
)

// Keep the active tab valid for the selected agent's effective scopes.
watch(
  [canProcs, canConns],
  () => {
    if (tab.value === 'processes' && !canProcs.value && canConns.value) tab.value = 'connections'
    else if (tab.value === 'connections' && !canConns.value && canProcs.value) tab.value = 'processes'
  },
  { immediate: true },
)

async function loadAgents() {
  try {
    agents.value = await api.agents()
    const q = String(route.query.agent || '')
    if (q && agents.value.some((a) => a.id === q)) selected.value = q
    else if (!selected.value && agents.value.length) selected.value = agents.value[0].id
  } catch (e) {
    error.value = String((e as Error).message || e)
  }
}

// The agent record carries the permission sets that decide what is even worth
// asking for, so a failure here is not a detail to swallow: without it the page
// asks for nothing and would otherwise render blank with no explanation.
async function refreshAgent() {
  if (!selected.value) return
  try {
    agent.value = await api.agent(selected.value)
    error.value = ''
  } catch (e) {
    agent.value = null
    error.value = String((e as Error).message || e)
  }
}

// The snapshot POST is rejected immediately with `{"error":"agent offline"}`
// (HTTP 409) when the agent has no live connection — surface a localized message.
function snapshotErrMsg(e: unknown): string {
  const msg = String((e as Error).message || e)
  return msg === 'agent offline' ? t('processes.agentOffline') : msg
}

// Ask the agent for a fresh snapshot of the scopes it can serve, then poll briefly
// until it answers. A POST may still return an INLINE DENIAL (request_id null) if
// the agent's policy changed since the console last read it — handle that without
// polling.
// Every refresh — the button, an agent switch, the first load — is one chain:
// read the agent record, ask for a snapshot, then poll for the answer. A chain
// that starts while another is mid-flight must SUPERSEDE it rather than race
// it, and must not be dropped either (an agent switch that got dropped would
// leave the previous agent's data on screen under the new agent's name). `poll`
// holds a single interval id, so two chains both reaching setInterval strand
// one with nothing able to clear it. Each chain therefore takes a ticket and
// abandons itself at the next await the moment a newer ticket exists.
let refreshSeq = 0

async function requestSnapshot(seq: number) {
  stopPoll()
  loading.value = false
  denialScopes.value = []
  snapshot.value = null
  if (!selected.value) return
  // A failed agent read already put its own message on screen, and without the
  // record `requestScopes` is empty — so clearing the error here and returning
  // below would leave a blank page with no explanation and no retry path.
  if (!agent.value) return
  error.value = ''
  const scopes = requestScopes.value
  // Nothing this agent can serve: asking would only have the server hand back the
  // denials `withheld` already names, so the request is not made at all. The
  // empty state explains the gap and offers the fix.
  if (!scopes.length) return
  loading.value = true
  try {
    const res = await api.requestSnapshot(selected.value, scopes)
    if (seq !== refreshSeq) {
      loading.value = false
      return // a newer refresh owns the page now
    }
    if (res.request_id === null) {
      denialScopes.value = (res.scopes || []).filter((s) => s.status !== 'collected')
      loading.value = false
      return
    }
    const request_id = res.request_id
    let tries = 0
    poll = window.setInterval(async () => {
      if (seq !== refreshSeq) {
        stopPoll()
        return
      }
      tries++
      try {
        const r = await api.getSnapshot(selected.value)
        if (r.snapshot && r.snapshot.request_id === request_id) {
          snapshot.value = r.snapshot
          denialScopes.value = r.snapshot.scopes.filter((s) => s.status !== 'collected')
          revalidateConnFilter()
          loading.value = false
          stopPoll()
        } else if (tries > 25) {
          // A short poll only: the agent simply hasn't answered yet (not a denial).
          loading.value = false
          error.value = t('processes.waitTimeout')
          stopPoll()
        }
      } catch (e) {
        error.value = snapshotErrMsg(e)
        loading.value = false
        stopPoll()
      }
    }, 1000)
  } catch (e) {
    error.value = snapshotErrMsg(e)
    loading.value = false
  }
}

function stopPoll() {
  if (poll) {
    clearInterval(poll)
    poll = undefined
  }
}

const processes = computed<ProcessInfo[]>(() => {
  const ps = [...(snapshot.value?.processes || [])]
  ps.sort((a, b) => {
    if (sortKey.value === 'name') return a.name.localeCompare(b.name)
    if (sortKey.value === 'ram') return (b.rss_bytes ?? 0) - (a.rss_bytes ?? 0)
    return (b.cpu_pct ?? 0) - (a.cpu_pct ?? 0)
  })
  return ps
})
const connections = computed<ConnectionInfo[]>(() => snapshot.value?.connections || [])

const filteredConnections = computed<ConnectionInfo[]>(() => {
  const cs = connections.value
  const f = connFilter.value
  if (!f) return cs
  if (f.basis === 'name') return cs.filter((c) => c.process_name === f.name)
  return cs.filter((c) => c.pid === f.pid)
})

const connNameOptions = computed<string[]>(() => {
  const seen = new Set<string>()
  for (const p of snapshot.value?.processes || []) if (p.name) seen.add(p.name)
  for (const c of connections.value) if (c.process_name) seen.add(c.process_name)
  const f = connFilter.value
  if (connBasis.value === 'name' && f && f.basis === 'name' && f.name) seen.add(f.name)
  return [...seen].sort((a, b) => a.localeCompare(b))
})

const connPidOptions = computed<{ pid: number; name: string }[]>(() => {
  const opts: { pid: number; name: string }[] = []
  const seen = new Set<number>()
  for (const p of snapshot.value?.processes || []) {
    if (seen.has(p.pid)) continue
    seen.add(p.pid)
    opts.push({ pid: p.pid, name: p.name })
  }
  for (const c of connections.value) {
    if (c.pid == null || seen.has(c.pid)) continue
    seen.add(c.pid)
    opts.push({ pid: c.pid, name: c.process_name || '' })
  }
  const f = connFilter.value
  if (connBasis.value === 'pid' && f && f.basis === 'pid' && !seen.has(f.pid)) {
    opts.push({ pid: f.pid, name: f.name })
  }
  opts.sort((a, b) => a.name.localeCompare(b.name) || a.pid - b.pid)
  return opts
})

const connNameValue = computed<string>({
  get: () => {
    const f = connFilter.value
    return f && f.basis === 'name' ? f.name : ''
  },
  set: (v) => {
    connFilter.value = v ? { basis: 'name', name: v } : null
  },
})

const connPidValue = computed<string>({
  get: () => {
    const f = connFilter.value
    return f && f.basis === 'pid' ? String(f.pid) : ''
  },
  set: (v) => {
    if (!v) {
      connFilter.value = null
      return
    }
    const pid = Number(v)
    const opt = connPidOptions.value.find((o) => o.pid === pid)
    connFilter.value = { basis: 'pid', pid, name: opt ? opt.name : '' }
  },
})

const connFilterEmptyMsg = computed<string>(() => {
  const f = connFilter.value
  if (!f) return ''
  if (f.basis === 'name') return t('processes.noConnsForName', { name: f.name })
  return t('processes.noConnsForProcess', { name: f.name || '—', pid: f.pid })
})

function setConnBasis(b: ConnBasis) {
  if (connBasis.value === b) return
  connBasis.value = b
  connFilter.value = null
}

function connQuickAdd(c: ConnectionInfo) {
  return quickAddQuery(c.proto, c.remote_addr)
}
function connQuickAddAria(c: ConnectionInfo): string {
  const q = connQuickAdd(c)
  if (!q) return ''
  return q.kind === 'tcp'
    ? t('processes.quickAddTcpAria', { target: q.target, port: q.port })
    : t('processes.quickAddIcmpAria', { target: q.target })
}

function viewConnections(p: ProcessInfo) {
  if (connBasis.value === 'name' && !p.name) connBasis.value = 'pid'
  if (connBasis.value === 'name') connFilter.value = { basis: 'name', name: p.name }
  else connFilter.value = { basis: 'pid', pid: p.pid, name: p.name }
  tab.value = 'connections'
}

function revalidateConnFilter() {
  const f = connFilter.value
  if (!f) return
  const procs = snapshot.value?.processes || []
  const conns = snapshot.value?.connections || []
  if (f.basis === 'name') {
    const exists =
      procs.some((p) => p.name === f.name) || conns.some((c) => c.process_name === f.name)
    if (!exists) connFilter.value = null
  } else {
    const valid =
      procs.some((p) => p.pid === f.pid && p.name === f.name) ||
      conns.some((c) => c.pid === f.pid && (c.process_name || '') === f.name)
    if (!valid) connFilter.value = null
  }
}

function fmtRun(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  return `${h}h ${m}m ${s}s`
}

// Denial panel copy: a headline per scope keyed by why it was withheld, plus a
// sub-line only where one adds something the headline doesn't say. The
// NETTACT_AGENT_PERMISSIONS line deliberately does NOT appear here: it is the
// same several-hundred-character line for every row, and printing it once per
// withheld scope was most of what made this page a wall of text. It belongs in
// the remediation dialog, which shows it once with a copy button and per
// run-mode snippets.
function denyLine(sc: SnapshotScopeResult): string {
  const scope = permLabel(sc.scope)
  if (sc.status === 'denied') return t('processes.denyDenied', { scope })
  if (sc.status === 'unsupported') return t('processes.denyUnsupported', { scope })
  return t('processes.denyFailed', { scope })
}
function denySub(sc: SnapshotScopeResult): string {
  if (sc.status === 'unsupported') return t('processes.unsupportedExplain')
  // Denials and failures carry a stable reason code. Translate the ones we know —
  // an untranslated "rate_limited" in front of an operator explains nothing and
  // reads like a defect. A denial whose reason is just "not granted" says nothing
  // the headline didn't, so it gets no sub-line at all.
  if (!sc.reason) return ''
  const key = `processes.failReason.${sc.reason}`
  if (te(key)) return t(key)
  return sc.status === 'denied' ? '' : sc.reason
}

// --- how do I fix this? ------------------------------------------------------

// A withheld scope is only ever fixed somewhere else: in the agent's local
// permission policy, or not at all (a platform gap). Rather than restate that
// here, hand the scope to the shared remediation dialog — the same one the
// permission chips open — which explains the cause and gives the exact policy
// change per run mode. Without this the page named a permission the reader had
// no path to grant.
const fixScope = ref<{ id: string; category: RemediationCategory } | null>(null)

// The agent's whole permission inventory, loaded when someone asks how to fix
// something. It is the server's answer to "what would grant this", and it is
// read from the AGENT RECORD — nothing here reaches the agent itself, which is
// the point: the page must be able to explain a missing permission without
// making a request that can only come back denied.
//
// Re-read on every open rather than cached per agent: granting a permission
// means editing the policy and restarting the agent, and someone who did that
// and came back to this dialog must not be shown the policy they already
// replaced.
const inventory = ref<AgentPermission[]>([])

async function loadInventory() {
  const id = selected.value
  if (!id) return
  // Cleared BEFORE the request, not on success: this dialog's whole promise is
  // that it never shows a policy the operator has already replaced, and keeping
  // the previous inventory alive across the reload — or across its failure —
  // breaks exactly that. A stale line can omit grants added since, so pasting
  // it would revoke them; the generic fallback is the safer answer.
  inventory.value = []
  try {
    const inv = await api.agentPermissions(id)
    // Guard against a slow response landing after the agent picker moved on.
    if (selected.value === id) inventory.value = inv.permissions
  } catch {
    // The dialog falls back to a generic instruction. A missing line is a worse
    // answer than the line, not a broken page.
  }
}

// One `NETTACT_AGENT_PERMISSIONS=…` line that grants every scope this page is
// missing, so a single paste and restart makes the whole page work rather than
// one column of it.
//
// Every value in it is server-computed: the inventory carries, per ungranted
// permission, the dependency-closed line that grants THAT one, and this unions
// those values. A union of dependency-closed sets is itself closed, so the
// console still never works out a closure of its own — it only picks which of
// the server's answers to combine, and orders the result by the inventory's own
// canonical order.
const fixEnv = computed<string | undefined>(() => {
  const want = new Set(unmetScopes.value.filter((s) => s.status === 'denied').map((s) => s.scope))
  if (!want.size) return undefined
  let prefix = ''
  const union = new Set<string>()
  for (const p of inventory.value) {
    if (!want.has(p.id) || !p.permissions_env) continue
    const eq = p.permissions_env.indexOf('=')
    if (eq < 0) continue
    prefix = p.permissions_env.slice(0, eq + 1)
    for (const v of p.permissions_env.slice(eq + 1).split(',')) {
      const id = v.trim()
      if (id) union.add(id)
    }
  }
  if (!prefix) return undefined
  return prefix + inventory.value.map((p) => p.id).filter((id) => union.has(id)).join(',')
})

// Which scopes this page can offer a fix for. A runtime failure is not one of
// them: nothing in the permission policy changes it.
function fixable(sc: SnapshotScopeResult): boolean {
  return sc.status === 'denied' || sc.status === 'unsupported'
}

// What the empty state's single "how to fix" opens: the first unmet scope in
// canonical order, which is the base process scope unless the agent cannot do
// processes at all. Picking it from the live list rather than hard-coding one
// keeps the dialog from claiming a permission problem where the real answer is
// "this platform can't".
const primaryFix = computed<SnapshotScopeResult>(
  () =>
    unmetScopes.value.find(fixable) ??
    unmetScopes.value[0] ?? { scope: ALL_SNAPSHOT_SCOPES[0], status: 'denied' },
)

function openFix(sc: SnapshotScopeResult): void {
  fixScope.value = {
    id: sc.scope,
    category: sc.status === 'unsupported' ? 'unsupported' : 'permission_blocked',
  }
  void loadInventory()
}
// The agent whose policy the dialog is about to describe: an embedded desktop
// agent has a fixed FullAccess policy, so the env/YAML instructions never apply.
const fixDesktop = computed(() => isDesktopFullAccess(agent.value?.policy_source))

async function onAgentChange() {
  connFilter.value = null
  // The inventory is per agent; drop the previous one so a "how to fix" click
  // cannot show the old agent's policy line while the new one loads.
  inventory.value = []
  await refreshNow()
}

// The refresh button is also the "I applied the fix" button. Granting a scope
// means editing the agent's policy and restarting it, and the record this page
// loaded still describes the policy from before that — so refreshing against it
// would keep requesting the old subset, or request nothing at all and look
// broken. Re-read the record first; the button therefore stays enabled even
// when the agent currently serves nothing, because re-checking is precisely
// what an operator who just granted something needs it to do — and stays
// enabled after a failed read, which is when retrying matters most.
async function refreshNow() {
  const seq = ++refreshSeq
  await refreshAgent()
  if (seq !== refreshSeq) return
  await requestSnapshot(seq)
}

onMounted(async () => {
  await loadAgents()
  await refreshNow()
})
onBeforeUnmount(stopPoll)
</script>

<template>
  <main class="page data-workbench" aria-labelledby="processes-title">
    <div class="page-head workbench-head">
      <div class="head-copy">
        <h2 id="processes-title">{{ t('processes.title') }}</h2>
        <p class="hint sub">{{ t('processes.sub') }}</p>
      </div>
      <span class="spacer"></span>
      <div class="picker" v-if="agents.length">
        <label>Agent</label>
        <select v-model="selected" @change="onAgentChange">
          <option v-for="a in agents" :key="a.id" :value="a.id">
            {{ agentLabel(a) }} ({{ a.platform }}) — {{ a.status }}
          </option>
        </select>
        <button class="btn" :disabled="loading || !selected" @click="refreshNow">
          {{ loading ? t('processes.fetching') : t('processes.refreshSnapshot') }}
        </button>
      </div>
    </div>

    <p v-if="error" class="err" role="alert">{{ error }}</p>

    <!-- Scopes the agent did not collect this round. Only rendered for a PARTIAL
         grant; when it serves none of them the empty state below says so once. -->
    <div v-if="missingScopes.length" class="card denial">
      <h4>{{ t('processes.denialTitle') }}</h4>
      <p class="hint">{{ t('processes.denialIntro') }}</p>
      <ul class="deny-list">
        <li v-for="sc in missingScopes" :key="sc.scope">
          <span class="deny-head">{{ denyLine(sc) }}</span>
          <span v-if="denySub(sc)" class="deny-sub">{{ denySub(sc) }}</span>
          <button v-if="fixable(sc)" type="button" class="link-btn deny-fix" @click="openFix(sc)">
            {{ t('processes.howToFix') }} →
          </button>
        </li>
      </ul>
    </div>

    <div v-if="!permitted && agent" class="card empty">
      <h3>{{ t('processes.noPermTitle') }}</h3>
      <p class="hint">{{ t('processes.noPermHint') }}</p>
      <button type="button" class="btn btn-primary" @click="openFix(primaryFix)">
        {{ t('processes.howToFix') }}
      </button>
    </div>

    <template v-if="permitted">
      <div class="tabs workbench-tabs" role="tablist" :aria-label="t('processes.title')">
        <button
          v-if="canProcs"
          id="processes-tab-processes"
          class="tab"
          role="tab"
          :class="{ active: tab === 'processes' }"
          :aria-selected="tab === 'processes'"
          :tabindex="tab === 'processes' ? 0 : -1"
          aria-controls="processes-panel-processes"
          @click="tab = 'processes'"
        >
          {{ t('processes.tabProcesses') }}
          <span class="count">{{ snapshot?.process_total ?? processes.length }}</span>
        </button>
        <button
          v-if="canConns"
          id="processes-tab-connections"
          class="tab"
          role="tab"
          :class="{ active: tab === 'connections' }"
          :aria-selected="tab === 'connections'"
          :tabindex="tab === 'connections' ? 0 : -1"
          aria-controls="processes-panel-connections"
          @click="tab = 'connections'"
        >
          {{ t('processes.tabConnections') }}
          <span class="count">{{ connections.length }}</span>
        </button>
      </div>

      <!-- processes -->
      <section
        id="processes-panel-processes"
        class="panel table-sheet"
        v-if="canProcs"
        v-show="tab === 'processes'"
        role="tabpanel"
        aria-labelledby="processes-tab-processes"
      >
        <div class="panel-head">
          <span class="spacer"></span>
          <div class="sort" v-if="colResource">
            <label>{{ t('processes.sortLabel') }}</label>
            <select v-model="sortKey">
              <option value="cpu">CPU</option>
              <option value="ram">{{ t('processes.sortRam') }}</option>
              <option value="name">{{ t('processes.sortName') }}</option>
            </select>
          </div>
        </div>
        <div class="table-wrap" role="region" tabindex="0" :aria-label="t('processes.tabProcesses')">
          <table class="data-table">
            <thead>
              <tr>
                <th v-if="colBasic">{{ t('processes.thProcName') }}</th>
                <th v-if="colBasic">PID</th>
                <th v-if="colBasic">{{ t('processes.thStatus') }}</th>
                <th v-if="colOwner">{{ t('processes.thUser') }}</th>
                <th class="num" v-if="colResource">CPU %</th>
                <th class="num" v-if="colResource">{{ t('processes.thMem') }}</th>
                <th class="num" v-if="colResource">{{ t('processes.thVirt') }}</th>
                <th class="num" v-if="colResource">{{ t('processes.thRuntime') }}</th>
                <th class="num" v-if="colIo">{{ t('processes.thDisk') }}</th>
                <th v-if="colConnOwner"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="loading && !processes.length"><td :colspan="procCols || 1" class="hint">{{ t('processes.waitingAgent') }}</td></tr>
              <tr v-else-if="!processes.length"><td :colspan="procCols || 1" class="hint">{{ t('common.noData') }}</td></tr>
              <tr v-for="p in processes" :key="p.pid">
                <td class="mono" v-if="colBasic">{{ p.name }}</td>
                <td class="mono" v-if="colBasic">{{ p.pid }}</td>
                <td v-if="colBasic">{{ p.status || '—' }}</td>
                <td class="mono dim" v-if="colOwner">{{ p.user || '—' }}</td>
                <td class="num" v-if="colResource">{{ p.cpu_pct != null ? p.cpu_pct.toFixed(1) : '—' }}</td>
                <td class="num" v-if="colResource">{{ p.rss_bytes != null ? fmtBytes(p.rss_bytes) : '—' }}</td>
                <td class="num dim" v-if="colResource">{{ p.virt_bytes != null ? fmtBytes(p.virt_bytes) : '—' }}</td>
                <td class="num dim" v-if="colResource">{{ p.run_time_seconds != null ? fmtRun(p.run_time_seconds) : '—' }}</td>
                <td class="num dim" v-if="colIo">{{ p.disk_read_bytes != null ? fmtBytes(p.disk_read_bytes) : '—' }} / {{ p.disk_write_bytes != null ? fmtBytes(p.disk_write_bytes) : '—' }}</td>
                <td v-if="colConnOwner" class="num">
                  <button
                    class="link-btn"
                    :aria-label="t('processes.viewConnsAria', { name: p.name, pid: p.pid })"
                    @click="viewConnections(p)"
                  >
                    {{ t('processes.viewConns') }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- connections -->
      <section
        id="processes-panel-connections"
        class="panel table-sheet"
        v-if="canConns"
        v-show="tab === 'connections'"
        role="tabpanel"
        aria-labelledby="processes-tab-connections"
      >
        <div class="panel-head">
          <div class="basis" v-if="colConnOwner" role="group" :aria-label="t('processes.connBasisLabel')">
            <span class="basis-label">{{ t('processes.connBasisLabel') }}</span>
            <button
              type="button"
              class="seg"
              :class="{ active: connBasis === 'name' }"
              :aria-pressed="connBasis === 'name'"
              @click="setConnBasis('name')"
            >
              {{ t('processes.connBasisName') }}
            </button>
            <button
              type="button"
              class="seg"
              :class="{ active: connBasis === 'pid' }"
              :aria-pressed="connBasis === 'pid'"
              @click="setConnBasis('pid')"
            >
              {{ t('processes.connBasisPid') }}
            </button>
          </div>
          <span class="spacer"></span>
          <div class="sort" v-if="colConnOwner">
            <label for="conn-filter">{{ t('processes.connFilterLabel') }}</label>
            <select v-if="connBasis === 'name'" id="conn-filter" v-model="connNameValue">
              <option value="">{{ t('processes.connFilterAll') }}</option>
              <option v-for="n in connNameOptions" :key="n" :value="n">{{ n }}</option>
            </select>
            <select v-else id="conn-filter" v-model="connPidValue">
              <option value="">{{ t('processes.connFilterAll') }}</option>
              <option v-for="o in connPidOptions" :key="o.pid" :value="String(o.pid)">
                {{ o.name || '—' }} ({{ o.pid }})
              </option>
            </select>
          </div>
        </div>
        <div class="table-wrap" role="region" tabindex="0" :aria-label="t('processes.tabConnections')">
          <table class="data-table">
            <thead>
              <tr>
                <th v-if="colSummary">{{ t('processes.thProto') }}</th>
                <th v-if="colLocal">{{ t('processes.thLocalAddr') }}</th>
                <th v-if="colRemote">{{ t('processes.thRemoteAddr') }}</th>
                <th v-if="colSummary">{{ t('processes.thStatus') }}</th>
                <th v-if="colConnOwner">PID</th>
                <th v-if="colConnOwner">{{ t('processes.thProcess') }}</th>
                <th v-if="colRemote"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="loading && !connections.length"><td :colspan="connCols || 1" class="hint">{{ t('processes.waitingAgent') }}</td></tr>
              <tr v-else-if="connFilter && !filteredConnections.length">
                <td :colspan="connCols || 1" class="hint">
                  {{ connFilterEmptyMsg }}
                  <button class="link-btn" @click="connFilter = null">{{ t('processes.clearFilter') }}</button>
                </td>
              </tr>
              <tr v-else-if="!connections.length"><td :colspan="connCols || 1" class="hint">{{ t('common.noData') }}</td></tr>
              <tr v-for="(c, i) in filteredConnections" :key="i">
                <td class="mono" v-if="colSummary">{{ c.proto }}</td>
                <td class="mono" v-if="colLocal">{{ c.local_addr || '—' }}</td>
                <td class="mono dim" v-if="colRemote">{{ c.remote_addr || '—' }}</td>
                <td v-if="colSummary">{{ c.state || '—' }}</td>
                <td class="mono" v-if="colConnOwner">{{ c.pid || '—' }}</td>
                <td class="mono dim" v-if="colConnOwner">{{ c.process_name || '—' }}</td>
                <td class="num" v-if="colRemote">
                  <RouterLink
                    v-if="connQuickAdd(c)"
                    class="link-btn"
                    :to="{ path: '/monitoring/new', query: connQuickAdd(c)! }"
                    :aria-label="connQuickAddAria(c)"
                  >
                    {{ t('processes.quickAdd') }}
                  </RouterLink>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
    <PermissionRemediationDialog
      :open="!!fixScope"
      :perm-id="fixScope?.id || ''"
      :category="fixScope?.category || 'permission_blocked'"
      :permissions-env="fixEnv"
      :desktop="fixDesktop"
      @close="fixScope = null"
    />
  </main>
</template>

<style scoped>
/* Hallmark · designed-as-app · design-system: design.md · page: Processes */
.data-workbench {
  font-variant-numeric: tabular-nums;
}
.workbench-head {
  align-items: flex-start;
}
.head-copy {
  min-width: 0;
}
.workbench-head h2 {
  font-family: var(--font-display);
  letter-spacing: -0.028em;
}
.picker {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  padding: var(--space-2xs);
  border: var(--rule-hair) solid var(--color-rule);
  border-radius: var(--radius-input);
  background: var(--color-glass);
  backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
}
.picker select {
  min-width: 0;
  max-width: min(42vw, 420px);
}
.picker label,
.sort label {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
}
.head-copy .sub {
  margin: var(--space-2xs) 0 0;
}
.denial {
  padding: var(--space-sm);
  margin-bottom: var(--space-sm);
  border-color: var(--color-warning);
  background: var(--color-glass-subtle);
  box-shadow: none;
}
.denial h4 {
  margin: 0 0 4px;
  font-size: 14px;
}
.deny-list {
  margin: 8px 0 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.deny-head {
  display: block;
  font-size: 13px;
  color: var(--text);
}
.deny-sub {
  display: block;
  font-size: 12px;
  color: var(--text-dim);
  margin-top: 2px;
}
.deny-fix {
  display: inline-block;
  margin-top: 3px;
  font-size: 12px;
}
.empty .btn {
  margin-top: var(--space-sm);
}
.tabs {
  display: flex;
  gap: 6px;
  width: fit-content;
  max-width: 100%;
  margin-bottom: var(--space-sm);
  padding: var(--space-3xs);
  overflow-x: auto;
  border: var(--rule-hair) solid var(--color-rule);
  border-radius: var(--radius-input);
  background: var(--color-glass-strong);
  box-shadow: var(--shadow-card);
  backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  scrollbar-width: none;
}
.tabs::-webkit-scrollbar { display: none; }
.tab {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  padding: var(--space-2xs) var(--space-sm);
  border: none;
  background: transparent;
  color: var(--color-muted);
  border-radius: var(--radius-xs);
  font-size: var(--text-sm);
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition:
    color var(--dur-micro) var(--ease-out),
    background-color var(--dur-micro) var(--ease-out),
    transform var(--dur-micro) var(--ease-out);
}
.tab:hover,
.tab:focus-visible {
  color: var(--color-ink);
  background: var(--color-glass-hover);
}
.tab.active {
  color: var(--color-ink);
  background: var(--color-glass-hover);
  box-shadow: inset 0 0 0 var(--rule-hair) var(--color-rule-2);
}
.tab:focus-visible {
  outline: var(--rule-fine) solid var(--color-focus);
  outline-offset: var(--space-3xs);
}
.tab:active {
  transform: translateY(1px);
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
.table-sheet {
  background: var(--color-glass-strong);
  border-color: var(--color-rule);
  border-radius: var(--radius-panel);
  box-shadow: var(--shadow-card);
  backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
}
.table-sheet .data-table {
  min-width: 820px;
}
.table-sheet .panel-head {
  min-height: 56px;
  border-bottom-color: var(--color-rule);
}
.data-table thead th {
  background: var(--color-glass-subtle);
}
.data-table tbody tr:focus-within td {
  background: var(--color-glass-hover);
}
.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.dim {
  color: var(--text-muted);
}
.count {
  min-width: 22px;
  padding: 1px 9px;
  border-radius: var(--radius-pill);
  font-size: 12px;
  font-weight: 600;
  color: var(--text-dim);
  background: var(--surface-2);
  border: 1px solid var(--border);
  text-align: center;
}
.sort {
  display: flex;
  align-items: center;
  gap: 8px;
}
.basis {
  display: flex;
  align-items: center;
  gap: 8px;
}
.basis-label {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
}
.seg {
  padding: 4px 12px;
  min-height: 44px;
  border: var(--rule-hair) solid var(--color-rule);
  background: var(--color-glass-subtle);
  color: var(--color-muted);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.seg:first-of-type {
  border-radius: var(--radius-sm) 0 0 var(--radius-sm);
}
.seg:last-of-type {
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  border-left: none;
}
.seg:hover {
  color: var(--color-ink);
}
.seg.active {
  color: var(--color-accent-text);
  border-color: var(--color-accent);
  background: var(--color-glass-hover);
}
.seg:focus-visible {
  outline: var(--rule-fine) solid var(--color-focus);
  outline-offset: var(--space-3xs);
}
.panel-head {
  flex-wrap: wrap;
}
.sort select {
  max-width: 100%;
}
.link-btn {
  border: none;
  background: transparent;
  color: var(--color-accent-text);
  font: inherit;
  padding: 0;
  cursor: pointer;
}
.link-btn:hover {
  text-decoration: underline;
}
.empty {
  text-align: center;
  padding: var(--space-xl) var(--space-md);
}

@media (max-width: 768px) {
  .workbench-head {
    align-items: stretch;
  }
  .picker {
    width: 100%;
    flex-wrap: wrap;
  }
  .picker select {
    flex: 1 1 220px;
    max-width: none;
  }
  .panel-head {
    align-items: stretch;
    flex-direction: column;
  }
  .panel-head .spacer {
    display: none;
  }
  .sort,
  .basis {
    width: 100%;
    flex-wrap: wrap;
  }
  .sort select {
    flex: 1 1 180px;
  }
}

@media (max-width: 414px) {
  .picker .btn {
    width: 100%;
  }
  .workbench-tabs {
    width: 100%;
  }
  .workbench-tabs .tab {
    flex: 1 0 auto;
  }
  .basis-label,
  .sort label {
    flex-basis: 100%;
  }
  .seg {
    flex: 1;
  }
}
</style>

<script setup lang="ts">
// Create/edit a monitor group: its name, incident-merge policy, shared Agent
// execution scope (all agents, or selected existing agent groups), the static
// list of member targets, and the notification policy its targets fall under.
// The default group may be edited but never deleted (its invariant is shown).
// The notification policy is only offered once the group exists, because an
// override policy is scoped by the group's id.
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import {
  api,
  type AgentGroup,
  type Channel,
  type MonitorGroup,
  type MonitorGroupInput,
  type NotificationPolicy,
  type NotificationPolicyInput,
  type ProbeTarget,
} from '../api'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import PolicyFields from '../components/PolicyFields.vue'
import { typeLabel, targetLabel } from '../lib/targetLabels'

const { t: tr } = useI18n()
const route = useRoute()
const router = useRouter()

const SITE = 'site_default'
const editingId = computed(() => (route.params.id as string) || '')

interface Form {
  name: string
  merge_enabled: boolean
  all_agents: boolean
  agent_group_ids: string[]
}
const form = reactive<Form>({ name: '', merge_enabled: true, all_agents: true, agent_group_ids: [] })
// The last-loaded server state, to detect a merge/scope semantic change on save.
const original = ref<Form | null>(null)

const group = ref<MonitorGroup | null>(null)
const agentGroups = ref<AgentGroup[]>([])
const targets = ref<ProbeTarget[]>([])
const channels = ref<Channel[]>([])

const error = ref('')
const saved = ref(false)
const busy = ref(false)
const notFound = ref(false)

const isDefault = computed(() => group.value?.is_default === true)
const members = computed(() => targets.value.filter((t) => t.id && t.group_id === editingId.value))

const scope = computed<'all' | 'groups'>({
  get: () => (form.all_agents ? 'all' : 'groups'),
  set: (v) => {
    form.all_agents = v === 'all'
  },
})
function toggleAgentGroup(id: string) {
  const i = form.agent_group_ids.indexOf(id)
  if (i >= 0) form.agent_group_ids.splice(i, 1)
  else form.agent_group_ids.push(id)
}

function payload(): MonitorGroupInput {
  return {
    name: form.name.trim(),
    merge_enabled: form.merge_enabled,
    all_agents: form.all_agents,
    agent_group_ids: form.all_agents ? [] : [...form.agent_group_ids],
  }
}

// ---- notification policy ----
// Detection is unconditional; this only decides whether/when/where a recorded
// fault is announced. A group either inherits the site default or owns exactly
// one override — precedence never stacks.
const sitePolicy = ref<NotificationPolicy | null>(null)
const groupPolicy = ref<NotificationPolicy | null>(null)
const policyMode = ref<'default' | 'override'>('default')
const policyDraft = ref<NotificationPolicyInput>(seedDraft())

function seedDraft(): NotificationPolicyInput {
  // A fresh override starts as a copy of whatever governs the group today, so
  // switching to "override" changes nothing until the user edits a field.
  const base = groupPolicy.value ?? sitePolicy.value
  return {
    name: groupPolicy.value?.name || tr('mgroup.policyDraftName', { name: form.name || tr('mgroup.name') }),
    scope_kind: 'group',
    scope_id: editingId.value,
    enabled: base?.enabled ?? true,
    min_severity: base?.min_severity || 'warn',
    warn_delay_sec: base?.warn_delay_sec ?? 0,
    critical_delay_sec: base?.critical_delay_sec ?? 0,
    notify_recovery: base?.notify_recovery ?? true,
    channel_ids: [...(base?.channel_ids ?? [])],
  }
}

async function loadPolicies() {
  const list = await api.notificationPolicies(SITE)
  sitePolicy.value = list.find((p) => p.is_default) ?? null
  groupPolicy.value = list.find((p) => p.scope_kind === 'group' && p.scope_id === editingId.value) ?? null
  policyMode.value = groupPolicy.value ? 'override' : 'default'
  policyDraft.value = seedDraft()
}

async function savePolicy() {
  if (!editingId.value) return
  if (policyMode.value === 'override') {
    const body: NotificationPolicyInput = {
      ...policyDraft.value,
      scope_kind: 'group',
      scope_id: editingId.value,
      name: policyDraft.value.name.trim() || form.name.trim(),
    }
    if (groupPolicy.value) await api.updateNotificationPolicy(groupPolicy.value.id, body)
    else await api.createNotificationPolicy(SITE, body)
    return
  }
  // Back to inheriting: the override must go, or it would keep winning.
  if (groupPolicy.value) await api.deleteNotificationPolicy(groupPolicy.value.id)
}

function channelsLabel(ids: string[]): string {
  if (!ids.length) return tr('notificationPolicy.recordOnlyShort')
  return ids.map((id) => channels.value.find((c) => c.id === id)?.name || id).join(', ')
}
function delayLabel(sec: number): string {
  if (!sec) return tr('notificationPolicy.delayImmediate')
  if (sec % 60 === 0) return tr('common.durMinutes', { n: sec / 60 })
  return tr('common.durSeconds', { n: sec })
}

async function load() {
  error.value = ''
  try {
    ;[agentGroups.value, targets.value, channels.value] = await Promise.all([
      api.agentGroups(SITE),
      api.listTargets(SITE),
      api.channels(),
    ])
  } catch (e) {
    error.value = String((e as Error).message || e)
    return
  }
  targets.value.forEach((t) => {
    if (!t.params) t.params = {}
  })
  if (editingId.value) {
    let groups: MonitorGroup[]
    try {
      groups = await api.monitorGroups(SITE)
    } catch (e) {
      error.value = String((e as Error).message || e)
      return
    }
    const g = groups.find((x) => x.id === editingId.value)
    if (!g) {
      notFound.value = true
      return
    }
    group.value = g
    form.name = g.name
    form.merge_enabled = g.merge_enabled
    form.all_agents = g.all_agents
    form.agent_group_ids = [...g.agent_group_ids]
    original.value = { name: g.name, merge_enabled: g.merge_enabled, all_agents: g.all_agents, agent_group_ids: [...g.agent_group_ids] }
    try {
      await loadPolicies()
    } catch (e) {
      error.value = String((e as Error).message || e)
    }
  }
}

// A merge flip or a scope change terminates the group's active alerts/incidents
// as configuration changes and re-evaluates under the new policy; only these
// need an explicit confirmation (a rename does not).
function semanticChanged(): boolean {
  const o = original.value
  if (!o) return false
  if (o.merge_enabled !== form.merge_enabled) return true
  if (o.all_agents !== form.all_agents) return true
  const a = [...o.agent_group_ids].sort().join(',')
  const b = [...form.agent_group_ids].sort().join(',')
  return a !== b
}

const showConfigConfirm = ref(false)

async function save() {
  saved.value = false
  error.value = ''
  if (!form.name.trim()) {
    error.value = tr('mgroup.errNameRequired')
    return
  }
  if (!editingId.value) {
    await doCreate()
    return
  }
  if (semanticChanged()) {
    showConfigConfirm.value = true
    return
  }
  await doUpdate()
}

async function doCreate() {
  busy.value = true
  try {
    const { id } = await api.createMonitorGroup(SITE, payload())
    // Move to the edit route; the id watcher reloads with policy/members enabled.
    router.replace(`/monitoring/groups/${id}/edit`)
  } catch (e) {
    error.value = String((e as Error).message || e)
  } finally {
    busy.value = false
  }
}

async function doUpdate() {
  showConfigConfirm.value = false
  busy.value = true
  try {
    await api.updateMonitorGroup(editingId.value, payload())
    await savePolicy()
    saved.value = true
    await load()
  } catch (e) {
    error.value = String((e as Error).message || e)
  } finally {
    busy.value = false
  }
}

// ---- delete group ----
const showDeleteGroup = ref(false)
async function confirmDeleteGroup() {
  busy.value = true
  error.value = ''
  try {
    await api.deleteMonitorGroup(editingId.value)
    router.push('/monitoring')
  } catch (e) {
    error.value = String((e as Error).message || e)
    showDeleteGroup.value = false
  } finally {
    busy.value = false
  }
}

// Reload when the route id changes (create → edit) or on first mount.
watch(editingId, () => {
  notFound.value = false
  saved.value = false
  load()
})
onMounted(load)
</script>

<template>
  <main class="page config-page" aria-labelledby="monitor-group-form-title">
    <div class="page-head config-head">
      <h2 id="monitor-group-form-title">{{ editingId ? tr('mgroup.editTitle') : tr('mgroup.newTitle') }}</h2>
      <p class="sub">{{ tr('mgroup.sub') }}</p>
    </div>
    <p v-if="error" class="err" role="alert">{{ error }}</p>

    <p v-if="notFound" class="hint">
      {{ tr('mgroup.notFound') }}
      <router-link to="/monitoring">{{ tr('mgroup.back') }}</router-link>
    </p>

    <template v-else>
      <div class="config-canvas">
      <!-- General -->
      <section class="panel">
        <div class="panel-head">
          <h3>{{ tr('mgroup.secGeneral') }}</h3>
          <span v-if="isDefault" class="badge neutral def-badge">{{ tr('mgroup.defaultBadge') }}</span>
        </div>
        <div class="pbody">
          <label class="field">
            <span>{{ tr('mgroup.name') }}</span>
            <input v-model="form.name" :placeholder="tr('mgroup.namePlaceholder')" />
          </label>
          <p v-if="isDefault" class="hint tiny">{{ tr('mgroup.defaultInvariant') }}</p>

          <fieldset class="merge">
            <legend>{{ tr('mgroup.merge') }}</legend>
            <label class="check">
              <input type="checkbox" v-model="form.merge_enabled" />
              <span>{{ tr('mgroup.mergeToggle') }}</span>
            </label>
            <p class="hint tiny">{{ form.merge_enabled ? tr('mgroup.mergeOnHint') : tr('mgroup.mergeOffHint') }}</p>
          </fieldset>
        </div>
      </section>

      <!-- Shared Agent scope -->
      <section class="panel">
        <div class="panel-head"><h3>{{ tr('mgroup.secScope') }}</h3></div>
        <p class="hint panel-hint">{{ tr('mgroup.scopeHint') }}</p>
        <div class="pbody">
          <label class="scope-opt">
            <input type="radio" value="all" v-model="scope" />
            <span>{{ tr('mgroup.scopeAll') }}</span>
          </label>
          <label class="scope-opt">
            <input type="radio" value="groups" v-model="scope" />
            <span>{{ tr('mgroup.scopeGroups') }}</span>
          </label>
          <div v-if="scope === 'groups'" class="group-pick">
            <p v-if="!agentGroups.length" class="hint tiny">
              {{ tr('mgroup.noAgentGroups') }}
              <router-link to="/agents">{{ tr('mgroup.manageAgentGroups') }}</router-link>
            </p>
            <label v-for="g in agentGroups" :key="g.id" class="group-chip">
              <input
                type="checkbox"
                :checked="form.agent_group_ids.includes(g.id)"
                @change="toggleAgentGroup(g.id)"
              />
              <span>{{ g.name }}</span>
              <em>{{ tr('mform.groupAgentCount', { n: g.agent_ids.length }) }}</em>
            </label>
            <p v-if="agentGroups.length && !form.agent_group_ids.length" class="hint tiny warn">
              {{ tr('mgroup.scopeEmptyWarn') }}
            </p>
          </div>
        </div>
      </section>

      <!-- Notification policy: inherit the site default, or override for this group.
           Saved together with the group. -->
      <section class="panel" v-if="editingId">
        <div class="panel-head"><h3>{{ tr('mgroup.policyTitle') }}</h3></div>
        <p class="hint panel-hint">{{ tr('mgroup.policyHint') }}</p>
        <div class="pbody">
          <label class="scope-opt">
            <input type="radio" value="default" v-model="policyMode" />
            <span>{{ tr('mgroup.policyUseSite') }}</span>
          </label>
          <label class="scope-opt">
            <input type="radio" value="override" v-model="policyMode" />
            <span>{{ tr('mgroup.policyOverride') }}</span>
          </label>

          <div v-if="policyMode === 'default'" class="policy-view">
            <p v-if="!sitePolicy" class="hint tiny">{{ tr('mgroup.policySiteMissing') }}</p>
            <template v-else>
              <div class="sum-row">
                <span class="sum-k">{{ tr('notificationPolicy.name') }}</span>
                <span class="sum-v">
                  {{ sitePolicy.name }}
                  <em v-if="!sitePolicy.enabled" class="off">{{ tr('notificationPolicy.stateDisabled') }}</em>
                </span>
              </div>
              <div class="sum-row">
                <span class="sum-k">{{ tr('notificationPolicy.minSeverity') }}</span>
                <span class="sum-v">{{ tr(`mform.sev_${sitePolicy.min_severity}`) }}</span>
              </div>
              <div class="sum-row">
                <span class="sum-k">{{ tr('notificationPolicy.warnDelay') }}</span>
                <span class="sum-v">{{ delayLabel(sitePolicy.warn_delay_sec) }}</span>
              </div>
              <div class="sum-row">
                <span class="sum-k">{{ tr('notificationPolicy.criticalDelay') }}</span>
                <span class="sum-v">{{ delayLabel(sitePolicy.critical_delay_sec) }}</span>
              </div>
              <div class="sum-row">
                <span class="sum-k">{{ tr('notificationPolicy.notifyRecovery') }}</span>
                <span class="sum-v">
                  {{ sitePolicy.notify_recovery ? tr('notificationPolicy.yes') : tr('notificationPolicy.no') }}
                </span>
              </div>
              <div class="sum-row">
                <span class="sum-k">{{ tr('notificationPolicy.channels') }}</span>
                <span class="sum-v" :class="{ 'record-only': !sitePolicy.channel_ids.length }">
                  {{ channelsLabel(sitePolicy.channel_ids) }}
                </span>
              </div>
              <p class="hint tiny">
                {{ tr('mgroup.policyEditSiteHint') }}
                <router-link to="/settings">{{ tr('mgroup.policyGoSettings') }}</router-link>
              </p>
            </template>
          </div>

          <div v-else class="policy-edit">
            <PolicyFields v-model="policyDraft" scope="group" :channels="channels" />
            <p class="hint tiny">{{ tr('mgroup.policyOverrideSaveHint') }}</p>
          </div>
        </div>
      </section>

      <div class="form-foot">
        <router-link to="/monitoring" class="btn">{{ tr('mgroup.cancel') }}</router-link>
        <button class="btn btn-primary" :disabled="busy" @click="save">
          {{ busy ? tr('mgroup.saving') : editingId ? tr('mgroup.save') : tr('mgroup.create') }}
        </button>
        <button
          v-if="editingId && !isDefault"
          class="btn btn-danger"
          :disabled="busy"
          @click="showDeleteGroup = true"
        >
          {{ tr('mgroup.deleteGroup') }}
        </button>
        <span v-if="saved" class="ok" role="status" aria-live="polite">{{ tr('mgroup.saved') }}</span>
      </div>

      <!-- Members (static target context) -->
      <section class="panel" v-if="editingId">
        <div class="panel-head">
          <h3>{{ tr('mgroup.membersTitle') }}</h3>
          <span class="count">{{ members.length }}</span>
          <router-link :to="`/monitoring/new?group=${editingId}`" class="btn head-btn">
            {{ tr('mgroup.addTarget') }}
          </router-link>
        </div>
        <p class="hint panel-hint">{{ tr('mgroup.membersHint') }}</p>
        <div
          class="table-wrap"
          v-if="members.length"
          role="region"
          tabindex="0"
          :aria-label="tr('mgroup.membersTitle')"
        >
          <table class="data-table">
            <thead>
              <tr>
                <th>{{ tr('monitoring.thName') }}</th>
                <th>{{ tr('monitoring.thType') }}</th>
                <th>{{ tr('monitoring.thTarget') }}</th>
                <th class="center">{{ tr('monitoring.thEnabled') }}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="t in members" :key="t.id">
                <td>{{ t.name || tr('monitoring.unnamed') }}</td>
                <td>{{ typeLabel(t, tr) }}</td>
                <td class="mono">
                  {{ targetLabel(t, tr) }}<span v-if="t.kind === 'tcp' && t.params?.port">:{{ t.params.port }}</span>
                </td>
                <td class="center"><span :class="['dot', t.enabled ? 'up' : '']"></span></td>
                <td class="actions">
                  <router-link :to="`/monitoring/${t.id}/edit`" class="link-btn">{{ tr('monitoring.editMonitor') }}</router-link>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-else class="hint tiny pbody-hint">{{ tr('mgroup.noMembers') }}</p>
      </section>

      <p v-if="!editingId" class="hint save-first">{{ tr('mgroup.saveGroupFirst') }}</p>
      </div>
    </template>

    <!-- Confirmations -->
    <ConfirmDialog
      :open="showConfigConfirm"
      :title="tr('mgroup.configChangeTitle')"
      :message="[tr('mgroup.configChangeBody1'), tr('mgroup.configChangeBody2')]"
      :confirm-label="tr('mgroup.configChangeConfirm')"
      :cancel-label="tr('mgroup.cancel')"
      :busy="busy"
      tone="danger"
      @confirm="doUpdate"
      @cancel="showConfigConfirm = false"
    />
    <ConfirmDialog
      :open="showDeleteGroup"
      :title="tr('mgroup.deleteGroupTitle', { name: form.name })"
      :message="[tr('mgroup.deleteGroupBody1'), tr('mgroup.deleteGroupBody2')]"
      :confirm-label="tr('mgroup.deleteGroup')"
      :cancel-label="tr('mgroup.cancel')"
      :busy="busy"
      tone="danger"
      @confirm="confirmDeleteGroup"
      @cancel="showDeleteGroup = false"
    />
  </main>
</template>

<style scoped>
/* Hallmark · designed-as-app · design-system: design.md · page: Monitor group form */
.config-canvas {
  width: 100%;
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
.pbody-hint {
  padding: 0 18px 16px;
}
.panel-hint {
  margin: 0 18px 6px;
  padding-top: 8px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  color: var(--text-dim);
  max-width: 420px;
}
.field input {
  width: 100%;
}
.def-badge {
  margin-left: auto;
}
.merge {
  margin: 16px 0 0;
  padding: 0;
  border: none;
}
.merge legend {
  font-size: 13px;
  color: var(--text-dim);
  padding: 0;
  margin-bottom: 6px;
}
.check {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text);
}
.check input {
  width: auto;
}
.scope-opt {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  margin: 4px 0;
}
.scope-opt input {
  width: auto;
}
.group-pick {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed var(--border);
}
.group-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  padding: 4px 8px;
  min-height: 44px;
  border: var(--rule-hair) solid var(--color-rule);
  border-radius: var(--radius-input);
  background: var(--color-glass-subtle);
}
.group-chip:has(input:focus-visible) {
  outline: var(--rule-fine) solid var(--color-focus);
  outline-offset: var(--space-3xs);
}
.group-chip input {
  width: auto;
}
.group-chip em {
  font-style: normal;
  color: var(--text-dim);
  font-size: 11px;
}
.policy-view,
.policy-edit {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px dashed var(--border);
}
.sum-row {
  display: flex;
  gap: 12px;
  align-items: baseline;
  padding: 3px 0;
  font-size: 13px;
}
.sum-k {
  flex: none;
  min-width: 132px;
  color: var(--text-dim);
}
.sum-v {
  color: var(--text);
}
.sum-v.record-only {
  color: var(--text-dim);
}
.sum-v .off {
  margin-left: 8px;
  font-style: normal;
  font-size: 11.5px;
  color: var(--color-warning-text);
}
.tiny {
  font-size: 11.5px;
  margin: 4px 0 0;
}
.tiny.warn {
  color: var(--color-warning-text);
}
.head-btn {
  margin-left: auto;
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
.table-wrap {
  overflow-x: auto;
}
.table-wrap:focus-visible {
  outline: var(--rule-fine) solid var(--color-focus);
  outline-offset: calc(-1 * var(--rule-fine));
}
.data-table {
  min-width: 640px;
}
.mono {
  font-family: var(--mono);
  font-size: 12.5px;
}
.actions {
  text-align: right;
}
.dot {
  display: inline-block;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--border);
}
.form-foot {
  display: flex;
  align-items: center;
  gap: 12px;
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
.save-first {
  margin-top: 4px;
}

@media (max-width: 768px) {
  .pbody,
  .panel-head {
    padding-inline: var(--space-sm);
  }
  .panel-hint {
    margin-inline: var(--space-sm);
  }
  .sum-row {
    align-items: flex-start;
    flex-direction: column;
    gap: var(--space-3xs);
  }
  .sum-k {
    min-width: 0;
  }
  .table-wrap {
    overscroll-behavior-inline: contain;
  }
  .form-foot {
    position: static;
  }
}

@media (max-width: 414px) {
  .field {
    max-width: none;
  }
  .form-foot {
    align-items: stretch;
    flex-direction: column;
  }
  .form-foot .btn {
    width: 100%;
  }
  .head-btn {
    width: 100%;
    margin-left: 0;
  }
}
</style>

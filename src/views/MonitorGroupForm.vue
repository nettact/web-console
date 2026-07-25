<script setup lang="ts">
// Create/edit a monitor group: its name, incident-merge policy, shared Agent
// execution scope (all agents, or selected existing agent groups), the static
// list of member targets, and its one-layer AND/OR group rules. The default group
// may be edited but never deleted (its invariant is shown). Rules and members are
// only available once the group exists (mirrors the target form's save-first
// flow), because a condition must bind to an in-group target.
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import {
  api,
  type AgentGroup,
  type Channel,
  type GroupRule,
  type GroupRuleInput,
  type MonitorGroup,
  type MonitorGroupInput,
  type ProbeTarget,
} from '../api'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import GroupRuleEditor from '../components/GroupRuleEditor.vue'
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
const rules = ref<GroupRule[]>([])
const draftRule = ref<GroupRule | null>(null)

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
    await loadRules()
  }
}

async function loadRules() {
  if (!editingId.value) return
  rules.value = await api.groupRules(editingId.value)
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
    // Move to the edit route; the id watcher reloads with rules/members enabled.
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
    saved.value = true
    await load()
  } catch (e) {
    error.value = String((e as Error).message || e)
  } finally {
    busy.value = false
  }
}

// ---- rules ----
function addRule() {
  draftRule.value = {
    id: '',
    group_id: editingId.value,
    site_id: '',
    name: '',
    op: 'and',
    layer: 'internet',
    severity: 'warn',
    channel_ids: [],
    enabled: true,
    conditions: [],
  }
}
async function saveNewRule(input: GroupRuleInput) {
  busy.value = true
  error.value = ''
  try {
    await api.createGroupRule(editingId.value, input)
    draftRule.value = null
    await loadRules()
  } catch (e) {
    error.value = String((e as Error).message || e)
  } finally {
    busy.value = false
  }
}
async function saveExistingRule(id: string, input: GroupRuleInput) {
  busy.value = true
  error.value = ''
  try {
    await api.updateGroupRule(id, input)
    await loadRules()
  } catch (e) {
    error.value = String((e as Error).message || e)
  } finally {
    busy.value = false
  }
}

const pendingDeleteRule = ref<GroupRule | null>(null)
async function confirmDeleteRule() {
  const r = pendingDeleteRule.value
  if (!r) return
  busy.value = true
  error.value = ''
  try {
    await api.deleteGroupRule(r.id)
    pendingDeleteRule.value = null
    await loadRules()
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
  draftRule.value = null
  load()
})
onMounted(load)
</script>

<template>
  <main class="page">
    <div class="page-head">
      <h2>{{ editingId ? tr('mgroup.editTitle') : tr('mgroup.newTitle') }}</h2>
      <p class="sub">{{ tr('mgroup.sub') }}</p>
    </div>
    <p v-if="error" class="err">{{ error }}</p>

    <p v-if="notFound" class="hint">
      {{ tr('mgroup.notFound') }}
      <router-link to="/monitoring">{{ tr('mgroup.back') }}</router-link>
    </p>

    <template v-else>
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
        <span v-if="saved" class="ok">{{ tr('mgroup.saved') }}</span>
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
        <div class="table-wrap" v-if="members.length">
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

      <!-- Group rules (one-layer AND/OR) -->
      <section class="panel" v-if="editingId">
        <div class="panel-head"><h3>{{ tr('mgroup.rulesTitle') }}</h3></div>
        <p class="hint panel-hint">{{ tr('mgroup.rulesHint') }}</p>
        <div class="pbody">
          <p v-if="!members.length" class="hint tiny">{{ tr('mgroup.addMembersForRules') }}</p>
          <template v-else>
            <button v-if="!draftRule" class="link-btn" @click="addRule">{{ tr('mgroup.addRule') }}</button>
            <p v-if="!rules.length && !draftRule" class="hint tiny">{{ tr('mgroup.noRules') }}</p>

            <GroupRuleEditor
              v-for="r in rules"
              :key="r.id"
              :rule="r"
              :members="members"
              :channels="channels"
              :busy="busy"
              @save="saveExistingRule(r.id, $event)"
              @remove="pendingDeleteRule = r"
            />
            <GroupRuleEditor
              v-if="draftRule"
              :rule="draftRule"
              :members="members"
              :channels="channels"
              :busy="busy"
              @save="saveNewRule"
              @cancel="draftRule = null"
            />
          </template>
        </div>
      </section>

      <p v-if="!editingId" class="hint save-first">{{ tr('mgroup.saveGroupFirst') }}</p>
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
      :open="!!pendingDeleteRule"
      :title="tr('mgroup.ruleDeleteTitle')"
      :message="[tr('mgroup.ruleDeleteBody1'), tr('mgroup.ruleDeleteBody2')]"
      :confirm-label="tr('common.delete')"
      :cancel-label="tr('mgroup.cancel')"
      :busy="busy"
      tone="danger"
      @confirm="confirmDeleteRule"
      @cancel="pendingDeleteRule = null"
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
.panel {
  margin-bottom: 18px;
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
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface);
}
.group-chip input {
  width: auto;
}
.group-chip em {
  font-style: normal;
  color: var(--text-dim);
  font-size: 11px;
}
.tiny {
  font-size: 11.5px;
  margin: 4px 0 0;
}
.tiny.warn {
  color: var(--warning);
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
  padding: 4px 0 20px;
}
.save-first {
  margin-top: 4px;
}
</style>

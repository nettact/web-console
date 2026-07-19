<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import TargetStatusHistory from '../components/status/TargetStatusHistory.vue'
import MonitorStateBadge from '../components/status/MonitorStateBadge.vue'
import { targetIndex, targetStatus } from '../targetStatus'

const route = useRoute()
const { t } = useI18n()

const targetID = computed(() => String(route.params.targetId || ''))
const agentID = computed(() => String(route.params.agentId || ''))
const target = computed(() => targetIndex.value.get(targetID.value))
const agent = computed(() => target.value?.agents.find((item) => item.agent_id === agentID.value))
const backLocation = computed(() => ({
  path: '/target-status',
  query: { target: targetID.value, agent: agentID.value },
}))
</script>

<template>
  <main class="page target-history-page">
    <router-link class="back-link" :to="backLocation">← {{ t('targetStatus.backToStatus') }}</router-link>

    <div v-if="!targetStatus.loaded && !targetStatus.error" class="card page-message">
      {{ t('targetStatus.loading') }}
    </div>
    <div v-else-if="targetStatus.error" class="err" role="alert">
      {{ t('targetStatus.errorBanner') }} {{ targetStatus.error }}
    </div>
    <div v-else-if="!target || !agent" class="card page-message invalid">
      <h2>{{ t('targetStatus.historyNotFound') }}</h2>
      <p>{{ t('targetStatus.historyNotFoundHint') }}</p>
      <router-link class="btn btn-primary" to="/target-status">{{ t('targetStatus.backToStatus') }}</router-link>
    </div>
    <template v-else>
      <header class="page-head history-head">
        <div>
          <p class="eyebrow">{{ t('targetStatus.historyPageEyebrow') }}</p>
          <h1>{{ target.name || t('targetStatus.unnamedTarget') }}</h1>
          <p class="sub">{{ target.kind.toUpperCase() }} · {{ target.target }}</p>
        </div>
        <div class="agent-context">
          <span class="online-dot" :class="agent.agent_online ? 'online' : 'offline'"></span>
          <div>
            <strong>{{ agent.agent_name || agent.agent_id }}</strong>
            <small>{{ agent.agent_id }}</small>
          </div>
          <MonitorStateBadge dim="execution" :state="agent.execution_state" />
          <MonitorStateBadge v-if="agent.probe_state !== 'not_applicable'" dim="probe" :state="agent.probe_state" />
          <MonitorStateBadge dim="rule" :state="agent.rule_state" />
        </div>
      </header>

      <TargetStatusHistory :target="target" :agent-id="agentID" />
    </template>
  </main>
</template>

<style scoped>
.target-history-page { max-width: 1240px; }
.back-link { display: inline-block; margin-bottom: 15px; color: var(--primary); font-size: 12px; text-decoration: none; }
.history-head { align-items: flex-end; margin-bottom: 20px; }
.history-head > div:first-child { min-width: 0; }
.eyebrow { margin: 0 0 5px; color: var(--primary); font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; }
.history-head h1 { margin: 0; }
.history-head .sub { margin-top: 6px; font-family: var(--mono); }
.agent-context { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); }
.agent-context > div { display: flex; flex-direction: column; margin-right: 7px; }
.agent-context strong { font-size: 12.5px; }
.agent-context small { margin-top: 3px; color: var(--text-muted); font-family: var(--mono); font-size: 9.5px; }
.online-dot { width: 8px; height: 8px; border-radius: 50%; }
.online-dot.online { background: var(--success); }
.online-dot.offline { background: var(--text-muted); }
.page-message { padding: 40px 20px; color: var(--text-muted); text-align: center; }
.page-message h2 { margin-top: 0; color: var(--text); }
.page-message p { margin-bottom: 18px; }

@media (max-width: 760px) {
  .target-history-page { padding-left: 14px; padding-right: 14px; }
  .history-head { align-items: flex-start; }
  .agent-context { flex-basis: 100%; flex-wrap: wrap; }
}
</style>

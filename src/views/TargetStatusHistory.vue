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
const rangeSec = computed(() => ({
  '3h': 3 * 3600,
  '24h': 24 * 3600,
  '7d': 7 * 86400,
  '30d': 30 * 86400,
  '90d': 90 * 86400,
})[targetStatus.requestedTimeRange])
const backLocation = computed(() => ({
  path: '/target-status',
  query: { target: targetID.value, agent: agentID.value },
}))
</script>

<template>
  <main class="page">
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
          <MonitorStateBadge dim="fault" :state="agent.fault_state" />
        </div>
      </header>

      <TargetStatusHistory :target="target" :agent-id="agentID" :range-sec="rangeSec" />
    </template>
  </main>
</template>

<style scoped>
/* Hallmark · genre: custom application · macrostructure: Workbench · design-system: design.md · designed-as-app
 * pre-emit critique: P5 H5 E4 S4 R5 V4
 */
.back-link {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  margin-bottom: var(--space-sm);
  color: var(--color-accent-text);
  font-size: var(--text-sm);
  text-decoration: none;
  white-space: nowrap;
}

.back-link:focus-visible {
  outline: var(--rule-fine) solid var(--color-focus);
  outline-offset: var(--space-3xs);
  border-radius: var(--radius-xs);
}

.history-head {
  align-items: flex-end;
  margin-bottom: var(--space-md);
}

.history-head > div:first-child {
  min-width: 0;
  flex: 1;
}

.eyebrow {
  margin: 0 0 var(--space-2xs);
  color: var(--color-accent-text);
  font-family: var(--font-outlier);
  font-size: var(--text-xs);
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.history-head h1 {
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
  font-family: var(--font-display);
  letter-spacing: -0.028em;
  font-style: normal;
}

.history-head .sub {
  margin-top: var(--space-2xs);
  font-family: var(--font-outlier);
  font-variant-numeric: tabular-nums;
}

.agent-context {
  display: flex;
  align-items: center;
  gap: var(--space-2xs);
  max-width: 100%;
  padding: var(--space-xs) var(--space-sm);
  border: var(--rule-hair) solid var(--color-rule);
  border-radius: var(--radius-card);
  background: var(--color-glass);
  box-shadow: var(--shadow-card);
  backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
}

.agent-context > div {
  display: flex;
  min-width: 0;
  flex-direction: column;
  margin-right: var(--space-2xs);
}

.agent-context strong {
  overflow: hidden;
  font-size: var(--text-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-context small {
  margin-top: var(--space-3xs);
  overflow: hidden;
  color: var(--color-muted);
  font-family: var(--font-outlier);
  font-size: var(--text-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.online-dot {
  width: 8px;
  height: 8px;
  flex: 0 0 auto;
  border-radius: var(--radius-pill);
}

.online-dot.online {
  background: var(--color-success);
}

.online-dot.offline {
  background: var(--color-neutral);
}

.page-message {
  padding: var(--space-xl) var(--space-md);
  border: var(--rule-hair) solid var(--color-rule);
  background: var(--color-paper-2);
  color: var(--color-muted);
  text-align: center;
}

.page-message h2 {
  margin-top: 0;
  color: var(--color-ink);
  font-family: var(--font-display);
  font-style: normal;
}

.page-message p {
  margin-bottom: var(--space-sm);
}

@media (max-width: 768px) {
  .history-head {
    align-items: flex-start;
  }

  .agent-context {
    flex-basis: 100%;
    flex-wrap: wrap;
  }
}

@media (max-width: 414px) {
  .agent-context {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
  }

  .agent-context :deep(.badge) {
    justify-self: start;
    grid-column: 2;
  }
}
</style>

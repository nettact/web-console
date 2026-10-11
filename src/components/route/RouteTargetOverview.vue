<script setup lang="ts">
// Overview of one route monitor on the status page: one row per Agent with its
// route state, current AS path, how long that path has held, latency and reach,
// and when it last changed — then the newest changes across all Agents. Nothing
// here is availability: a route monitor answers "which way does traffic go, and
// has that moved", so there is no uptime figure to show.
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { RouteTargetView } from '../../lib/routeStatus'
import { fmtMs, fmtRatio } from '../../lib/routePath'
import { useRouteFormat } from '../../composables/useRouteFormat'
import ASPathChain from './ASPathChain.vue'
import RouteStateBadge from './RouteStateBadge.vue'
import RouteChangeTimeline from './RouteChangeTimeline.vue'

const props = defineProps<{
  view: RouteTargetView
  now: number
}>()
const emit = defineEmits<{
  openChanges: []
  openPath: [agentId: string]
}>()

const { t } = useI18n()
const { fmtTime, since } = useRouteFormat()

const PREVIEW = 5
// Re-fetch the preview when any Agent reports a newer change.
const refreshKey = computed(() =>
  props.view.agents.map((row) => row.agent.last_change_at ?? '').sort().pop() ?? '',
)
</script>

<template>
  <section class="route-target-overview">
    <div class="route-facts">
      <div>
        <span>{{ t('route.overview.state') }}</span>
        <RouteStateBadge :state="view.state" />
      </div>
      <div>
        <span>{{ t('route.overview.changes24h') }}</span>
        <strong>{{ view.changes24h }}</strong>
      </div>
      <div>
        <span>{{ t('route.overview.changes7d') }}</span>
        <strong>{{ view.changes7d }}</strong>
      </div>
      <div>
        <span>{{ t('route.overview.lastRun') }}</span>
        <strong class="small">{{ fmtTime(view.lastRunAt) }}</strong>
      </div>
    </div>

    <section class="route-agents">
      <h4>{{ t('route.overview.agentsTitle') }}</h4>
      <div v-if="!view.summary" class="quiet">
        <span>{{ t('route.overview.summaryLoading') }}</span>
      </div>
      <div v-else-if="!view.agents.length" class="quiet">
        <strong>{{ t('route.noAgents') }}</strong>
      </div>
      <div v-else class="route-agent-list">
        <article v-for="row in view.agents" :key="row.agent.agent_id" class="route-agent-row">
          <div class="agent-head">
            <strong>{{ row.agent.agent_name || row.agent.agent_id }}</strong>
            <RouteStateBadge :state="row.state" />
          </div>
          <div class="agent-path">
            <ASPathChain v-if="row.agent.current_since" :path="row.agent.as_path" compact />
            <span v-else class="hint tiny">{{ t(`route.stateHint.${row.state}`) }}</span>
          </div>
          <dl class="agent-facts">
            <div><dt>{{ t('route.stableFor') }}</dt><dd>{{ row.agent.current_since ? since(row.agent.current_since, now) : '—' }}</dd></div>
            <div><dt>{{ t('route.rttP50') }}</dt><dd>{{ fmtMs(row.agent.rtt_p50_ms) }}</dd></div>
            <div><dt>{{ t('route.reach') }}</dt><dd>{{ fmtRatio(row.agent.reached_ratio) }}</dd></div>
            <div>
              <dt>{{ t('route.lastChange') }}</dt>
              <dd>
                <time v-if="row.agent.last_change_at" :datetime="row.agent.last_change_at" :title="fmtTime(row.agent.last_change_at)">
                  {{ t('route.ago', { span: since(row.agent.last_change_at, now) }) }}
                </time>
                <template v-else>{{ t('route.noChangeYet') }}</template>
              </dd>
            </div>
          </dl>
          <button
            v-if="row.agent.current_since"
            type="button"
            class="text-action"
            @click="emit('openPath', row.agent.agent_id)"
          >
            {{ t('route.overview.viewHops') }}
          </button>
        </article>
      </div>
    </section>

    <section class="route-recent">
      <div class="recent-head">
        <h4>{{ t('route.overview.recentChanges') }}</h4>
        <button type="button" class="text-action" @click="emit('openChanges')">{{ t('route.overview.allChanges') }}</button>
      </div>
      <RouteChangeTimeline
        :target-id="view.target.target_id"
        :page-size="PREVIEW"
        :paged="false"
        show-agent
        preview
        :refresh-key="refreshKey"
      />
    </section>
  </section>
</template>

<style scoped>
.route-target-overview,
.route-agents,
.route-recent {
  display: grid;
  gap: var(--space-sm);
  min-width: 0;
}
.route-agents h4,
.route-recent h4 {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--text-md);
}
.route-facts {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  border: var(--rule-hair) solid var(--color-rule);
  border-radius: var(--radius-input);
  background: var(--color-glass);
}
.route-facts > div {
  display: grid;
  align-content: center;
  justify-items: start;
  gap: var(--space-2xs);
  min-height: 80px;
  padding: var(--space-xs);
  border-right: var(--rule-hair) solid var(--color-rule);
}
.route-facts > div:last-child {
  border-right: 0;
}
.route-facts span {
  color: var(--color-muted);
  font-size: var(--text-xs);
}
.route-facts strong {
  font-family: var(--font-outlier);
  font-size: var(--text-lg);
  font-variant-numeric: tabular-nums;
}
.route-facts strong.small {
  font-size: var(--text-sm);
}
.route-agent-list {
  display: grid;
  border-top: var(--rule-hair) solid var(--color-rule);
}
.route-agent-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--space-2xs) var(--space-xs);
  padding-block: var(--space-xs);
  border-bottom: var(--rule-hair) solid var(--color-rule);
}
.agent-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2xs);
  min-width: 0;
}
.agent-head strong {
  font-size: var(--text-sm);
  overflow-wrap: anywhere;
}
.agent-path,
.agent-facts {
  grid-column: 1 / -1;
  min-width: 0;
}
.route-agent-row .text-action {
  grid-column: 2;
  grid-row: 1;
}
.agent-facts {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 22px;
  margin: 0;
}
.agent-facts > div {
  display: flex;
  gap: 8px;
  font-size: var(--text-xs);
}
.agent-facts dt {
  color: var(--color-muted);
}
.agent-facts dd {
  margin: 0;
  color: var(--color-ink-2);
  font-variant-numeric: tabular-nums;
}
.recent-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-xs);
}
.text-action {
  min-height: 44px;
  padding-inline: var(--space-2xs);
  border: 0;
  color: var(--color-accent-text);
  background: transparent;
  cursor: pointer;
  white-space: nowrap;
}
.text-action:focus-visible {
  outline: var(--rule-fine) solid var(--color-focus);
  outline-offset: calc(var(--rule-fine) * -1);
}
.quiet {
  display: grid;
  gap: var(--space-3xs);
  padding: var(--space-sm);
  border: var(--rule-hair) solid var(--color-rule);
  border-radius: var(--radius-input);
  background: var(--color-paper-2);
  color: var(--color-muted);
  font-size: var(--text-xs);
}
.quiet strong {
  color: var(--color-ink);
  font-size: var(--text-sm);
}
@media (hover: hover) and (pointer: fine) {
  .text-action:hover {
    background: var(--color-glass-hover);
  }
}
@media (max-width: 768px) {
  .route-facts {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .route-facts > div:nth-child(2) {
    border-right: 0;
  }
  .route-facts > div:nth-child(-n + 2) {
    border-bottom: var(--rule-hair) solid var(--color-rule);
  }
}
</style>

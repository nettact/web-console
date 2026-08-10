<script setup lang="ts">
// Incident scene evidence (INCIDENT-005): the frozen server base facts, plus
// every scene an Agent collected on its own fault edges and the server has
// claimed for this incident. Renders only typed, allowlisted payload fields — it
// never assumes or displays process, user, path or credential content. Field-
// group outcomes are shown as text (not colour alone), with clock-skew,
// truncation and evidence-expired states surfaced explicitly.
//
// There is no collection status to show. The Agent decides and delivers through
// its outbox, so a scene has either arrived or has not — and "has not" during an
// outage is the ordinary case, not a failure, which is what the empty state says.
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { SnapshotView, SceneEntry, SceneTriggerView } from '../../api'
import { useIncidentLabels, statusTone } from '../../composables/useIncidentLabels'
import { fmtBytes } from '../../lib/format'
import { toDateLocale } from '../../i18n'

const props = defineProps<{ snapshot: SnapshotView | null; evidenceExpired: boolean }>()

const { t, locale } = useI18n()
const {
  groupStatusLabel,
  fieldGroupLabel,
  snapReasonLabel,
  errorClassLabel,
  sceneTriggerLabel,
  sceneDisconnectReasonLabel,
} = useIncidentLabels()

const fmtDateTime = (s: string | null) =>
  s ? new Date(s).toLocaleString(toDateLocale(locale.value), { hour12: false }) : '—'
const base = computed(() => props.snapshot?.base ?? null)
const scenes = computed(() => props.snapshot?.scenes ?? [])
const aheadSeconds = (e: SceneEntry) => Math.abs(e.delivery_lag_ms / 1000).toFixed(1)
// A scene that waited in the Agent's outbox is the ordinary case during an
// outage, so the wait is stated as a fact and not as a warning. Below a minute
// it is not worth a line at all.
const LAG_WORTH_SAYING_MS = 60_000
const lagMinutes = (e: SceneEntry) => Math.round(e.delivery_lag_ms / 60_000)
const cpuPct = (v?: number) => (v == null ? '—' : `${v.toFixed(0)}%`)

// One trigger in a sentence: what the Agent saw that made it look around.
const triggerText = (g: SceneTriggerView) => {
  if (g.kind === 'server_disconnect') {
    const why = g.reason ? sceneDisconnectReasonLabel(g.reason) : ''
    return (g.edge_count ?? 1) > 1
      ? t('incidents.snap.triggerDisconnectRepeated', { reason: why, n: g.edge_count })
      : t('incidents.snap.triggerDisconnect', { reason: why })
  }
  return t('incidents.snap.triggerProbeFault', { n: g.trigger_streak ?? 0 })
}
const triggerKey = (e: SceneEntry, g: SceneTriggerView, i: number) =>
  `${e.report_id}:${g.kind}:${g.monitor_id ?? ''}:${i}`
</script>

<template>
  <section class="snap" aria-labelledby="snap-h">
    <div class="sec-head">
      <h4 id="snap-h">{{ t('incidents.snap.title') }}</h4>
    </div>

    <p v-if="!snapshot" class="hint">{{ t('incidents.snap.none') }}</p>
    <template v-else>
      <!-- Cross-cutting notices: truncation and evidence expiry. -->
      <p v-if="snapshot.truncated" class="notice warn" role="note">
        {{ t('incidents.snap.truncated') }}
      </p>
      <p v-if="evidenceExpired" class="notice" role="note">{{ t('incidents.snap.expired') }}</p>

      <!-- Frozen server base facts. -->
      <div v-if="base" class="card sub">
        <h5>{{ t('incidents.snap.baseTitle') }}</h5>
        <dl class="facts">
          <div><dt>{{ t('incidents.snap.frozenAt') }}</dt><dd>{{ fmtDateTime(base.triggered_at) }}</dd></div>
          <div><dt>{{ t('incidents.snap.receivedAt') }}</dt><dd>{{ fmtDateTime(base.received_at) }}</dd></div>
        </dl>

        <div v-if="base.agents.length" class="grp">
          <span class="grp-label">{{ t('incidents.snap.frozenAgents') }}</span>
          <ul class="plain agent-list">
            <li v-for="a in base.agents" :key="a.agent_id">
              <b>{{ a.name || a.hostname || a.agent_id }}</b>
              <span class="hint"> · {{ a.platform || '—' }} · {{ a.agent_version || '—' }}</span>
            </li>
          </ul>
        </div>
        <div v-if="base.targets.length" class="grp">
          <span class="grp-label">{{ t('incidents.snap.frozenTargets') }}</span>
          <ul class="plain target-list">
            <li v-for="tg in base.targets" :key="tg.monitor_id">
              <span class="badge neutral">{{ tg.kind || '—' }}</span>
              <span class="mono"> {{ tg.target || '—' }}<template v-if="tg.port">:{{ tg.port }}</template></span>
            </li>
          </ul>
        </div>
      </div>

      <!-- Agent-collected scenes. -->
      <p v-if="!scenes.length" class="hint">{{ t('incidents.snap.noScenes') }}</p>
      <div v-for="e in scenes" :key="e.report_id" class="card sub entry">
        <div class="entry-head">
          <b>{{ e.agent_name || e.agent_id }}</b>
          <span v-for="(g, i) in e.triggers" :key="triggerKey(e, g, i)" class="badge neutral">
            {{ sceneTriggerLabel(g.kind) }}
          </span>
        </div>
        <ul class="plain trigger-list">
          <li v-for="(g, i) in e.triggers" :key="triggerKey(e, g, i)" class="hint">{{ triggerText(g) }}</li>
        </ul>
        <p v-if="e.clock_ahead" class="notice warn small" role="note">
          {{ t('incidents.snap.clockAhead', { s: aheadSeconds(e) }) }}
        </p>
        <p v-else-if="e.delivery_lag_ms >= LAG_WORTH_SAYING_MS" class="hint small-note">
          {{ t('incidents.snap.queuedFor', { n: lagMinutes(e) }) }}
        </p>
        <p v-if="e.truncated" class="notice warn small" role="note">
          {{ t('incidents.snap.truncated') }}
        </p>
        <dl class="facts">
          <div><dt>{{ t('incidents.snap.collectedAt') }}</dt><dd>{{ fmtDateTime(e.collected_at) }}</dd></div>
          <div><dt>{{ t('incidents.snap.receivedAt') }}</dt><dd>{{ fmtDateTime(e.received_at) }}</dd></div>
        </dl>

        <!-- Per-field-group collection outcome. -->
        <div v-if="e.payload && e.payload.groups.length" class="grp">
          <span class="grp-label">{{ t('incidents.snap.groups') }}</span>
          <ul class="grp-status">
            <li v-for="g in e.payload.groups" :key="g.group">
              <span class="field">{{ fieldGroupLabel(g.group) }}</span>
              <span class="badge" :class="statusTone(g.status === 'collected' ? 'complete' : g.status === 'failed' ? 'failed' : 'partial')">
                {{ groupStatusLabel(g.status) }}
              </span>
              <span v-if="g.reason" class="hint">{{ snapReasonLabel(g.reason) }}</span>
            </li>
          </ul>
        </div>

        <!-- Typed allowlisted payload (network / agent / resources / targets). -->
        <template v-if="e.payload">
          <div v-if="e.payload.network" class="grp">
            <span class="grp-label">{{ t('incidents.snap.group.network') }}</span>
            <div v-if="e.payload.network.default_route" class="hint network-line">
              <span>{{ t('incidents.snap.defaultRoute') }}:</span>
              <span class="network-value">
                <span class="mono">{{ e.payload.network.default_route.gateway || '—' }}</span>
                <template v-if="e.payload.network.default_route.interface">
                  · {{ e.payload.network.default_route.interface }}
                </template>
              </span>
            </div>
            <div v-if="e.payload.network.dns_servers?.length" class="hint network-line">
              <span>DNS:</span>
              <span class="mono network-value">{{ e.payload.network.dns_servers.join(', ') }}</span>
            </div>
            <ul v-if="e.payload.network.interfaces?.length" class="plain interface-list">
              <li v-for="iface in e.payload.network.interfaces" :key="iface.name">
                <span class="badge" :class="iface.up ? 'ok' : 'open'">
                  {{ iface.up ? t('incidents.snap.ifaceUp') : t('incidents.snap.ifaceDown') }}
                </span>
                <b class="interface-name">{{ iface.name }}</b>
                <span v-if="iface.is_wireless" class="badge neutral">{{ t('incidents.snap.wireless') }}</span>
                <span v-if="iface.addrs?.length" class="mono hint interface-addrs">
                  {{ iface.addrs.join(', ') }}
                </span>
              </li>
            </ul>
          </div>

          <div v-if="e.payload.agent" class="grp">
            <span class="grp-label">{{ t('incidents.snap.group.agent') }}</span>
            <span class="hint">
              {{ e.payload.agent.hostname || '—' }} · {{ e.payload.agent.platform || '—' }} ·
              {{ e.payload.agent.agent_version || '—' }}
            </span>
          </div>

          <div v-if="e.payload.resources" class="grp">
            <span class="grp-label">{{ t('incidents.snap.group.resources') }}</span>
            <span class="hint">
              CPU {{ cpuPct(e.payload.resources.cpu_percent) }} ·
              {{ t('incidents.snap.memory') }}
              {{ fmtBytes(e.payload.resources.memory_used_bytes) }} /
              {{ fmtBytes(e.payload.resources.memory_total_bytes) }}
            </span>
          </div>

          <div v-if="e.payload.targets?.length" class="grp">
            <span class="grp-label">{{ t('incidents.snap.group.targets') }}</span>
            <div class="table-scroll">
              <table class="mini-table">
              <thead>
                <tr>
                  <th>{{ t('incidents.snap.thTarget') }}</th>
                  <th>{{ t('incidents.snap.thResolved') }}</th>
                  <th>{{ t('incidents.snap.thEndpoints') }}</th>
                  <th>{{ t('incidents.snap.thErrorClass') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="tg in e.payload.targets" :key="tg.monitor_id">
                  <td class="mono">{{ tg.target || tg.monitor_id }}</td>
                  <td class="mono">{{ tg.resolved_ips?.join(', ') || '—' }}</td>
                  <td class="mono">{{ tg.endpoints?.join(', ') || '—' }}</td>
                  <td>{{ tg.error_class ? errorClassLabel(tg.error_class) : '—' }}</td>
                </tr>
              </tbody>
              </table>
            </div>
          </div>
        </template>
      </div>
    </template>
  </section>
</template>

<style scoped>
/* Hallmark · component: incident scene evidence · genre: custom application
 * theme: NetTact Liquid Glass · design-system: design.md
 * states: empty · awaiting-agent · partial · truncated · queued · clock-ahead · expired · responsive
 * pre-emit critique: P5 H5 E4 S5 R5 V4
 */
.snap {
  margin-top: var(--space-lg);
}
.sec-head {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  margin-bottom: var(--space-xs);
}
.sec-head h4 {
  font-family: var(--font-display);
  font-size: var(--text-md);
  line-height: 1.3;
}
.card.sub {
  margin: var(--space-xs) 0;
  padding: var(--space-sm) var(--space-md);
}
.card.sub h5 {
  margin-bottom: var(--space-xs);
  font-family: var(--font-display);
  font-size: var(--text-base);
}
.entry-head {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  flex-wrap: wrap;
  margin-bottom: var(--space-2xs);
}
.facts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: var(--space-2xs) var(--space-lg);
  margin: var(--space-2xs) 0;
}
.facts > div {
  display: flex;
  min-width: 0;
  gap: var(--space-2xs);
  font-size: var(--text-sm);
}
.facts dt {
  flex: 0 0 auto;
  margin: 0;
  color: var(--color-muted);
}
.facts dd {
  /* Reset the browser's default 40px dd indent so each value sits next to its
     label instead of far to the right. */
  margin: 0;
  min-width: 0;
  color: var(--color-ink-2);
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
.grp {
  margin: var(--space-sm) 0;
}
.grp-label {
  display: block;
  margin-bottom: var(--space-2xs);
  color: var(--color-muted);
  font-size: var(--text-xs);
}
ul.plain {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2xs);
}
ul.plain li {
  display: flex;
  align-items: center;
  min-width: 0;
  gap: var(--space-2xs);
  flex-wrap: wrap;
  font-size: var(--text-sm);
}
.agent-list li > b,
.target-list li > .mono {
  min-width: 0;
  overflow-wrap: anywhere;
}
.trigger-list {
  margin-bottom: var(--space-2xs);
}
.trigger-list li {
  font-size: var(--text-sm);
}
.network-line {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  align-items: baseline;
  gap: var(--space-2xs);
  margin-block: var(--space-2xs);
}
.network-value {
  min-width: 0;
  white-space: normal;
  overflow-wrap: anywhere;
}
ul.interface-list li {
  display: grid;
  grid-template-columns: auto minmax(100px, max-content) auto minmax(0, 1fr);
  align-items: start;
}
.interface-name,
.interface-addrs {
  min-width: 0;
  overflow-wrap: anywhere;
}
.grp-status {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-xs) var(--space-lg);
}
.grp-status li {
  display: inline-flex;
  align-items: center;
  min-width: 0;
  gap: var(--space-2xs);
  font-size: var(--text-sm);
}
.grp-status .field {
  min-width: 0;
  color: var(--color-ink-2);
}
.table-scroll {
  max-width: 100%;
  overflow-x: auto;
  overscroll-behavior-inline: contain;
}
.mini-table {
  width: 100%;
  min-width: 760px;
  border-collapse: collapse;
  font-size: var(--text-sm);
}
.mini-table th,
.mini-table td {
  text-align: left;
  padding: var(--space-2xs) var(--space-xs);
  border-bottom: var(--rule-hair) solid var(--color-rule);
  vertical-align: top;
}
.mini-table td.mono {
  min-width: 180px;
  white-space: normal;
  overflow-wrap: anywhere;
}
.mini-table th {
  color: var(--color-muted);
  font-weight: 600;
}
.notice {
  font-size: var(--text-sm);
  color: var(--color-ink-2);
  background: var(--surface-2);
  border: var(--rule-hair) solid var(--color-rule);
  border-radius: var(--radius-input);
  padding: var(--space-2xs) var(--space-xs);
  margin: var(--space-xs) 0;
}
.notice.warn {
  color: var(--color-warning-text);
  background: color-mix(in oklch, var(--color-warning) 14%, transparent);
  border-color: color-mix(in oklch, var(--color-warning) 30%, transparent);
}
.notice.small {
  padding: var(--space-2xs) var(--space-xs);
  font-size: var(--text-xs);
}
.small-note {
  margin: var(--space-2xs) 0;
  font-size: var(--text-xs);
}
@media (max-width: 800px) {
  ul.interface-list li {
    grid-template-columns: auto minmax(0, 1fr) auto;
  }
  .interface-addrs {
    grid-column: 2 / -1;
  }
}
@media (max-width: 520px) {
  .facts {
    grid-template-columns: minmax(0, 1fr);
  }
  .network-line {
    grid-template-columns: minmax(0, 1fr);
  }
  ul.interface-list li {
    grid-template-columns: auto minmax(0, 1fr);
  }
  ul.interface-list li > .badge.neutral {
    grid-column: 2;
  }
  .interface-addrs {
    grid-column: 2;
  }
}
</style>

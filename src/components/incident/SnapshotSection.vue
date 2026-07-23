<script setup lang="ts">
// Immutable incident snapshot (INCIDENT-002): the frozen server base facts and
// each detecting Agent's allowlisted scene entry. Renders only typed, allowlisted
// payload fields — it never assumes or displays process, user, path or credential
// content. Overall/entry/field-group status is shown as text (not colour alone),
// with clock-skew, truncation and evidence-expired states surfaced explicitly.
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { SnapshotView, SnapshotEntry } from '../../api'
import { useIncidentLabels, statusTone } from '../../composables/useIncidentLabels'
import { fmtBytes } from '../../lib/format'
import { toDateLocale } from '../../i18n'

const props = defineProps<{ snapshot: SnapshotView | null; evidenceExpired: boolean }>()

const { t, locale } = useI18n()
const { snapStatusLabel, groupStatusLabel, fieldGroupLabel, snapReasonLabel, errorClassLabel } =
  useIncidentLabels()

const fmtDateTime = (s: string | null) =>
  s ? new Date(s).toLocaleString(toDateLocale(locale.value), { hour12: false }) : '—'
const base = computed(() => props.snapshot?.base ?? null)
const entries = computed(() => props.snapshot?.entries ?? [])
const skewSeconds = (e: SnapshotEntry) => (e.clock_skew_ms / 1000).toFixed(1)
const cpuPct = (v?: number) => (v == null ? '—' : `${v.toFixed(0)}%`)
</script>

<template>
  <section class="snap" aria-labelledby="snap-h">
    <div class="sec-head">
      <h4 id="snap-h">{{ t('incidents.snap.title') }}</h4>
      <span v-if="snapshot" class="badge" :class="statusTone(snapshot.status)">
        {{ snapStatusLabel(snapshot.status) }}
      </span>
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
          <ul class="plain">
            <li v-for="a in base.agents" :key="a.agent_id">
              <b>{{ a.name || a.hostname || a.agent_id }}</b>
              <span class="hint"> · {{ a.platform || '—' }} · {{ a.agent_version || '—' }}</span>
            </li>
          </ul>
        </div>
        <div v-if="base.targets.length" class="grp">
          <span class="grp-label">{{ t('incidents.snap.frozenTargets') }}</span>
          <ul class="plain">
            <li v-for="tg in base.targets" :key="tg.monitor_id">
              <span class="badge neutral">{{ tg.kind || '—' }}</span>
              <span class="mono"> {{ tg.target || '—' }}<template v-if="tg.port">:{{ tg.port }}</template></span>
            </li>
          </ul>
        </div>
      </div>

      <!-- Per-Agent scene entries. -->
      <p v-if="!entries.length" class="hint">{{ t('incidents.snap.noEntries') }}</p>
      <div v-for="e in entries" :key="e.agent_id" class="card sub entry">
        <div class="entry-head">
          <b>{{ e.agent_name || e.agent_id }}</b>
          <span class="badge" :class="statusTone(e.status)">{{ snapStatusLabel(e.status) }}</span>
          <span v-if="e.reason" class="hint">{{ snapReasonLabel(e.reason) }}</span>
        </div>
        <p v-if="e.skewed" class="notice warn small" role="note">
          {{ t('incidents.snap.clockSkew', { s: skewSeconds(e) }) }}
        </p>
        <dl class="facts">
          <div><dt>{{ t('incidents.snap.requestedAt') }}</dt><dd>{{ fmtDateTime(e.requested_at) }}</dd></div>
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
            <div v-if="e.payload.network.default_route" class="hint">
              {{ t('incidents.snap.defaultRoute') }}:
              <span class="mono">{{ e.payload.network.default_route.gateway || '—' }}</span>
              <template v-if="e.payload.network.default_route.interface">
                · {{ e.payload.network.default_route.interface }}
              </template>
            </div>
            <div v-if="e.payload.network.dns_servers?.length" class="hint">
              DNS: <span class="mono">{{ e.payload.network.dns_servers.join(', ') }}</span>
            </div>
            <ul v-if="e.payload.network.interfaces?.length" class="plain">
              <li v-for="iface in e.payload.network.interfaces" :key="iface.name">
                <span class="badge" :class="iface.up ? 'ok' : 'open'">
                  {{ iface.up ? t('incidents.snap.ifaceUp') : t('incidents.snap.ifaceDown') }}
                </span>
                <b>{{ iface.name }}</b>
                <span v-if="iface.is_wireless" class="badge neutral">{{ t('incidents.snap.wireless') }}</span>
                <span v-if="iface.addrs?.length" class="mono hint"> {{ iface.addrs.join(', ') }}</span>
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
        </template>
        <p v-else-if="!e.reason" class="hint">{{ t('incidents.snap.collecting') }}</p>
      </div>
    </template>
  </section>
</template>

<style scoped>
.snap {
  margin-top: 18px;
}
.sec-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
.sec-head h4 {
  font-size: 14px;
}
.card.sub {
  padding: 12px 14px;
  margin: 10px 0;
}
.card.sub h5 {
  font-size: 13px;
  margin-bottom: 8px;
}
.entry-head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 6px;
}
.facts {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 22px;
  margin: 6px 0;
}
.facts > div {
  display: flex;
  gap: 8px;
  font-size: 12.5px;
}
.facts dt {
  margin: 0;
  color: var(--text-muted);
}
.facts dd {
  /* Reset the browser's default 40px dd indent so each value sits next to its
     label instead of far to the right. */
  margin: 0;
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
}
.grp {
  margin: 8px 0;
}
.grp-label {
  display: block;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
  margin-bottom: 4px;
}
ul.plain {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
ul.plain li {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 12.5px;
}
.grp-status {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
}
.grp-status li {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
}
.grp-status .field {
  min-width: 96px;
  color: var(--text-dim);
}
.mini-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.mini-table th,
.mini-table td {
  text-align: left;
  padding: 4px 8px;
  border-bottom: 1px solid var(--border);
  vertical-align: top;
}
.mini-table th {
  color: var(--text-muted);
  font-weight: 600;
}
.notice {
  font-size: 12.5px;
  color: var(--text-dim);
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 7px 11px;
  margin: 8px 0;
}
.notice.warn {
  color: var(--warning);
  background: var(--warning-soft);
  border-color: rgba(251, 191, 36, 0.3);
}
.notice.small {
  padding: 5px 9px;
  font-size: 12px;
}
</style>

<script setup lang="ts">
// One host-resource cell for the Agent status list (AGENT-001). Renders a
// resource family's current value with its unit and sample age; a stale sample
// (older than the server freshness cutoff) is dimmed and tagged rather than shown
// as fresh-normal, and a missing sample (permission denied or never reported)
// renders "—". Colour is never the only signal — the stale tag carries text.
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AgentResources } from '../../api'
import { fmtBytes, fmtBps } from '../../lib/format'
import { sampleAge } from '../../lib/agentStatusPage'

const props = defineProps<{
  kind: 'cpu' | 'memory' | 'disk' | 'net' | 'load' | 'uptime'
  resources: AgentResources
  now: number
}>()

const { t } = useI18n()

interface Cell {
  primary: string
  sub?: string
  ts: string | null
  stale: boolean
}

const cell = computed<Cell | null>(() => {
  const r = props.resources
  switch (props.kind) {
    case 'cpu':
      return r.cpu ? { primary: `${pct(r.cpu.value)}%`, ts: r.cpu.ts, stale: r.cpu.stale } : null
    case 'memory':
      return r.memory
        ? {
            primary: `${pct(r.memory.pct)}%`,
            sub: r.memory.total ? `${fmtBytes(r.memory.used)} / ${fmtBytes(r.memory.total)}` : undefined,
            ts: r.memory.ts,
            stale: r.memory.stale,
          }
        : null
    case 'disk': {
      if (!r.disk) return null
      const d = r.disk
      const cap = d.total ? `${fmtBytes(d.used)} / ${fmtBytes(d.total)}` : ''
      // Multiple disks: lead with the summed used / total capacity (auto unit) and
      // keep the worst-mount usage as context. Single disk: percentage + its size.
      if (d.mounts > 1 && cap) {
        return { primary: cap, sub: t('agentStatus.diskWorst', { pct: pct(d.pct), n: d.mounts }), ts: d.ts, stale: d.stale }
      }
      return { primary: `${pct(d.pct)}%`, sub: cap || diskSub(d.mount, d.mounts), ts: d.ts, stale: d.stale }
    }
    case 'net':
      return r.net
        ? { primary: `↓ ${fmtBps(r.net.rx_bps)}`, sub: `↑ ${fmtBps(r.net.tx_bps)}`, ts: r.net.ts, stale: r.net.stale }
        : null
    case 'load':
      return r.load
        ? {
            primary: `${load(r.load.load1)} / ${load(r.load.load5)} / ${load(r.load.load15)}`,
            sub: t('agentStatus.loadCaption'),
            ts: r.load.ts,
            stale: r.load.stale,
          }
        : null
    case 'uptime':
      return r.uptime ? { primary: formatUptime(r.uptime.value), ts: r.uptime.ts, stale: r.uptime.stale } : null
    default:
      return null
  }
})

function pct(v: number): string {
  return v.toFixed(v >= 100 || v === Math.trunc(v) ? 0 : 1)
}
function load(v: number): string {
  return v.toFixed(2)
}
function diskSub(mount: string, mounts: number): string {
  return mounts > 1 ? t('agentStatus.diskMountN', { mount, n: mounts }) : mount
}
// Human uptime from seconds: the two largest non-zero units (Nd Mh / Nh Mm / Mm).
function formatUptime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d > 0) return t('agentStatus.uptimeDH', { d, h })
  if (h > 0) return t('agentStatus.uptimeHM', { h, m })
  return t('agentStatus.uptimeM', { m })
}

// Compact sample age, e.g. "5s" / "3m" / "2h".
const ageLabel = computed(() => {
  if (!cell.value) return ''
  const secs = sampleAge(cell.value.ts, props.now)
  if (secs == null) return ''
  if (secs < 60) return t('agentStatus.ageSeconds', { n: secs })
  if (secs < 3600) return t('agentStatus.ageMinutes', { n: Math.floor(secs / 60) })
  return t('agentStatus.ageHours', { n: Math.floor(secs / 3600) })
})
</script>

<template>
  <div v-if="cell" class="res" :class="{ stale: cell.stale }">
    <div class="primary">
      {{ cell.primary }}
      <span v-if="cell.stale" class="stale-tag">{{ t('agentStatus.stale') }}</span>
    </div>
    <div v-if="cell.sub" class="sub">{{ cell.sub }}</div>
    <div v-if="ageLabel" class="age">{{ ageLabel }}</div>
  </div>
  <div v-else class="res none" :title="t('agentStatus.noDataHint')">—</div>
</template>

<style scoped>
.res {
  font-size: 12.5px;
  line-height: 1.35;
}
.res.none {
  color: var(--text-muted);
}
.primary {
  font-weight: 600;
  color: var(--text);
  display: flex;
  align-items: baseline;
  gap: 6px;
}
.sub {
  color: var(--text-dim);
  font-size: 11.5px;
  font-family: var(--mono, monospace);
}
.age {
  color: var(--text-muted);
  font-size: 11px;
}
.res.stale .primary {
  color: var(--text-dim);
}
.stale-tag {
  font-size: 10.5px;
  font-weight: 500;
  color: #fcd34d;
  border: 1px solid rgba(251, 191, 36, 0.4);
  background: rgba(251, 191, 36, 0.1);
  border-radius: 999px;
  padding: 0 6px;
}
</style>

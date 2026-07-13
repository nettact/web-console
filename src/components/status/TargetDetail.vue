<script setup lang="ts">
// One agent probing one target: metric chips, stat cards (incl. NAT categorical
// cards), an overlaid trend chart for numeric metrics, a state-timeline band per
// status metric, and the target's alarm history. This is the old History
// probe-target path, self-contained so the Target Status page can drop it in for
// both the by-agent drilldown and (reused) elsewhere.
import { ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { api, type Alert, type Sample, type SeriesInfo } from '../../api'
import MetricChart from '../MetricChart.vue'
import MetricStatCards from '../MetricStatCards.vue'
import AlertsTable from '../AlertsTable.vue'
import { useMetricMeta } from '../../composables/useMetricMeta'
import { useMetricCards } from '../../composables/useMetricCards'
import { INFO_KINDS, isStatusKind, kindColor } from '../../lib/metricMeta'

const props = defineProps<{
  agentId: string
  familyLabel: string
  target: string
  monitorId?: string // set for user-created monitors; monitor-less system series have none
  name?: string // the monitor's display name
  metrics: SeriesInfo[]
  rangeSec: number
  showBack?: boolean
}>()
const emit = defineEmits<{ back: [] }>()

const { t } = useI18n()
const { metricLabel } = useMetricMeta()
const { buildCards } = useMetricCards()

const selectedKinds = ref<string[]>([])
const samplesByKind = ref<Record<string, Sample[]>>({})
const alerts = ref<Alert[]>([])
const loading = ref(false)
let dataSeq = 0
let alertSeq = 0

// Static totals/categorical codes are plotted nowhere, so they're out of the chip
// picker — they still appear as a stat card.
const pickerMetrics = computed(() => props.metrics.filter((m) => !INFO_KINDS.has(m.kind)))

const activeMetrics = computed(() =>
  props.metrics
    .filter((m) => selectedKinds.value.includes(m.kind))
    .map((m) => ({
      key: m.kind,
      label: metricLabel(m.kind),
      kind: m.kind,
      unit: m.unit,
      color: kindColor(m.kind),
      samples: samplesByKind.value[m.kind] ?? [],
    })),
)

const chartTitle = computed(
  () => `${props.familyLabel} · ${props.name || props.target || t('metrics.localTarget')}`,
)
const trendMetrics = computed(() =>
  activeMetrics.value.filter((m) => !isStatusKind(m.kind, m.unit) && !INFO_KINDS.has(m.kind)),
)
const statusMetrics = computed(() => activeMetrics.value.filter((m) => isStatusKind(m.kind, m.unit)))
const someData = (list: { samples: Sample[] }[]) => list.some((m) => m.samples.length)
const isUptimeMetric = (kind: string) => kind === 'agent.uptime_s'
const metricCards = computed(() => buildCards(activeMetrics.value))

function applyDefaultKinds() {
  // Default to the numeric/categorical metrics (trend lines + cards); a target
  // that only carries status metrics (an interface) defaults to those.
  const numeric = props.metrics.filter((m) => m.unit !== 'bool').map((m) => m.kind)
  selectedKinds.value = numeric.length ? numeric : props.metrics.map((m) => m.kind)
}

function toggleKind(k: string) {
  const set = new Set(selectedKinds.value)
  if (set.has(k)) {
    if (set.size === 1) return
    set.delete(k)
  } else set.add(k)
  selectedKinds.value = props.metrics.filter((m) => set.has(m.kind)).map((m) => m.kind)
  loadData()
}

async function loadData() {
  const seq = ++dataSeq
  const kinds = selectedKinds.value.slice()
  if (!props.agentId || !kinds.length) {
    samplesByKind.value = {}
    return
  }
  loading.value = true
  try {
    const results = await Promise.all(
      kinds.map((k) =>
        api.metrics(props.agentId, k, {
          monitor: props.monitorId,
          target: props.monitorId ? undefined : props.target || undefined,
          limit: 5000,
          sinceSeconds: props.rangeSec,
        }),
      ),
    )
    if (seq !== dataSeq) return
    const map: Record<string, Sample[]> = {}
    kinds.forEach((k, i) => (map[k] = results[i]))
    samplesByKind.value = map
  } finally {
    if (seq === dataSeq) loading.value = false
  }
}

async function loadAlerts() {
  const seq = ++alertSeq
  if (!props.agentId) {
    alerts.value = []
    return
  }
  try {
    const res = await api.agentAlerts(
      props.agentId,
      props.monitorId ? { monitor: props.monitorId } : { target: props.target },
      10,
    )
    if (seq === alertSeq) alerts.value = res
  } catch {
    if (seq === alertSeq) alerts.value = []
  }
}

function reload() {
  applyDefaultKinds()
  loadData()
  loadAlerts()
}

// Refetch when the selected monitor/agent changes; refetch samples only on a
// range change (the alarm list isn't range-scoped).
watch(() => [props.agentId, props.monitorId, props.target], reload)
watch(() => props.rangeSec, loadData)
onMounted(reload)
</script>

<template>
  <div class="detail">
    <button v-if="showBack" class="back" @click="emit('back')">{{ t('targetStatus.backToOverview') }}</button>

    <div class="fg metric-picker" v-if="pickerMetrics.length > 1">
      <span>{{ t('metrics.metricPicker') }}</span>
      <div class="chips">
        <button
          v-for="m in pickerMetrics"
          :key="m.kind"
          class="chip"
          :class="{ active: selectedKinds.includes(m.kind) }"
          :style="{ '--c': kindColor(m.kind) }"
          @click="toggleKind(m.kind)"
        >
          <i class="cdot" :style="{ background: kindColor(m.kind) }"></i>{{ metricLabel(m.kind) }}
        </button>
      </div>
    </div>

    <MetricStatCards :cards="metricCards" />

    <div class="card chart-card" v-if="trendMetrics.length">
      <MetricChart :title="chartTitle" :metrics="trendMetrics" />
      <p v-if="!loading && !someData(trendMetrics)" class="empty-line hint">{{ t('metrics.noDataRange') }}</p>
    </div>

    <div class="card chart-card" v-for="m in statusMetrics" :key="m.key">
      <MetricChart :title="`${chartTitle} · ${m.label}`" :metrics="[m]" />
      <div class="legend">
        <span><i class="dot on"></i>{{ isUptimeMetric(m.kind) ? t('chart.online') : t('chart.normalEnabled') }}</span>
        <span><i class="dot off"></i>{{ isUptimeMetric(m.kind) ? t('chart.offlineFault') : t('chart.interruptedDisabled') }}</span>
        <span v-if="isUptimeMetric(m.kind)"><i class="dot mark"></i>{{ t('chart.restart') }}</span>
      </div>
      <p v-if="!loading && !m.samples.length" class="empty-line hint">{{ t('metrics.noDataRange') }}</p>
    </div>

    <AlertsTable :alerts="alerts" />
  </div>
</template>

<style scoped>
.back {
  border: none;
  background: none;
  color: var(--primary);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  padding: 0;
  margin-bottom: 14px;
}
.back:hover {
  text-decoration: underline;
}
.metric-picker {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 16px;
}
.metric-picker > span {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 6px 12px;
  border-radius: 7px;
  border: 1px solid var(--border-strong);
  background: var(--input-bg);
  color: var(--text-dim);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s;
}
.chip:hover {
  color: var(--text);
}
.chip.active {
  color: var(--text);
  border-color: var(--c);
  background: var(--surface-2);
}
.cdot {
  width: 9px;
  height: 9px;
  border-radius: 3px;
  opacity: 0.45;
}
.chip.active .cdot {
  opacity: 1;
}
.chart-card {
  position: relative;
  padding: 10px 8px 6px;
}
.legend {
  display: flex;
  gap: 18px;
  padding: 4px 14px 8px;
  font-size: 12px;
  color: var(--text-dim);
}
.legend span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.legend .dot {
  width: 10px;
  height: 10px;
  border-radius: 3px;
  display: inline-block;
}
.legend .dot.on {
  background: #34d399;
}
.legend .dot.off {
  background: #f87171;
}
.legend .dot.mark {
  background: #fbbf24;
}
.empty-line {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  pointer-events: none;
}
</style>

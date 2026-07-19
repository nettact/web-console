<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { api, type TargetStatusRow } from '../../api'
import { useMetricMeta } from '../../composables/useMetricMeta'
import { familyOf } from '../../lib/metricMeta'
import type { Prober } from '../../lib/targetGroups'
import RangePicker from '../RangePicker.vue'
import TargetAcrossAgents from './TargetAcrossAgents.vue'

const props = defineProps<{ target: TargetStatusRow; agentId: string }>()

const { t } = useI18n()
const { familyLabel } = useMetricMeta()
const rangeSec = ref(6 * 3600)
const prober = ref<Prober | null>(null)
const loading = ref(false)
const error = ref('')
let loadSequence = 0

const firstSeriesKind = computed(() => prober.value?.series[0]?.kind)
const family = computed(() => firstSeriesKind.value ? familyOf(firstSeriesKind.value) : `probe.${props.target.kind}`)
const historyFamilyLabel = computed(() => familyLabel(firstSeriesKind.value || family.value))
const hasSeries = computed(() => !!prober.value?.series.length)
// Keep the child prop referentially stable while targetStatus replaces its
// current-status row objects. A fresh inline [prober] array on every render made
// the chart layer mistake silent status refreshes for an Agent-scope change.
const probers = computed(() => prober.value ? [prober.value] : [])

async function loadSeries(): Promise<void> {
  const sequence = ++loadSequence
  loading.value = true
  error.value = ''
  try {
    const [agent, series] = await Promise.all([
      api.agent(props.agentId),
      api.listSeries(props.agentId),
    ])
    if (sequence !== loadSequence) return
    prober.value = {
      agent,
      series: series.filter((item) => item.monitor_id === props.target.target_id),
    }
  } catch (cause) {
    if (sequence !== loadSequence) return
    prober.value = null
    error.value = String((cause as Error).message || cause)
  } finally {
    if (sequence === loadSequence) loading.value = false
  }
}

watch([() => props.target.target_id, () => props.agentId], loadSeries)
onMounted(loadSeries)
</script>

<template>
  <section class="history-view">
    <header class="history-toolbar">
      <div>
        <h2>{{ t('targetStatus.historyTitle') }}</h2>
        <p>{{ t('targetStatus.historyHint') }}</p>
      </div>
      <div class="range-control">
        <span>{{ t('metrics.timeRange') }}</span>
        <RangePicker v-model="rangeSec" />
      </div>
    </header>

    <p v-if="loading" class="history-message">{{ t('targetStatus.historyLoading') }}</p>
    <p v-else-if="error" class="err" role="alert">{{ t('targetStatus.historyLoadError') }} {{ error }}</p>
    <template v-else-if="prober">
      <p v-if="!hasSeries" class="history-message">{{ t('targetStatus.noHistoricalSeries') }}</p>
      <TargetAcrossAgents
        :family="family"
        :family-label="historyFamilyLabel"
        :target="target.target"
        :monitor-id="target.target_id"
        :name="target.name"
        :probers="probers"
        :range-sec="rangeSec"
        restrict-to-probers
      />
    </template>
  </section>
</template>

<style scoped>
.history-view { padding: 4px 0 0; }
.history-toolbar { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; margin-bottom: 15px; }
.history-toolbar h2 { margin: 0; font-size: 18px; }
.history-toolbar p { margin: 5px 0 0; color: var(--text-muted); font-size: 11.5px; }
.range-control { display: flex; flex-direction: column; align-items: flex-end; gap: 5px; }
.range-control > span { color: var(--text-muted); font-size: 9.5px; letter-spacing: 0.04em; text-transform: uppercase; }
.history-message { margin: 0 0 12px; padding: 11px 12px; border: 1px solid var(--border); border-radius: var(--radius-sm); color: var(--text-muted); background: var(--overlay-subtle); font-size: 12px; }

@media (max-width: 680px) {
  .history-toolbar { align-items: flex-start; flex-direction: column; }
  .range-control { align-items: flex-start; max-width: 100%; overflow-x: auto; }
}
</style>

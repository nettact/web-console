<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { api, type StatusEvent } from '../../api'
import { toDateLocale } from '../../i18n'

const props = defineProps<{
  agentId: string
  active: boolean
  rangeSec: number
}>()

const { t, locale } = useI18n()
const events = ref<StatusEvent[]>([])
const loading = ref(false)
const error = ref('')
let loadSequence = 0

function fmt(value: string): string {
  return new Date(value).toLocaleString(toDateLocale(locale.value), { hour12: false })
}

async function load(): Promise<void> {
  const sequence = ++loadSequence
  if (!props.active || !props.agentId) {
    events.value = []
    loading.value = false
    error.value = ''
    return
  }
  loading.value = true
  error.value = ''
  try {
    const since = Math.floor(Date.now() / 1000) - props.rangeSec
    const result = await api.agentStatusHistory(props.agentId, since)
    if (sequence !== loadSequence) return
    events.value = result
  } catch (cause) {
    if (sequence !== loadSequence) return
    events.value = []
    error.value = String((cause as Error).message || cause)
  } finally {
    if (sequence === loadSequence) loading.value = false
  }
}

watch([() => props.agentId, () => props.active, () => props.rangeSec], load, { immediate: true })
</script>

<template>
  <section class="connection-history" :aria-label="t('targetStatus.connectionHistory')">
    <p v-if="loading" class="history-message" role="status">{{ t('targetStatus.connectionHistoryLoading') }}</p>
    <p v-else-if="error" class="err" role="alert">
      {{ t('targetStatus.connectionHistoryError') }} {{ error }}
    </p>
    <div v-else-if="!events.length" class="history-message">
      <strong>{{ t('targetStatus.connectionHistoryEmpty') }}</strong>
      <span>{{ t('targetStatus.connectionHistoryEmptyHint') }}</span>
    </div>
    <ol v-else class="connection-timeline">
      <li v-for="(event, index) in events" :key="`${event.changed_at}-${index}`">
        <span class="timeline-dot" :class="event.status === 'online' ? 'is-online' : 'is-offline'" aria-hidden="true"></span>
        <time :datetime="event.changed_at">{{ fmt(event.changed_at) }}</time>
        <strong>{{ event.status === 'online' ? t('agents.statusOnline') : t('agents.statusOffline') }}</strong>
        <span v-if="event.reason" class="event-reason">{{ t(`agentStatus.disconnect.${event.reason}`) }}</span>
      </li>
    </ol>
  </section>
</template>

<style scoped>
/* Hallmark · component: timeline · genre: custom application · theme: design.md
 * states: default · hover · focus · active · disabled · loading · error · success
 * contrast: inherited from the locked NetTact token system
 */
.connection-history {
  min-width: 0;
}

.history-message {
  display: grid;
  gap: var(--space-3xs);
  padding: var(--space-sm);
  margin: 0;
  color: var(--color-ink-2);
  border: var(--rule-hair) solid var(--color-rule);
  border-radius: var(--radius-input);
  background: var(--color-paper-2);
}

.history-message strong {
  color: var(--color-ink);
  font-size: var(--text-sm);
}

.history-message span {
  font-size: var(--text-xs);
}

.connection-timeline {
  display: grid;
  padding: 0;
  margin: 0;
  list-style: none;
}

.connection-timeline li {
  display: grid;
  grid-template-columns: auto minmax(150px, auto) auto minmax(0, 1fr);
  align-items: center;
  gap: var(--space-xs);
  min-height: 52px;
  padding-block: var(--space-2xs);
  border-bottom: var(--rule-hair) solid var(--color-rule);
}

.connection-timeline li:last-child {
  border-bottom: 0;
}

.timeline-dot {
  width: 9px;
  height: 9px;
  border-radius: var(--radius-pill);
  background: var(--color-neutral);
}

.timeline-dot.is-online {
  background: var(--color-success);
}

.timeline-dot.is-offline {
  background: var(--color-danger);
}

.connection-timeline time {
  color: var(--color-muted);
  font-family: var(--font-outlier);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
}

.connection-timeline strong {
  font-size: var(--text-sm);
}

.event-reason {
  min-width: 0;
  overflow: hidden;
  color: var(--color-ink-2);
  font-size: var(--text-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 40rem) {
  .connection-timeline li {
    grid-template-columns: auto minmax(0, 1fr) auto;
  }

  .event-reason {
    grid-column: 2 / -1;
    overflow: visible;
    line-height: 1.5;
    text-overflow: clip;
    white-space: normal;
  }
}
</style>

<script setup lang="ts">
// One confirmed route change: the path before and after, side by side, with the
// hops that answer differently highlighted on both sides. The AS chains above
// the tables carry the same diff at network granularity.
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { api, type RouteChangeDetail } from '../../api'
import { toDateLocale } from '../../i18n'
import { diffASPaths, differingTTLs, firstDivergingTTL } from '../../lib/routePath'
import ASPathChain from './ASPathChain.vue'
import RouteHopTable from './RouteHopTable.vue'

const props = defineProps<{ changeId: number }>()

const { t, locale } = useI18n()
const detail = ref<RouteChangeDetail | null>(null)
const loading = ref(false)
const error = ref('')
let seq = 0

async function load() {
  const my = ++seq
  loading.value = true
  error.value = ''
  try {
    const d = await api.routeChange(props.changeId)
    if (my !== seq) return
    detail.value = d
  } catch (e) {
    if (my !== seq) return
    error.value = String((e as Error).message || e)
  } finally {
    if (my === seq) loading.value = false
  }
}
watch(() => props.changeId, load, { immediate: true })

const differs = computed(() =>
  detail.value ? differingTTLs(detail.value.before.hops, detail.value.after.hops) : new Set<number>(),
)
const divergeTTL = computed(() =>
  detail.value
    ? firstDivergingTTL(detail.value.before.hops, detail.value.after.hops, detail.value.change.diverge_ttl)
    : null,
)
const asDiff = computed(() =>
  detail.value ? diffASPaths(detail.value.before.as_path, detail.value.after.as_path) : null,
)
const fmtTime = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleString(toDateLocale(locale.value), { hour12: false }) : '—'
</script>

<template>
  <div class="route-change-detail">
    <p v-if="loading && !detail" class="hint">{{ t('route.detailLoading') }}</p>
    <p v-else-if="error" class="err" role="alert">{{ t('route.detailErr', { err: error }) }}</p>
    <template v-else-if="detail">
      <p class="hint tiny detail-note">
        <template v-if="divergeTTL != null">{{ t('route.divergeAt', { ttl: divergeTTL }) }} · </template>
        {{ t('route.detailNote') }}
      </p>
      <div class="side-by-side">
        <section class="side">
          <header>
            <h5>{{ t('route.oldPath') }}</h5>
            <span class="badge" :class="detail.before.reached ? 'ok' : 'neutral'">
              {{ detail.before.reached ? t('route.reachedYes') : t('route.reachedNo') }}
            </span>
          </header>
          <ASPathChain :diff="asDiff?.from" compact />
          <p v-if="detail.before_run" class="hint tiny">{{ t('route.sampleRun', { time: fmtTime(detail.before_run.run_at) }) }}</p>
          <RouteHopTable :hops="detail.before.hops" :highlight="differs" compact />
        </section>
        <section class="side">
          <header>
            <h5>{{ t('route.newPath') }}</h5>
            <span class="badge" :class="detail.after.reached ? 'ok' : 'neutral'">
              {{ detail.after.reached ? t('route.reachedYes') : t('route.reachedNo') }}
            </span>
          </header>
          <ASPathChain :diff="asDiff?.to" compact />
          <p v-if="detail.after_run" class="hint tiny">{{ t('route.sampleRun', { time: fmtTime(detail.after_run.run_at) }) }}</p>
          <RouteHopTable :hops="detail.after.hops" :highlight="differs" compact />
        </section>
      </div>
    </template>
  </div>
</template>

<style scoped>
.route-change-detail {
  margin-top: var(--space-2xs);
}
.detail-note {
  margin: 0 0 var(--space-2xs);
}
.side-by-side {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-sm);
}
@media (max-width: 760px) {
  .side-by-side {
    grid-template-columns: minmax(0, 1fr);
  }
}
.side {
  display: grid;
  gap: var(--space-2xs);
  align-content: start;
  min-width: 0;
}
.side header {
  display: flex;
  align-items: center;
  gap: 8px;
}
.side h5 {
  margin: 0;
  font-size: 13px;
}
.side .hint {
  margin: 0;
}
</style>

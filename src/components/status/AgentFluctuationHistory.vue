<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { api, type Fluctuation } from '../../api'
import FluctuationsTable from '../FluctuationsTable.vue'

const props = defineProps<{
  agentId: string
  rangeSec: number
}>()

const { t } = useI18n()
const fluctuations = ref<Fluctuation[]>([])
const total = ref(0)
const loading = ref(false)
const loaded = ref(false)
const page = ref(1)
const pageSize = ref(15)
let loadSequence = 0

const PAGE_SIZES = [15, 30, 50]
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))

function goPage(next: number): void {
  const normalized = Math.min(Math.max(1, next), totalPages.value)
  if (normalized === page.value) return
  page.value = normalized
  load()
}

function changePageSize(): void {
  page.value = 1
  load()
}

async function load(): Promise<void> {
  const sequence = ++loadSequence
  if (!props.agentId) {
    fluctuations.value = []
    total.value = 0
    loading.value = false
    loaded.value = false
    return
  }

  loading.value = true
  loaded.value = false
  try {
    const result = await api.fluctuations({
      agent: props.agentId,
      since: Math.floor(Date.now() / 1000) - props.rangeSec,
      page: page.value,
      page_size: pageSize.value,
    })
    if (sequence !== loadSequence) return
    fluctuations.value = result.items
    total.value = result.total
    const lastPage = Math.max(1, Math.ceil(result.total / pageSize.value))
    if (page.value > lastPage) {
      page.value = lastPage
      return load()
    }
    loaded.value = true
  } catch {
    if (sequence !== loadSequence) return
    fluctuations.value = []
    total.value = 0
  } finally {
    if (sequence === loadSequence) loading.value = false
  }
}

watch([() => props.agentId, () => props.rangeSec], () => {
  page.value = 1
  load()
}, { immediate: true })
onBeforeUnmount(() => { loadSequence++ })
</script>

<template>
  <section class="agent-fluctuation-history" :aria-label="t('targetStatus.fluctuations')">
    <p v-if="loading" class="history-message" role="status">{{ t('common.loading') }}</p>
    <FluctuationsTable
      v-else
      :items="fluctuations"
      :loaded="loaded"
      show-target
      :show-count="false"
    />
    <nav v-if="!loading && loaded && total > 0" class="pager" :aria-label="t('targetStatus.fluctuations')">
      <label class="pager-size">
        <span>{{ t('common.perPage') }}</span>
        <select v-model.number="pageSize" :disabled="loading" @change="changePageSize">
          <option v-for="size in PAGE_SIZES" :key="size" :value="size">{{ size }}</option>
        </select>
      </label>
      <div class="pager-nav">
        <button
          type="button"
          class="pager-btn"
          :disabled="loading || page <= 1"
          :aria-label="t('common.prev')"
          @click="goPage(page - 1)"
        >‹</button>
        <span class="pager-info">{{ t('common.pageOf', { page, total: totalPages }) }}</span>
        <button
          type="button"
          class="pager-btn"
          :disabled="loading || page >= totalPages"
          :aria-label="t('common.next')"
          @click="goPage(page + 1)"
        >›</button>
      </div>
    </nav>
  </section>
</template>

<style scoped>
.agent-fluctuation-history {
  min-width: 0;
}

.history-message {
  padding: var(--space-sm);
  margin: 0;
  color: var(--color-ink-2);
  border: var(--rule-hair) solid var(--color-rule);
  border-radius: var(--radius-input);
  background: var(--color-paper-2);
}

.agent-fluctuation-history :deep(.flux-card) {
  margin-top: 0;
}

.pager {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
  padding: var(--space-xs) var(--space-sm);
  margin-top: var(--space-2xs);
  border: var(--rule-hair) solid var(--color-rule);
  border-radius: var(--radius-input);
  background: var(--color-glass-subtle);
}

.pager-size,
.pager-nav {
  display: flex;
  align-items: center;
  gap: var(--space-2xs);
}

.pager-size {
  color: var(--color-ink-2);
  font-size: var(--text-xs);
}

.pager-size select {
  min-height: 44px;
  padding: var(--space-2xs) var(--space-xs);
  color: var(--color-ink);
  border: var(--rule-hair) solid var(--color-rule);
  border-radius: var(--radius-input);
  background: var(--color-paper-2);
}

.pager-nav {
  gap: var(--space-sm);
  margin-left: auto;
}

.pager-btn {
  width: 44px;
  height: 44px;
  padding: 0;
  color: var(--color-ink);
  font: inherit;
  font-size: var(--text-md);
  line-height: 1;
  border: var(--rule-hair) solid var(--color-rule);
  border-radius: var(--radius-input);
  background: var(--color-paper-2);
  cursor: pointer;
}

.pager-btn:focus-visible {
  outline: var(--rule-fine) solid var(--color-focus);
  outline-offset: var(--space-3xs);
}

.pager-btn:disabled {
  opacity: .4;
  cursor: default;
}

.pager-info {
  color: var(--color-ink-2);
  font-family: var(--font-outlier);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
}

@media (hover: hover) and (pointer: fine) {
  .pager-btn:hover:not(:disabled) {
    border-color: var(--color-rule-2);
  }
}

@media (max-width: 26rem) {
  .pager {
    align-items: stretch;
    flex-direction: column;
  }

  .pager-nav {
    width: 100%;
    justify-content: space-between;
    margin-left: 0;
  }
}
</style>

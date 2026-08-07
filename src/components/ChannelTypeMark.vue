<script setup lang="ts">
import { computed } from 'vue'
import { channelTypeDescriptor } from '../lib/channelTypes'

const props = defineProps<{ type: string; size?: 'sm' | 'md' }>()
const descriptor = computed(() => channelTypeDescriptor(props.type))
</script>

<template>
  <span class="channel-type-mark" :class="[descriptor.group, size || 'md']" aria-hidden="true">
    {{ descriptor.mark }}
  </span>
</template>

<style scoped>
.channel-type-mark {
  display: inline-grid;
  place-items: center;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 2.25rem;
  height: 2.25rem;
  border: var(--rule-hair) solid var(--color-rule-2);
  border-radius: var(--radius-xs);
  color: var(--color-ink-2);
  background: var(--color-glass-subtle);
  font-family: var(--font-body);
  font-size: 0.68rem;
  font-weight: 750;
  line-height: 1;
  letter-spacing: 0;
  text-align: center;
}
.channel-type-mark.sm {
  width: 2rem;
  height: 2rem;
  font-size: 0.62rem;
}
.channel-type-mark.collaboration { color: var(--color-accent-text); }
.channel-type-mark.personal { color: var(--color-chart-secondary); }
.channel-type-mark.local { color: var(--color-success-text); }
</style>

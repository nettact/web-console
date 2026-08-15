<script setup lang="ts">
import { computed } from 'vue'
import { theme } from '../theme'

type MarkVariant = 'full' | 'compact'

const props = withDefaults(defineProps<{
  variant?: MarkVariant
  responsive?: boolean
}>(), {
  variant: 'full',
  responsive: false,
})

const fullSource = computed(() => (
  theme.value === 'light'
    ? '/nettact-mark.svg'
    : '/nettact-mark-reverse.svg'
))
const compactSource = computed(() => (
  theme.value === 'light'
    ? '/nettact-mark-compact.svg'
    : '/nettact-mark-compact-reverse.svg'
))
const source = computed(() => (props.variant === 'compact' ? compactSource.value : fullSource.value))
const size = computed(() => (props.variant === 'compact' ? 40 : 48))
</script>

<template>
  <picture v-if="responsive" class="brand-mark-picture" aria-hidden="true">
    <source media="(max-width: 60rem)" :srcset="compactSource" />
    <img
      class="brand-mark-image"
      :src="fullSource"
      alt=""
      width="48"
      height="48"
      draggable="false"
    />
  </picture>
  <img
    v-else
    class="brand-mark-image"
    :src="source"
    alt=""
    :width="size"
    :height="size"
    aria-hidden="true"
    draggable="false"
  />
</template>

<style scoped>
.brand-mark-picture,
.brand-mark-image {
  display: block;
  flex: none;
  aspect-ratio: 1;
}

.brand-mark-picture > .brand-mark-image {
  width: 100%;
  height: 100%;
}

.brand-mark-image {
  object-fit: contain;
}
</style>

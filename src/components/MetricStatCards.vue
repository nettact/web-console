<script setup lang="ts">
// Renders a grid of status/summary stat cards. Cards are built by the
// useMetricCards composable; this component is presentation only. The base
// .stat-grid / .stat styles are global (style.css); the small-value and metric-dot
// tweaks are scoped here.
import InfoTip from './InfoTip.vue'
import type { Card } from '../composables/useMetricCards'

defineProps<{ cards: Card[] }>()
</script>

<template>
  <div class="stat-grid" v-if="cards.length">
    <div class="stat" v-for="c in cards" :key="c.label" :class="c.tone ? `is-${c.tone}` : ''">
      <div class="label"><i class="mdot" :style="{ background: c.color }"></i>{{ c.label }}<InfoTip v-if="c.info" :text="c.info" /></div>
      <div class="value" :class="{ sm: c.small }">
        {{ c.value }}<span v-if="c.unit" class="unit">{{ c.unit }}</span>
      </div>
      <div class="foot">{{ c.foot }}</div>
    </div>
  </div>
</template>

<style scoped>
.mdot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 2px;
  margin-right: 6px;
  vertical-align: middle;
}
.value.sm {
  font-size: 20px;
}
</style>

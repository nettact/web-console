<script setup lang="ts">
// Summary-figure grid for a game run, on the shared .stat-grid chrome. A card
// whose value is null shows the unknown accent rather than the neutral one, so a
// missing measurement is visibly distinct from a measured value at a glance and
// not only in its tooltip.
import GameValue from './GameValue.vue'
import type { GameCard } from '../../lib/gameRun'

defineProps<{ cards: GameCard[] }>()
</script>

<template>
  <div class="stat-grid" v-if="cards.length">
    <div class="stat" v-for="c in cards" :key="c.key" :class="{ 'is-unknown': c.value === null }">
      <div class="label">{{ c.label }}</div>
      <div class="value">
        <GameValue :value="c.value" :unit="c.unit" :reason="c.reason" />
      </div>
      <div class="foot">{{ c.foot }}</div>
    </div>
  </div>
</template>

<style scoped>
.value :deep(.gv-unit) {
  font-size: 13px;
}
</style>

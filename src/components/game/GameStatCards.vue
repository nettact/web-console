<script setup lang="ts">
// Summary-figure grid for a game run, on the shared .stat-grid chrome. A card
// whose value is null shows the unknown accent rather than the neutral one, so a
// missing measurement is visibly distinct from a measured value at a glance and
// not only in its tooltip.
//
// A card is two lines and always exactly two: the label and the figure. The
// sentence explaining what the figure is hangs off the label as a hover tip
// instead of sitting under it, so a card's height never depends on whether it
// has one — a grid that reflowed as explanations came and went moved the charts
// below it out from under a pointer that was drawing a selection on them.
import GameValue from './GameValue.vue'
import InfoTip from '../InfoTip.vue'
import { vFitText as vFit } from '../../lib/fitText'
import type { GameCard } from '../../lib/gameRun'

defineProps<{ cards: GameCard[] }>()
</script>

<template>
  <div class="stat-grid" v-if="cards.length">
    <div class="stat" v-for="c in cards" :key="c.key" :class="{ 'is-unknown': c.value === null }">
      <div class="label">{{ c.label }}<InfoTip v-if="c.hint" :text="c.hint" /></div>
      <div class="value" v-fit>
        <GameValue :value="c.value" :unit="c.unit" :reason="c.reason" />
      </div>
    </div>
  </div>
</template>

<style scoped>
/* One line at a fixed height, whatever the value says.
 *
 * The height is the invariant and the font size is what gives way — see
 * lib/fitText. Without it a value long enough to wrap ("7 分 8 秒" at the grid's
 * narrowest column) made its card taller than its neighbours, so the row grew,
 * and the charts under the panel moved while a selection was being dragged on
 * them.
 *
 * line-height is pinned rather than left at 1 so a shrunk figure still sits in
 * the same band as a full-size one, keeping the values across a row on one
 * visual line. overflow covers the case fitText floors at its minimum.
 *
 * The band is 40px for a 30px figure, and the slack is not decoration. A glyph
 * box is taller than its font size — ascender to descender is about 1.25em in
 * this face — so a box of exactly 30px cut the bottom off every digit with a
 * descending stroke and the lower stroke of 分 and 秒. overflow: hidden made it
 * silent: the figure looked complete until the eye caught that 4.304 had lost
 * its baseline. */
.value {
  white-space: nowrap;
  line-height: 40px;
  height: 40px;
  overflow: hidden;
}
/* In em so the unit shrinks with the figure it belongs to. A fixed size here
 * would leave fitText's one-pass ratio wrong, since part of the width it is
 * dividing by would not respond to the size it sets. */
.value :deep(.gv-unit) {
  font-size: 0.44em;
}
</style>

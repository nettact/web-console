<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import OnboardingFlow from './OnboardingLegacy.vue'

const { locale } = useI18n()

const copy = computed(() => {
  const zh = locale.value.toLowerCase().startsWith('zh')
  return zh
    ? {
        titlePrefix: '看清',
        titleAccent: '网络',
        titleSuffix: '的每一次呼吸',
        subtitle: '从本地网关到全球节点，持续掌握连通性、延迟与网络质量。',
        online: '在线',
        gateway: '本地网关',
        tokyo: '东京',
        singapore: '新加坡',
        frankfurt: '法兰克福',
        signal: '网络信号示意',
      }
    : {
        titlePrefix: 'See every ',
        titleAccent: 'heartbeat',
        titleSuffix: ' of your network',
        subtitle: 'From your local gateway to global nodes, understand connectivity, latency, and quality at a glance.',
        online: 'Online',
        gateway: 'Local gateway',
        tokyo: 'Tokyo',
        singapore: 'Singapore',
        frankfurt: 'Frankfurt',
        signal: 'Network signal preview',
      }
})
</script>

<template>
  <div class="onboarding-shell">
    <div class="ambient ambient-one" aria-hidden="true"></div>
    <div class="ambient ambient-two" aria-hidden="true"></div>

    <aside class="story-pane">
      <div class="brand">
        <span class="brand-mark">
          <svg viewBox="0 0 28 28" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2.4"
            stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M3.5 14h4l3-8.5 5.5 17 4-11 2 2.5h2.5" />
          </svg>
        </span>
        <span class="brand-name">NetTact</span>
      </div>

      <div class="story-copy">
        <h1>{{ copy.titlePrefix }}<span>{{ copy.titleAccent }}</span>{{ copy.titleSuffix }}</h1>
        <p>{{ copy.subtitle }}</p>
      </div>

      <div class="network-stage" aria-hidden="true">
        <div class="graph-plane">
        <svg class="network-links" viewBox="0 0 720 420" preserveAspectRatio="none">
          <path d="M360 156 C360 128 360 92 360 59" />
          <path d="M386 174 C445 160 520 130 578 113" />
          <path d="M384 190 C440 204 487 237 520 265" />
          <path d="M336 190 C280 204 220 238 186 265" />
          <circle cx="360" cy="105" r="4" />
          <circle cx="500" cy="139" r="4" />
          <circle cx="468" cy="224" r="4" />
          <circle cx="249" cy="224" r="4" />
        </svg>

        <div class="hub-node">
          <span class="hub-radar"></span>
          <span class="hub-icon">
            <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.8"
              stroke-linecap="round" stroke-linejoin="round">
              <path d="m4 11 8-7 8 7v9H4z" /><path d="M9 20v-6h6v6" />
            </svg>
          </span>
          <strong>{{ copy.gateway }}</strong>
          <small><i></i>{{ copy.online }}</small>
        </div>

        <div class="remote-node node-dns">
          <b>DNS</b><span>DNS</span><small><i></i>{{ copy.online }}</small>
        </div>
        <div class="remote-node node-tokyo">
          <b>TYO</b><span>{{ copy.tokyo }}</span><small><i></i>{{ copy.online }}</small>
        </div>
        <div class="remote-node node-singapore">
          <b>SIN</b><span>{{ copy.singapore }}</span><small><i></i>{{ copy.online }}</small>
        </div>
        <div class="remote-node node-frankfurt">
          <b>FRA</b><span>{{ copy.frankfurt }}</span><small><i></i>{{ copy.online }}</small>
        </div>
        </div>

        <div class="signal-card">
          <span><i></i>{{ copy.signal }}</span>
          <svg viewBox="0 0 540 62" preserveAspectRatio="none">
            <path d="M0 49 C22 49 25 21 44 22 S65 51 86 44 105 28 125 36 144 47 163 18 187 29 212 45 234 42 258 23 281 27 302 48 326 41 351 20 376 28 400 49 423 39 447 17 471 33 499 51 520 38 540 34" />
          </svg>
        </div>
      </div>
    </aside>

    <section class="flow-pane">
      <OnboardingFlow />
    </section>
  </div>
</template>

<style scoped>
/* Hallmark · macrostructure: Narrative Workflow · genre: modern-minimal
 * design-system: design.md · designed-as-app
 * pre-emit critique: P5 H5 E5 S5 R5 V4 · contrast: pass (40–41)
 */
.onboarding-shell {
  --page-pad: clamp(var(--space-sm), 2vw, var(--space-lg));
  --text: var(--color-ink);
  --text-dim: var(--color-ink-2);
  --text-muted: var(--color-muted);
  --surface: var(--color-glass);
  --surface-solid: var(--color-paper-2);
  --surface-2: var(--color-glass-subtle);
  --surface-hover: var(--color-glass-hover);
  --border: var(--color-rule);
  --border-strong: var(--color-rule-2);
  --primary: var(--color-accent);
  --primary-strong: var(--color-accent-strong);
  --primary-glow: color-mix(in oklch, var(--color-accent) 28%, transparent);
  --input-bg: color-mix(in oklch, var(--color-paper-2) 72%, transparent);
  --input-bg-focus: color-mix(in oklch, var(--color-paper-2) 88%, transparent);
  position: relative;
  isolation: isolate;
  display: grid;
  grid-template-columns: minmax(30rem, 1fr) minmax(38rem, 44rem);
  gap: clamp(var(--space-sm), 2vw, var(--space-lg));
  min-height: 100dvh;
  padding: var(--page-pad);
  overflow: clip;
  color: var(--color-ink);
  background: var(--app-bg-image);
  background-size: cover;
  font-family: var(--font-body);
}

.ambient {
  position: absolute;
  z-index: -1;
  width: min(32rem, 40vw);
  aspect-ratio: 1;
  border-radius: 50%;
  background: color-mix(in oklch, var(--color-accent) 22%, transparent);
  filter: blur(5rem);
  opacity: .35;
  pointer-events: none;
}

.ambient-one { top: -18rem; right: 6%; }
.ambient-two { bottom: -22rem; left: 16%; opacity: .2; }

.story-pane,
.flow-pane {
  min-width: 0;
  min-height: calc(100dvh - var(--page-pad) - var(--page-pad));
  border: var(--rule-hair) solid var(--color-rule-2);
  border-radius: var(--radius-panel);
  background: var(--glass-specular), var(--color-glass);
  box-shadow: var(--shadow-card);
  backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
}

.story-pane {
  position: relative;
  display: flex;
  flex-direction: column;
  padding: clamp(var(--space-lg), 3vw, var(--space-xl));
  overflow: hidden;
}

.brand {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  width: max-content;
}

.brand-mark {
  display: grid;
  width: 3rem;
  height: 3rem;
  place-items: center;
  color: var(--color-primary-action-text);
  border-radius: var(--radius-input);
  background: var(--color-primary-action-bg);
}

.brand-name {
  font-family: var(--font-display);
  font-size: var(--text-xl);
  font-weight: 760;
  letter-spacing: -.035em;
}

.story-copy {
  z-index: 2;
  max-width: 48rem;
  margin-top: clamp(var(--space-lg), 5vh, var(--space-xl));
}

.story-copy h1 {
  min-width: 0;
  max-width: 12ch;
  margin: 0;
  overflow-wrap: anywhere;
  font-family: var(--font-display);
  font-size: clamp(var(--text-2xl), 4.5vw, var(--text-display));
  font-style: normal;
  font-weight: 750;
  line-height: 1.1;
  letter-spacing: -.045em;
}

.story-copy h1 span { color: var(--color-accent-text); }

.story-copy p {
  max-width: 52ch;
  margin: var(--space-md) 0 0;
  color: var(--color-ink-2);
  font-size: var(--text-base);
  line-height: 1.75;
}

.network-stage {
  position: relative;
  flex: 1;
  min-height: 21.5rem;
  margin-top: var(--space-md);
}

.network-stage::before {
  position: absolute;
  inset: 8% 3% 10%;
  content: '';
  background-image: radial-gradient(circle, color-mix(in oklch, var(--color-accent) 30%, transparent) 0 1px, transparent 1.5px);
  background-size: .875rem .875rem;
  mask-image: radial-gradient(ellipse at center, var(--color-ink) 0, transparent 72%);
  -webkit-mask-image: radial-gradient(ellipse at center, var(--color-ink) 0, transparent 72%);
  opacity: .5;
}

.graph-plane {
  position: absolute;
  inset: 0 0 5.25rem;
  min-width: 0;
}

.network-links {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
}

.network-links path {
  fill: none;
  stroke: var(--color-accent);
  stroke-opacity: .48;
  stroke-width: 1.5;
}

.network-links circle {
  fill: var(--color-accent);
  animation: linkPulse 2.8s var(--ease-in-out) infinite;
}

.remote-node {
  position: absolute;
  z-index: 2;
  display: grid;
  grid-template-columns: 2.25rem minmax(0, 1fr);
  gap: var(--space-3xs) var(--space-2xs);
  min-width: 8.75rem;
  align-items: center;
  padding: var(--space-2xs);
  border: var(--rule-hair) solid var(--color-rule);
  border-radius: var(--radius-input);
  background: color-mix(in oklch, var(--color-paper-2) 38%, transparent);
}

.remote-node > b {
  display: grid;
  grid-row: span 2;
  width: 2.25rem;
  height: 2.25rem;
  place-items: center;
  color: var(--color-accent-text);
  border: var(--rule-hair) solid color-mix(in oklch, var(--color-accent) 24%, transparent);
  border-radius: var(--radius-xs);
  background: color-mix(in oklch, var(--color-accent) 8%, transparent);
  font-family: var(--font-outlier);
  font-size: .625rem;
  letter-spacing: .04em;
}

.remote-node > span {
  min-width: 0;
  overflow: hidden;
  font-size: var(--text-sm);
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.remote-node small,
.hub-node small {
  display: flex;
  align-items: center;
  gap: var(--space-3xs);
  color: var(--color-muted);
  font-size: .6875rem;
  white-space: nowrap;
}

.remote-node i,
.hub-node i,
.signal-card i {
  width: .375rem;
  height: .375rem;
  flex: none;
  border-radius: 50%;
  background: var(--color-success);
}

.node-dns,
.node-tokyo,
.node-singapore,
.node-frankfurt { transform: translate(-50%, -50%); }

.node-dns { top: 10%; left: 50%; }
.node-tokyo { top: 30%; left: 86%; }
.node-singapore { top: 72%; left: 78%; }
.node-frankfurt { top: 72%; left: 20%; }

.hub-node {
  position: absolute;
  z-index: 3;
  top: 46%;
  left: 50%;
  display: flex;
  flex-direction: column;
  align-items: center;
  transform: translate(-50%, -50%);
}

.hub-icon {
  position: relative;
  isolation: isolate;
  display: grid;
  width: 4.5rem;
  height: 4.5rem;
  place-items: center;
  color: var(--color-primary-action-text);
  border: var(--rule-hair) solid color-mix(in oklch, var(--color-accent) 65%, var(--color-rule));
  border-radius: 50%;
  background: var(--color-primary-action-bg);
  box-shadow: 0 0 0 .5rem color-mix(in oklch, var(--color-accent) 9%, transparent);
}

.hub-radar,
.hub-radar::after {
  position: absolute;
  top: 2.25rem;
  left: 50%;
  width: 7rem;
  height: 7rem;
  content: '';
  border: var(--rule-hair) solid color-mix(in oklch, var(--color-accent) 26%, transparent);
  border-radius: 50%;
  transform: translate(-50%, -50%);
  animation: radar 3.4s var(--ease-out) infinite;
}

.hub-radar::after { top: 50%; animation-delay: 1.7s; }
.hub-node strong { margin-top: var(--space-xs); font-size: var(--text-sm); }
.hub-node small { margin-top: var(--space-3xs); }

.signal-card {
  position: absolute;
  right: 6%;
  bottom: 0;
  left: 6%;
  z-index: 3;
  height: 5.25rem;
  padding-top: var(--space-xs);
  border-top: var(--rule-hair) solid var(--color-rule);
}

.signal-card > span {
  display: flex;
  align-items: center;
  gap: var(--space-2xs);
  color: var(--color-muted);
  font-size: .6875rem;
}

.signal-card svg {
  width: 100%;
  height: 3rem;
  margin-top: var(--space-3xs);
  overflow: visible;
}

.signal-card path {
  fill: none;
  stroke: var(--color-accent);
  stroke-width: 1.5;
}

.flow-pane {
  width: 100%;
  height: min(61rem, calc(100dvh - var(--page-pad) - var(--page-pad)));
  min-height: min(44rem, calc(100dvh - var(--page-pad) - var(--page-pad)));
  justify-self: stretch;
  align-self: center;
  overflow: hidden;
}

:deep(.wrap) {
  display: block;
  height: 100%;
  min-height: 100%;
  padding: 0;
  overflow: visible;
}

:deep(.glow) { display: none; }

:deep(.wizard.card) {
  width: 100%;
  max-width: none;
  height: 100%;
  gap: var(--space-md);
  padding: clamp(var(--space-md), 3vw, var(--space-xl));
  overflow: hidden;
  border: 0;
  border-radius: inherit;
  background: transparent;
  box-shadow: none;
  backdrop-filter: none;
}

:deep(.wiz-head .mark),
:deep(.wiz-head .brand-text b) { display: none; }
:deep(.wiz-head .brand) { gap: 0; }

:deep(.wiz-head .brand-text small) {
  color: var(--color-ink);
  font-size: var(--text-base);
  font-weight: 700;
}

:deep(.wiz-head .skip) { color: var(--color-muted); }
:deep(.wiz-head .skip:hover) { color: var(--color-ink); }

:deep(.dots) {
  position: relative;
  flex-wrap: nowrap;
  gap: var(--space-3xs);
  margin: 0;
}

:deep(.dots::before) {
  position: absolute;
  top: .9375rem;
  right: 7%;
  left: 7%;
  height: var(--rule-hair);
  content: '';
  background: var(--color-rule-2);
}

:deep(.dots li) {
  position: relative;
  z-index: 1;
  flex-direction: column;
  gap: var(--space-2xs);
  min-width: 0;
  color: var(--color-muted);
  text-align: center;
}

:deep(.dots .dot) {
  width: 1.875rem;
  height: 1.875rem;
  border: var(--rule-fine) solid var(--color-rule-2);
  background: var(--color-paper-2);
  box-shadow: 0 0 0 var(--space-3xs) var(--color-paper-2);
}

:deep(.dots li.active .dot) {
  border-color: var(--color-accent);
  background: var(--color-accent);
  box-shadow:
    0 0 0 var(--space-3xs) var(--color-paper-2),
    0 0 1.25rem color-mix(in oklch, var(--color-accent) 30%, transparent);
}

:deep(.dots li.done .dot) {
  border-color: var(--color-accent-strong);
  background: color-mix(in oklch, var(--color-accent) 72%, var(--color-paper-2));
}

:deep(.dots li.active .dot-label) { color: var(--color-ink); }

:deep(.dots .dot-label) {
  max-width: 5rem;
  overflow: hidden;
  font-size: .6875rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

:deep(.step) {
  flex: 1 1 auto;
  min-height: 0 !important;
  margin-right: calc(var(--space-2xs) * -1);
  padding: clamp(var(--space-sm), 3vh, var(--space-xl)) var(--space-2xs) 0 0;
  overflow-x: clip;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  border: 0;
  background: transparent;
  box-shadow: none;
  backdrop-filter: none;
  animation: stepIn var(--dur-short) var(--ease-out) both;
}

:deep(.wizard.card > .panel.step) {
  border: 0;
  background: transparent;
  box-shadow: none;
  backdrop-filter: none;
}

:deep(.step h1) {
  min-width: 0;
  margin: 0 0 var(--space-xs);
  overflow-wrap: anywhere;
  color: var(--color-ink);
  font-family: var(--font-display);
  font-size: clamp(var(--text-xl), 2.15vw, var(--text-2xl));
  font-style: normal;
  line-height: 1.22;
  letter-spacing: -.035em;
}

:deep(.lead) {
  color: var(--color-ink-2);
  font-size: var(--text-sm);
  line-height: 1.75;
}

:deep(.welcome-step) {
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding-top: var(--space-sm);
  padding-bottom: var(--space-sm);
}

:deep(.welcome-eyebrow) {
  color: var(--color-accent-text);
  font-family: var(--font-outlier);
  font-size: var(--text-xs);
}

:deep(.welcome-benefits) {
  grid-template-columns: minmax(0, 1.15fr) minmax(0, .85fr);
  grid-template-rows: repeat(2, minmax(0, 1fr));
  margin-top: clamp(var(--space-md), 4vh, var(--space-xl));
  border-top: var(--rule-hair) solid var(--color-rule);
  border-bottom: var(--rule-hair) solid var(--color-rule);
}

:deep(.welcome-benefit) {
  align-items: center;
  flex-direction: row;
  gap: var(--space-xs);
  min-width: 0;
  padding: var(--space-md);
  border-right: 0;
  border-bottom: var(--rule-hair) solid var(--color-rule);
}

:deep(.welcome-benefit:first-child) {
  grid-row: 1 / 3;
  border-right: var(--rule-hair) solid var(--color-rule);
  border-bottom: 0;
}

:deep(.welcome-benefit:last-child) { border-bottom: 0; }

:deep(.benefit-icon) {
  color: var(--color-accent-text);
  border-color: color-mix(in oklch, var(--color-accent) 24%, transparent);
  background: color-mix(in oklch, var(--color-accent) 8%, transparent);
}

:deep(.region-grid) {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-xs);
  margin-top: var(--space-md);
}

:deep(.region-card) {
  min-height: 4.5rem;
  border-color: var(--color-rule-2);
  background: var(--color-glass-subtle);
  transition:
    transform var(--dur-micro) var(--ease-out),
    border-color var(--dur-micro) var(--ease-out),
    background var(--dur-micro) var(--ease-out);
}

:deep(.region-card:hover) {
  border-color: color-mix(in oklch, var(--color-accent) 38%, var(--color-rule));
  background: var(--color-glass-hover);
  transform: translateY(-1px);
}

:deep(.region-card:focus-within) {
  outline: var(--rule-fine) solid var(--color-focus);
  outline-offset: var(--space-3xs);
}

:deep(.region-card.picked) {
  border-color: color-mix(in oklch, var(--color-accent) 72%, var(--color-rule));
  background: color-mix(in oklch, var(--color-accent) 10%, var(--color-glass-subtle));
}

:deep(.region-card input) { accent-color: var(--color-accent); }
:deep(.badge-rec) { color: var(--color-primary-action-text); background: var(--color-primary-action-bg); }

:deep(.tgt-group h3),
:deep(.ch-existing h3),
:deep(.ch-add-title) {
  color: var(--color-muted);
  font-size: .6875rem;
  letter-spacing: .1em;
}

:deep(.tgt-row) { border-bottom-color: var(--color-rule); }
:deep(.tgt-row:hover) { background: var(--color-glass-subtle); }
:deep(.tgt-kind),
:deep(.ch-chip b) {
  color: var(--color-accent-text);
  border-color: color-mix(in oklch, var(--color-accent) 18%, transparent);
  background: color-mix(in oklch, var(--color-accent) 7%, transparent);
}

:deep(.sys-card),
:deep(.ch-chip),
:deep(.type-tab) {
  border-color: var(--color-rule-2);
  background: var(--color-glass-subtle);
}

:deep(.sys-card:hover),
:deep(.type-tab:hover) {
  border-color: color-mix(in oklch, var(--color-accent) 38%, var(--color-rule));
  background: var(--color-glass-hover);
}

:deep(.sys-card.picked),
:deep(.type-tab.active) {
  color: var(--color-accent-text);
  border-color: color-mix(in oklch, var(--color-accent) 65%, var(--color-rule));
  background: color-mix(in oklch, var(--color-accent) 10%, var(--color-glass-subtle));
}

:deep(.tgt-nat-select),
:deep(.sys-lang),
:deep(.ch-add input),
:deep(.ch-add select),
:deep(.ch-add textarea) {
  color: var(--color-ink);
  border-color: var(--color-rule-2);
  background-color: var(--input-bg);
  color-scheme: inherit;
}

:deep(.tgt-nat-select option),
:deep(.sys-lang option),
:deep(.ch-add option) {
  color: var(--color-ink);
  background-color: var(--color-paper-2);
}

:deep(.tgt-nat-select:focus),
:deep(.sys-lang:focus),
:deep(.ch-add input:focus),
:deep(.ch-add select:focus),
:deep(.ch-add textarea:focus) {
  border-color: var(--color-focus);
  background-color: var(--input-bg-focus);
}

:deep(.wiz-nav) {
  margin-top: auto;
  padding-top: var(--space-md);
  border-color: var(--color-rule);
}

:deep(.wiz-nav .btn-primary) {
  min-width: 10.5rem;
  min-height: 2.75rem;
  font-weight: 650;
}

:deep(.welcome-action) {
  width: 100%;
  min-height: 3rem !important;
}

@keyframes radar {
  0% { opacity: 0; transform: translate(-50%, -50%) scale(.45); }
  30% { opacity: .6; }
  100% { opacity: 0; transform: translate(-50%, -50%) scale(1.35); }
}

@keyframes linkPulse {
  0%, 100% { opacity: .35; }
  50% { opacity: 1; }
}

@keyframes stepIn {
  from { opacity: 0; transform: translateY(var(--space-2xs)); }
  to { opacity: 1; transform: translateY(0); }
}

@media (max-width: 76rem) {
  .onboarding-shell {
    grid-template-columns: minmax(22rem, .8fr) minmax(35rem, 1.2fr);
  }

  .story-pane { padding: var(--space-lg); }
  .story-copy h1 { font-size: clamp(var(--text-2xl), 4vw, var(--text-3xl)); }
  .network-stage { transform: scale(.9); transform-origin: center top; }
}

@media (max-width: 60rem) {
  .onboarding-shell {
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
    min-height: 100dvh;
    padding: var(--space-sm);
    overflow: clip;
  }

  .story-pane {
    min-height: auto;
    flex: 0 0 auto;
    padding: var(--space-sm);
  }

  .brand-mark { width: 2.5rem; height: 2.5rem; }
  .brand-mark svg { width: 1.375rem; height: 1.375rem; }
  .brand-name { font-size: var(--text-lg); }
  .story-copy,
  .network-stage { display: none; }

  .flow-pane {
    width: 100%;
    max-width: 45rem;
    height: calc(100dvh - 7.625rem);
    min-height: 36rem;
    margin: 0 auto;
  }
}

@media (max-width: 40rem) {
  .onboarding-shell { padding: var(--space-2xs); }
  .flow-pane { height: calc(100dvh - 6.625rem); min-height: 34rem; }

  :deep(.wizard.card) {
    gap: var(--space-sm);
    padding: var(--space-md);
  }

  :deep(.dots .dot-label) { display: none; }
  :deep(.welcome-benefits) { grid-template-columns: 1fr; margin-top: var(--space-md); }
  :deep(.welcome-benefit) {
    align-items: center;
    flex-direction: row;
    grid-row: auto;
    padding: var(--space-xs) 0;
    border-right: 0;
    border-bottom: var(--rule-hair) solid var(--color-rule);
  }
  :deep(.welcome-benefit:last-child) { border-bottom: 0; }
  :deep(.region-grid) { grid-template-columns: 1fr; }
  :deep(.tgt-row) { flex-wrap: wrap; }
}

@media (prefers-reduced-motion: reduce) {
  .network-links circle,
  .hub-radar,
  .hub-radar::after,
  :deep(.step) {
    animation-duration: 50ms;
    animation-iteration-count: 1;
  }
}
</style>

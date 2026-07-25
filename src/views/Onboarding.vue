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
          <defs>
            <linearGradient id="link-gradient" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="720" y2="420">
              <stop offset="0" stop-color="#38bdf8" stop-opacity=".16" />
              <stop offset=".55" stop-color="#38bdf8" stop-opacity=".95" />
              <stop offset="1" stop-color="#818cf8" stop-opacity=".3" />
            </linearGradient>
            <filter id="link-glow" filterUnits="userSpaceOnUse" x="-40" y="-40" width="800" height="500">
              <feGaussianBlur stdDeviation="2.2" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>
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
          <b>DNS</b><span>DNS</span><small><i></i>{{ copy.online }} <em>≈ 8 ms</em></small>
        </div>
        <div class="remote-node node-tokyo">
          <b>TYO</b><span>{{ copy.tokyo }}</span><small><i></i>{{ copy.online }} <em>≈ 32 ms</em></small>
        </div>
        <div class="remote-node node-singapore">
          <b>SIN</b><span>{{ copy.singapore }}</span><small><i></i>{{ copy.online }} <em>≈ 48 ms</em></small>
        </div>
        <div class="remote-node node-frankfurt">
          <b>FRA</b><span>{{ copy.frankfurt }}</span><small><i></i>{{ copy.online }} <em>≈ 168 ms</em></small>
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
.onboarding-shell {
  color-scheme: dark;
  --text: #e8eef8;
  --text-dim: #9aa8bd;
  --text-muted: #68778d;
  --surface: rgba(13, 21, 34, 0.8);
  --surface-solid: #0b1727;
  --surface-2: rgba(25, 37, 55, 0.64);
  --surface-hover: rgba(35, 50, 72, 0.72);
  --border: rgba(148, 199, 232, 0.1);
  --border-strong: rgba(148, 199, 232, 0.18);
  --input-bg: rgba(6, 12, 22, 0.72);
  --input-bg-focus: rgba(6, 12, 22, 0.9);
  position: relative;
  min-height: 100vh;
  display: grid;
  grid-template-columns: minmax(520px, 1fr) minmax(640px, 720px);
  gap: clamp(24px, 2vw, 40px);
  align-items: center;
  padding: clamp(20px, 2.2vw, 40px);
  padding-inline: max(clamp(20px, 2.2vw, 40px), calc((100vw - 1920px) / 2));
  color: var(--text);
  background:
    linear-gradient(rgba(46, 96, 128, 0.035) 1px, transparent 1px),
    linear-gradient(90deg, rgba(46, 96, 128, 0.035) 1px, transparent 1px),
    #070b12;
  background-size: 38px 38px;
  overflow: hidden;
  isolation: isolate;
}

.onboarding-shell::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -2;
  background:
    radial-gradient(700px 520px at 35% 65%, rgba(14, 165, 233, 0.12), transparent 70%),
    radial-gradient(620px 480px at 82% 12%, rgba(59, 130, 246, 0.12), transparent 68%),
    linear-gradient(115deg, rgba(7, 11, 18, 0.08), rgba(7, 11, 18, 0.66));
}

.ambient {
  position: absolute;
  z-index: -1;
  width: 520px;
  height: 520px;
  border-radius: 50%;
  filter: blur(80px);
  pointer-events: none;
  opacity: 0.22;
}

.ambient-one { top: -300px; right: 2%; background: #0ea5e9; }
.ambient-two { bottom: -340px; left: 20%; background: #4f46e5; opacity: 0.14; }

.story-pane {
  position: relative;
  align-self: stretch;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.brand {
  display: inline-flex;
  align-items: center;
  gap: 15px;
  width: max-content;
}

.brand-mark {
  display: grid;
  place-items: center;
  width: 54px;
  height: 54px;
  color: #55d4ff;
  border: 2px solid #22d3ee;
  border-radius: 15px;
  background: linear-gradient(145deg, rgba(14, 165, 233, 0.14), rgba(37, 99, 235, 0.04));
  box-shadow: 0 0 28px rgba(56, 189, 248, 0.12), inset 0 0 18px rgba(56, 189, 248, 0.06);
}

.brand-name {
  font-size: 31px;
  font-weight: 720;
  letter-spacing: -0.035em;
}

.story-copy {
  margin-top: clamp(54px, 8vh, 94px);
  max-width: 760px;
}

.story-copy h1 {
  margin: 0;
  font-size: clamp(42px, 4.15vw, 68px);
  line-height: 1.12;
  letter-spacing: -0.055em;
  font-weight: 720;
}

.story-copy h1 span {
  color: transparent;
  background: linear-gradient(110deg, #2dd4ff 10%, #3b82f6 55%, #818cf8);
  background-clip: text;
  -webkit-background-clip: text;
}

.story-copy p {
  max-width: 680px;
  margin: 20px 0 0;
  color: #a8b5c8;
  font-size: clamp(16px, 1.25vw, 20px);
  line-height: 1.75;
}

.network-stage {
  position: relative;
  flex: 1;
  min-height: 540px;
  margin-top: 12px;
}

.network-stage::before {
  content: '';
  position: absolute;
  left: -18%;
  right: -4%;
  top: 6%;
  bottom: 100px;
  background-image: radial-gradient(circle, rgba(56, 189, 248, 0.2) 0 1px, transparent 1.5px);
  background-size: 13px 13px;
  mask-image: radial-gradient(ellipse at 50% 54%, #000 0, rgba(0, 0, 0, 0.72) 40%, transparent 73%);
  -webkit-mask-image: radial-gradient(ellipse at 50% 54%, #000 0, rgba(0, 0, 0, 0.72) 40%, transparent 73%);
  opacity: 0.6;
}

.graph-plane {
  position: absolute;
  inset: 0 0 118px;
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
  stroke: #38bdf8;
  stroke-opacity: 0.82;
  stroke-width: 2;
  filter: url(#link-glow);
}

.network-links circle {
  fill: #7dd3fc;
  filter: url(#link-glow);
  animation: linkPulse 2.8s ease-in-out infinite;
}

.remote-node {
  position: absolute;
  z-index: 2;
  min-width: 168px;
  display: grid;
  grid-template-columns: 42px 1fr;
  gap: 3px 11px;
  align-items: center;
  padding: 13px 14px;
  border: 1px solid rgba(125, 211, 252, 0.28);
  border-radius: 13px;
  background: linear-gradient(145deg, #132337, #0a1422);
  box-shadow: 0 16px 42px rgba(0, 0, 0, 0.28), 0 0 24px rgba(56, 189, 248, 0.08);
  backdrop-filter: blur(12px);
}

.remote-node > b {
  position: relative;
  grid-row: span 2;
  display: grid;
  place-items: center;
  width: 42px;
  height: 42px;
  overflow: hidden;
  color: #83dcff;
  border: 1px solid rgba(125, 211, 252, 0.12);
  border-radius: 10px;
  background:
    linear-gradient(145deg, rgba(56, 189, 248, 0.12), rgba(12, 54, 84, 0.3)),
    #10263b;
  box-shadow: inset 0 1px rgba(255, 255, 255, 0.035), inset 0 0 18px rgba(56, 189, 248, 0.035);
  font-family: var(--mono);
  font-size: 10px;
  font-weight: 750;
  letter-spacing: 0.035em;
  text-shadow: 0 0 12px rgba(56, 189, 248, 0.38);
}

.remote-node > span {
  color: #eaf7ff;
  font-size: 15px;
  font-weight: 650;
  white-space: nowrap;
}

.remote-node small,
.hub-node small {
  display: flex;
  align-items: center;
  gap: 5px;
  color: #8696aa;
  font-size: 10.5px;
  white-space: nowrap;
}

.remote-node i,
.hub-node i,
.signal-card i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #34d399;
  box-shadow: 0 0 10px rgba(52, 211, 153, 0.75);
}

.remote-node em {
  margin-left: 5px;
  padding: 1px 6px;
  color: #6ee7b7;
  border: 1px solid rgba(52, 211, 153, 0.28);
  border-radius: 999px;
  background: rgba(52, 211, 153, 0.06);
  font-style: normal;
  font-weight: 600;
}

.node-dns,
.node-tokyo,
.node-singapore,
.node-frankfurt {
  transform: translate(-50%, -50%);
}

.node-dns { top: 9%; left: 50%; }
.node-tokyo { top: 27%; left: 88%; }
.node-singapore { top: 63%; left: 80%; }
.node-frankfurt { top: 63%; left: 18%; }

.hub-node {
  position: absolute;
  z-index: 3;
  left: 50%;
  top: 43%;
  display: flex;
  flex-direction: column;
  align-items: center;
  transform: translate(-50%, -50%);
}

.hub-icon {
  position: relative;
  isolation: isolate;
  display: grid;
  place-items: center;
  width: 84px;
  height: 84px;
  color: #d1f5ff;
  border: 2px solid #65d9ff;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 27%, #1fa9e7 0, #1177b7 30%, #0b4a83 58%, #062540 100%);
  box-shadow:
    inset 0 1px 1px rgba(255, 255, 255, 0.24),
    inset 0 -13px 24px rgba(1, 15, 34, 0.34),
    0 0 0 7px rgba(56, 189, 248, 0.065),
    0 0 46px rgba(56, 189, 248, 0.46);
}

.hub-icon::before {
  position: absolute;
  inset: -13px;
  z-index: -1;
  content: '';
  border: 1px solid rgba(125, 211, 252, 0.16);
  border-radius: 50%;
  box-shadow: 0 0 28px rgba(56, 189, 248, 0.12);
}

.hub-icon::after {
  position: absolute;
  inset: 8px;
  z-index: 0;
  content: '';
  border: 1px solid rgba(186, 230, 253, 0.08);
  border-radius: 50%;
}

.hub-icon svg {
  position: relative;
  z-index: 1;
  filter: drop-shadow(0 0 7px rgba(125, 211, 252, 0.46));
}

.hub-radar,
.hub-radar::after {
  position: absolute;
  left: 50%;
  top: 40px;
  width: 130px;
  height: 130px;
  content: '';
  border: 1px solid rgba(56, 189, 248, 0.16);
  border-radius: 50%;
  transform: translate(-50%, -50%);
  animation: radar 3.4s ease-out infinite;
}

.hub-radar::after { top: 50%; animation-delay: 1.7s; }
.hub-node strong { margin-top: 13px; color: #eaf7ff; font-size: 14px; }
.hub-node small { margin-top: 3px; }

.signal-card {
  position: absolute;
  left: 2%;
  right: 16%;
  bottom: 0;
  z-index: 3;
  height: 112px;
  padding: 13px 16px 8px;
  border: 1px solid rgba(125, 211, 252, 0.2);
  border-radius: 14px;
  background: rgba(7, 16, 28, 0.8);
  box-shadow: 0 16px 46px rgba(0, 0, 0, 0.26);
  backdrop-filter: blur(12px);
}

.signal-card > span {
  display: flex;
  align-items: center;
  gap: 7px;
  color: #8494a9;
  font-size: 11px;
}

.signal-card svg { width: 100%; height: 62px; margin-top: 3px; overflow: visible; }
.signal-card path {
  fill: none;
  stroke: #20c7ff;
  stroke-width: 1.6;
  filter: drop-shadow(0 0 5px rgba(32, 199, 255, 0.5));
}

.flow-pane {
  width: 100%;
  height: min(980px, calc(100vh - 40px));
  min-height: min(700px, calc(100vh - 40px));
  justify-self: stretch;
  min-width: 0;
  align-self: center;
}

:deep(.wrap) {
  min-height: 100%;
  height: 100%;
  display: block;
  padding: 0;
  overflow: visible;
}

:deep(.glow) { display: none; }

:deep(.wizard.card) {
  width: 100%;
  max-width: none;
  height: 100%;
  gap: 22px;
  padding: clamp(26px, 2.4vw, 40px);
  border: 1px solid rgba(125, 211, 252, 0.35);
  border-radius: 20px;
  background:
    linear-gradient(145deg, rgba(18, 31, 49, 0.92), rgba(8, 17, 29, 0.9)),
    rgba(10, 18, 30, 0.92);
  box-shadow: 0 30px 90px rgba(0, 0, 0, 0.38), 0 0 44px rgba(56, 189, 248, 0.06), inset 0 1px rgba(255, 255, 255, 0.04);
  backdrop-filter: blur(22px);
  overflow: hidden;
}

:deep(.wiz-head .mark) { display: none; }
:deep(.wiz-head .brand) { gap: 0; }
:deep(.wiz-head .brand-text b) { display: none; }
:deep(.wiz-head .brand-text small) {
  color: #e8eef8;
  font-size: 16px;
  font-weight: 650;
}
:deep(.wiz-head .skip) { color: #7f90a6; }

:deep(.dots) {
  position: relative;
  flex-wrap: nowrap;
  gap: 4px;
  margin: 6px 0 0;
}

:deep(.dots::before) {
  content: '';
  position: absolute;
  top: 15px;
  left: 7%;
  right: 7%;
  height: 1px;
  background: rgba(148, 199, 232, 0.2);
}

:deep(.dots li) {
  position: relative;
  z-index: 1;
  flex-direction: column;
  min-width: 0;
  gap: 8px;
  color: #64748b;
  text-align: center;
}

:deep(.dots .dot) {
  width: 31px;
  height: 31px;
  border: 1px solid rgba(148, 199, 232, 0.28);
  background: #0d1725;
  box-shadow: 0 0 0 4px #0d1725;
}

:deep(.dots li.active .dot) {
  border-color: #38bdf8;
  background: linear-gradient(145deg, #62d5ff, #0ea5e9);
  box-shadow: 0 0 22px rgba(56, 189, 248, 0.52), 0 0 0 4px #0d1725;
}

:deep(.dots li.done .dot) {
  border-color: rgba(52, 211, 153, 0.42);
  background: #34d399;
}

:deep(.dots .dot-label) {
  max-width: 80px;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 10.5px;
  white-space: nowrap;
}

:deep(.step) {
  flex: 1 1 auto;
  min-height: 0 !important;
  margin-right: -10px;
  padding-right: 10px;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  padding-top: clamp(18px, 3vh, 42px);
  border: 0;
  background: transparent;
  box-shadow: none;
  backdrop-filter: none;
  animation: stepIn 0.32s ease both;
}

:deep(.step h1) {
  margin: 0 0 12px;
  color: #f1f6fd;
  font-size: clamp(25px, 2.15vw, 34px);
  line-height: 1.22;
  letter-spacing: -0.035em;
}

:deep(.lead) {
  color: #9aa8bd;
  font-size: 13.5px;
  line-height: 1.8;
}

:deep(.welcome-step) {
  padding-top: clamp(8px, 1.8vh, 24px) !important;
}

:deep(.region-grid) { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-top: 24px; }
:deep(.region-card) {
  min-height: 64px;
  border-color: rgba(148, 199, 232, 0.13);
  background: rgba(11, 20, 33, 0.54);
  transition: border-color 0.16s, background 0.16s, transform 0.16s;
}
:deep(.region-card:hover) { border-color: rgba(125, 211, 252, 0.34); transform: translateY(-1px); }
:deep(.region-card.picked) {
  border-color: rgba(56, 189, 248, 0.72);
  background: linear-gradient(145deg, rgba(56, 189, 248, 0.13), rgba(59, 130, 246, 0.06));
}
:deep(.badge-rec) { color: #04121c; }

:deep(.tgt-group h3) { color: #8796aa; font-size: 10.5px; letter-spacing: 0.1em; }
:deep(.tgt-row) { border-bottom: 1px solid rgba(148, 199, 232, 0.07); }
:deep(.tgt-row:hover) { background: rgba(56, 189, 248, 0.045); }
:deep(.tgt-kind) {
  color: #7dd3fc;
  border: 1px solid rgba(56, 189, 248, 0.16);
  background: rgba(56, 189, 248, 0.07);
}

:deep(.tgt-nat-select) {
  color: #e8eef8;
  border-color: rgba(56, 189, 248, 0.45);
  background-color: #0b1727;
  color-scheme: dark;
}

:deep(.tgt-nat-select option) {
  color: #e8eef8;
  background-color: #0b1727;
}

/* notify step: the shared channel form is built for the light app shell, so its
   controls need the same dark treatment as the rest of the wizard. */
:deep(.sys-card) {
  border-color: rgba(148, 199, 232, 0.13);
  background: rgba(11, 20, 33, 0.54);
  transition: border-color 0.16s, background 0.16s;
}
:deep(.sys-card:hover) { border-color: rgba(125, 211, 252, 0.34); }
:deep(.sys-card.picked) {
  border-color: rgba(56, 189, 248, 0.72);
  background: linear-gradient(145deg, rgba(56, 189, 248, 0.13), rgba(59, 130, 246, 0.06));
}
:deep(.ch-existing h3),
:deep(.ch-add-title) { color: #8796aa; font-size: 10.5px; letter-spacing: 0.1em; }
:deep(.ch-chip) { border-color: rgba(148, 199, 232, 0.13); }
:deep(.ch-chip b) { color: #7dd3fc; background: rgba(56, 189, 248, 0.07); }

:deep(.type-tab) {
  color: #9aa8bd;
  border-color: rgba(148, 199, 232, 0.16);
  background: rgba(11, 20, 33, 0.54);
}
:deep(.type-tab:hover) { color: #e8eef8; }
:deep(.type-tab.active) {
  color: #7dd3fc;
  border-color: rgba(56, 189, 248, 0.45);
  background: rgba(56, 189, 248, 0.1);
}

/* Inputs/selects/textareas inside the channel form (and the system card's
   language select) — dark surfaces with a dark native dropdown/caret. */
:deep(.sys-lang),
:deep(.ch-add input),
:deep(.ch-add select),
:deep(.ch-add textarea) {
  color: #e8eef8;
  border-color: rgba(148, 199, 232, 0.18);
  background-color: var(--input-bg);
  color-scheme: dark;
}
:deep(.sys-lang option),
:deep(.ch-add option) {
  color: #e8eef8;
  background-color: #0b1727;
}
:deep(.ch-add input:focus),
:deep(.ch-add select:focus),
:deep(.ch-add textarea:focus) {
  border-color: rgba(56, 189, 248, 0.55);
  background-color: var(--input-bg-focus);
}

:deep(.wiz-nav) {
  margin-top: auto;
  padding-top: 20px;
  border-color: rgba(148, 199, 232, 0.1);
}

:deep(.wiz-nav .btn-primary) {
  min-width: 168px;
  min-height: 44px;
  font-weight: 650;
}

:deep(.welcome-action) {
  width: 100%;
  min-height: 48px !important;
}

@keyframes radar {
  0% { opacity: 0; transform: translate(-50%, -50%) scale(0.45); }
  30% { opacity: 0.65; }
  100% { opacity: 0; transform: translate(-50%, -50%) scale(1.35); }
}

@keyframes linkPulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 1; }
}

@keyframes stepIn {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

@media (max-width: 1220px) {
  .onboarding-shell {
    grid-template-columns: minmax(340px, 0.8fr) minmax(560px, 1.2fr);
    gap: 26px;
    padding: 24px;
  }
  .story-copy h1 { font-size: 46px; }
  .network-stage { width: 114%; transform: scale(0.88); transform-origin: left top; }
}

@media (max-width: 960px) {
  .onboarding-shell {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 18px;
    padding: 20px;
    overflow: auto;
  }
  .story-pane { flex: 0 0 auto; }
  .brand-mark { width: 42px; height: 42px; border-radius: 12px; }
  .brand-mark svg { width: 22px; height: 22px; }
  .brand-name { font-size: 23px; }
  .story-copy, .network-stage { display: none; }
  .flow-pane {
    width: 100%;
    max-width: 720px;
    height: calc(100vh - 100px);
    min-height: 600px;
    margin: 0 auto;
  }
}

@media (max-width: 620px) {
  .onboarding-shell { padding: 14px; }
  .flow-pane { height: calc(100vh - 84px); min-height: 540px; }
  :deep(.wizard.card) { padding: 22px 18px 18px; border-radius: 16px; }
  :deep(.dots .dot-label) { display: none; }
  :deep(.region-grid) { grid-template-columns: 1fr; }
  :deep(.tgt-row) { flex-wrap: wrap; }
}

@media (prefers-reduced-motion: reduce) {
  .network-links circle, .hub-radar, .hub-radar::after, :deep(.step) { animation: none; }
}
</style>

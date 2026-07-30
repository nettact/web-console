<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import type { DashboardPathStage } from '../lib/dashboardPath'

interface NATDetail {
  type: string
  mapping: string
  filtering: string
}

const props = defineProps<{
  stages: DashboardPathStage[]
  root: DashboardPathStage | null
  agentName: string
  interfaceKind: 'wifi' | 'wired' | 'unknown'
  interfaceDetail: string
  natDetail: NATDetail | null
}>()

const { t } = useI18n()

function stateLabel(stage: DashboardPathStage): string {
  return stage.affected ? t('dashboard.pathAffected') : t(`dashboard.pathState_${stage.state}`)
}

function stageTitle(stage: DashboardPathStage): string {
  if (stage.id !== 'interface') return t(`dashboard.pathStage_${stage.id}`)
  if (props.interfaceKind === 'wifi') return t('dashboard.pathStage_wifi')
  if (props.interfaceKind === 'wired') return t('dashboard.pathStage_wired')
  return t('dashboard.pathStage_interface')
}

function detail(stage: DashboardPathStage): string {
  if (stage.id === 'host') return props.agentName
  if (stage.id === 'interface') return props.interfaceDetail || t('dashboard.pathInterfaceUnknown')
  if (stage.faultTarget) return stage.faultTarget.name || stage.faultTarget.target
  if (stage.id === 'nat') return props.natDetail?.type || t('dashboard.notDetected')
  if (!stage.total) return t('dashboard.pathNotConfigured')
  return t('dashboard.pathTargets', { healthy: stage.healthy, total: stage.total })
}

function layerLabel(stage: DashboardPathStage): string {
  return t(`dashboard.pathLayer_${stage.id}`)
}

function natModeCode(value: string, dimension: 'mapping' | 'filtering'): string {
  if (value === 'Endpoint-Independent') return dimension === 'mapping' ? 'EIM' : 'EIF'
  if (value === 'Address-Dependent') return dimension === 'mapping' ? 'ADM' : 'ADF'
  if (value === 'Address-and-Port-Dependent') return dimension === 'mapping' ? 'APDM' : 'APDF'
  return value
}

function latencyText(value: number): string {
  if (value < 100) return value.toFixed(1)
  return Math.round(value).toString()
}

function compactTargetLabel(name: string, target: string): string {
  const visualLength = (value: string) => [...value].reduce((total, char) => total + (char.charCodeAt(0) > 127 ? 2 : 1), 0)
  const compactAddress = target.replace(/^https?:\/\//, '').split('/')[0].replace(/^www\./, '')
  const usableName = name || compactAddress
  return visualLength(usableName) <= visualLength(compactAddress) ? usableName : compactAddress
}

function fact(stage: DashboardPathStage): string {
  if (stage.id === 'host') return t('dashboard.pathFactTelemetry')
  if (stage.id === 'interface') return t('dashboard.pathFactDefaultRoute')
  if (stage.faultTarget) return t('dashboard.pathFaultTargetValue', { target: stage.faultTarget.target })
  if (stage.id === 'nat' && props.natDetail) {
    return t('dashboard.pathNatModes', {
      mapping: natModeCode(props.natDetail.mapping, 'mapping'),
      filtering: natModeCode(props.natDetail.filtering, 'filtering'),
    })
  }
  if (stage.featuredTarget?.latencyMs != null) {
    return t('dashboard.pathSlowestTargetValue', {
      latency: latencyText(stage.featuredTarget.latencyMs),
      name: compactTargetLabel(stage.featuredTarget.name, stage.featuredTarget.target),
    })
  }
  if (stage.featuredTarget) {
    return t('dashboard.pathMonitorTargetValue', {
      name: compactTargetLabel(stage.featuredTarget.name, stage.featuredTarget.target),
    })
  }
  if (!stage.total) return t('dashboard.pathAwaitingMonitor')
  return t('dashboard.pathAwaitingMonitor')
}

function factTitle(stage: DashboardPathStage): string {
  if (stage.id === 'nat' && !stage.faultTarget && props.natDetail) {
    return t('dashboard.pathNatModes', {
      mapping: props.natDetail.mapping,
      filtering: props.natDetail.filtering,
    })
  }
  if (stage.featuredTarget?.latencyMs != null) {
    return t('dashboard.pathSlowestTargetTitle', {
      latency: latencyText(stage.featuredTarget.latencyMs),
      name: stage.featuredTarget.name || stage.featuredTarget.target,
      target: stage.featuredTarget.target,
    })
  }
  if (stage.featuredTarget) {
    return t('dashboard.pathMonitorTargetTitle', {
      name: stage.featuredTarget.name || stage.featuredTarget.target,
      target: stage.featuredTarget.target,
    })
  }
  return fact(stage)
}

function step(index: number): string {
  return String(index + 1).padStart(2, '0')
}
</script>

<template>
  <div class="path-card-body">
    <div class="path-card-head">
      <div class="path-card-title">
        <span class="section-kicker">{{ t('dashboard.pathKicker') }}</span>
        <h3>{{ t('dashboard.pathStatus') }}</h3>
      </div>
      <div class="path-card-actions">
        <span class="path-summary" :class="root ? `tone-${root.tone}` : 'tone-good'">
          <i></i>
          {{ root ? `${stageTitle(root)} · ${stateLabel(root)}` : t('dashboard.pathOverallHealthy') }}
        </span>
        <RouterLink class="path-view-link" :to="{ path: '/target-status' }">
          {{ t('dashboard.viewAll') }}
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h9M9 4l4 4-4 4" /></svg>
        </RouterLink>
      </div>
    </div>

    <div class="path-flow">
      <template v-for="(stage, index) in stages" :key="stage.id">
        <span
          v-if="index"
          class="path-connector"
          :class="{ broken: root?.id === stage.id, affected: stage.affected }"
          aria-hidden="true"
        >
          <i></i><b></b>
        </span>
        <article class="path-node" :class="[`tone-${stage.tone}`, { affected: stage.affected, root: root?.id === stage.id }]">
          <div class="path-node-main">
            <span class="path-icon">
              <svg v-if="stage.id === 'host'" viewBox="0 0 24 24" aria-hidden="true">
                <rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8M12 17v4M7 8h.01M10 8h7M7 12h.01M10 12h5" />
              </svg>
              <svg v-else-if="stage.id === 'interface' && interfaceKind === 'wifi'" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4.5 9.5a11 11 0 0 1 15 0M7.5 13a6.7 6.7 0 0 1 9 0M10.5 16.5a2.5 2.5 0 0 1 3 0" /><circle cx="12" cy="19" r="1" />
              </svg>
              <svg v-else-if="stage.id === 'interface'" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 8h14v8H5zM8 8V5M12 8V5M16 8V5M8 19v-3M12 19v-3M16 19v-3" />
              </svg>
              <svg v-else-if="stage.id === 'gateway'" viewBox="0 0 24 24" aria-hidden="true">
                <rect x="3" y="8" width="18" height="9" rx="2" /><path d="M7 12h.01M10 12h.01M16 12h2M12 8V5M9.5 5h5" />
              </svg>
              <svg v-else-if="stage.id === 'nat'" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 7h12M14 4l3 3-3 3M19 17H7M10 14l-3 3 3 3" /><path d="M5 7v5M19 12v5" />
              </svg>
              <svg v-else-if="stage.id === 'internet'" viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.6 2.5 4 5.5 4 9s-1.4 6.5-4 9c-2.6-2.5-4-5.5-4-9s1.4-6.5 4-9z" />
              </svg>
              <svg v-else-if="stage.id === 'dns'" viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="6" cy="7" r="2.5" /><circle cx="18" cy="7" r="2.5" /><circle cx="12" cy="18" r="2.5" /><path d="m8.2 8.3 2.6 7M15.8 8.3l-2.6 7M8.5 7h7" />
              </svg>
              <svg v-else viewBox="0 0 24 24" aria-hidden="true">
                <rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 9h18M7 7h.01M10 7h.01M9 13l-2 2 2 2M15 13l2 2-2 2" />
              </svg>
            </span>
            <div class="path-node-copy">
              <span class="path-layer">{{ layerLabel(stage) }}</span>
              <strong>{{ stageTitle(stage) }}</strong>
              <small :title="detail(stage)">{{ detail(stage) }}</small>
            </div>
            <div class="path-node-meta">
              <span class="path-step">{{ step(index) }}</span>
              <em><i></i>{{ stateLabel(stage) }}</em>
            </div>
            <div
              class="path-node-fact"
              :class="{ 'is-fault': stage.faultTarget, 'is-target': stage.featuredTarget && stage.id !== 'nat' }"
              :title="factTitle(stage)"
            >
              <small>{{ fact(stage) }}</small>
            </div>
          </div>
        </article>
      </template>
    </div>

    <div class="path-diagnosis" :class="root ? `tone-${root.tone}` : 'tone-good'">
      <span class="path-diagnosis-icon">
        <svg v-if="root" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3 18 17H2L10 3Z" /><path d="M10 8v4M10 14.5h.01" /></svg>
        <svg v-else viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7" /><path d="m6.8 10.2 2 2 4.5-4.5" /></svg>
      </span>
      <div>
        <strong>{{ root ? `${stageTitle(root)} · ${stateLabel(root)}` : t('dashboard.pathOverallHealthy') }}</strong>
        <p>{{ root ? t(`dashboard.pathDiagnosis_${root.id}`) : t('dashboard.pathDiagnosisHealthy') }}</p>
      </div>
      <span v-if="root?.faultTarget" class="path-diagnosis-target">
        <small>{{ t('dashboard.pathFaultTarget') }}</small>
        <strong>{{ root.faultTarget.name || root.faultTarget.target }}</strong>
        <em v-if="root.faultTarget.target !== root.faultTarget.name">{{ root.faultTarget.target }}</em>
      </span>
    </div>
  </div>
</template>

<style scoped>
/* Hallmark · component: operational path · genre: modern-minimal · theme: design.md
 * data states: healthy · warning · fault · unavailable
 * pre-emit critique: P5 H5 E5 S5 R5 V5 · contrast: pass (40–41)
 */
.path-card-body {
  position: relative;
  padding: 22px;
  overflow: hidden;
}
.path-card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; }
.path-card-title h3 { margin-top: 5px; font-size: 19px; letter-spacing: -.02em; }
.path-card-actions { display: flex; align-items: center; gap: 14px; }
.path-summary {
  --summary-color: var(--color-ink-2);
  --summary-status-color: var(--color-muted);
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-height: 27px;
  padding: 0 10px;
  color: var(--summary-color);
  font-size: 10px;
  font-weight: 750;
  border: 1px solid var(--color-rule-2);
  border-radius: 999px;
  background: transparent;
}
.path-summary i, .path-node-meta em i {
  width: 6px;
  height: 6px;
  flex: none;
  border-radius: 50%;
  background: currentColor;
  box-shadow: 0 0 0 3px color-mix(in srgb, currentColor 13%, transparent);
}
.path-summary i { color: var(--summary-status-color); }
.path-summary.tone-good { --summary-status-color: var(--color-success); }
.path-summary.tone-warn {
  --summary-color: var(--color-warning);
  --summary-status-color: var(--color-warning);
  border-color: color-mix(in srgb, var(--color-warning) 38%, var(--color-rule));
  background: color-mix(in srgb, var(--color-warning) 7%, var(--color-glass-subtle));
}
.path-summary.tone-bad {
  --summary-color: var(--color-danger);
  --summary-status-color: var(--color-danger);
  border-color: color-mix(in srgb, var(--color-danger) 38%, var(--color-rule));
  background: color-mix(in srgb, var(--color-danger) 7%, var(--color-glass-subtle));
}
.path-summary.tone-muted { --summary-status-color: var(--color-muted); }
.path-view-link {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 44px;
  color: var(--color-accent);
  font-size: 10px;
  font-weight: 700;
  text-decoration: none;
  white-space: nowrap;
}
.path-view-link svg { width: 14px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.6; transition: transform var(--dur-micro) var(--ease-out); }
.path-view-link:hover svg,
.path-view-link:focus-visible svg { transform: translateX(2px); }
.path-view-link:focus-visible { border-radius: var(--radius-xs); outline: 2px solid var(--color-focus); outline-offset: 3px; }
.path-flow {
  display: grid;
  grid-template-columns:
    minmax(132px, 204px) minmax(14px, 1fr)
    minmax(132px, 204px) minmax(14px, 1fr)
    minmax(132px, 204px) minmax(14px, 1fr)
    minmax(132px, 204px) minmax(14px, 1fr)
    minmax(132px, 204px) minmax(14px, 1fr)
    minmax(132px, 204px) minmax(14px, 1fr)
    minmax(132px, 204px);
  align-items: stretch;
  margin-top: 20px;
}
.path-node {
  --node-color: var(--color-ink-2);
  --status-color: var(--node-color);
  min-width: 0;
  min-height: 104px;
  padding: 11px;
  border: 1px solid var(--color-rule);
  border-radius: 15px;
  background: transparent;
}
.path-node.tone-good {
  --status-color: var(--color-success);
}
.path-node.tone-warn {
  --node-color: var(--color-warning);
  border-color: color-mix(in srgb, var(--color-warning) 34%, var(--color-rule));
  background: color-mix(in srgb, var(--color-warning) 5%, transparent);
}
.path-node.tone-bad {
  --node-color: var(--color-danger);
  border-color: color-mix(in srgb, var(--color-danger) 34%, var(--color-rule));
  background: color-mix(in srgb, var(--color-danger) 5%, transparent);
}
.path-node.tone-muted {
  --node-color: var(--color-ink-2);
  background: var(--color-glass-subtle);
}
.path-node.root {
  border-color: color-mix(in srgb, var(--node-color) 62%, var(--color-rule));
  outline: 2px solid color-mix(in srgb, var(--node-color) 14%, transparent);
  outline-offset: 2px;
  transform: translateY(-2px);
}
.path-node.affected { opacity: .65; filter: saturate(.72); }
.path-node-main {
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr) auto;
  grid-template-rows: minmax(0, 1fr) auto;
  align-items: start;
  column-gap: 9px;
  row-gap: 8px;
  height: 100%;
}
.path-icon {
  display: grid;
  grid-row: 1 / span 2;
  align-self: center;
  width: 38px;
  height: 38px;
  place-items: center;
  flex: none;
  color: var(--color-ink);
  border: 1px solid var(--color-rule);
  border-radius: 11px;
  background: transparent;
}
.path-node.tone-warn .path-icon,
.path-node.tone-bad .path-icon {
  color: var(--node-color);
  border-color: color-mix(in srgb, var(--node-color) 25%, var(--color-rule));
  background: color-mix(in srgb, var(--node-color) 8%, transparent);
}
.path-node.tone-muted .path-icon {
  color: var(--color-ink-2);
  background: var(--color-glass-subtle);
}
.path-icon svg { width: 21px; height: 21px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.55; }
.path-step { color: var(--color-ink-2); font-family: var(--font-outlier); font-size: 9px; font-weight: 700; letter-spacing: .1em; }
.path-node-copy { display: grid; gap: 2px; min-width: 0; }
.path-layer {
  color: color-mix(in srgb, var(--node-color) 78%, var(--color-muted));
  font-size: 8px;
  font-weight: 800;
  letter-spacing: .08em;
  line-height: 1.2;
  text-transform: uppercase;
}
.path-node-copy strong { min-width: 0; overflow: hidden; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.path-node-copy small {
  min-width: 0;
  overflow: hidden;
  color: var(--color-muted);
  font-size: 9px;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.path-node-meta {
  display: grid;
  align-self: stretch;
  justify-items: end;
  min-width: 30px;
}
.path-node-meta em {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  align-self: end;
  color: var(--color-ink-2);
  font-size: 9px;
  font-style: normal;
  font-weight: 750;
  white-space: nowrap;
}
.path-node-meta em i { width: 5px; height: 5px; color: var(--status-color); box-shadow: none; }
.path-node-fact {
  display: flex;
  grid-column: 2 / 4;
  align-items: center;
  min-width: 0;
  padding-top: 7px;
  border-top: 1px solid color-mix(in srgb, var(--node-color) 13%, var(--color-rule));
}
.path-node-fact small {
  width: 100%;
  min-width: 0;
  overflow: hidden;
  color: var(--color-muted);
  font-size: 8px;
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.path-node-fact.is-fault small { color: var(--node-color); font-weight: 750; }
.path-node-fact.is-target:not(.is-fault) small { color: var(--color-ink); }
.path-connector {
  --connector-color: var(--color-ink-2);
  position: relative;
  display: flex;
  align-items: center;
  min-width: 0;
  color: var(--connector-color);
}
.path-connector i { width: 100%; height: 1px; background: color-mix(in srgb, currentColor 45%, var(--color-rule)); }
.path-connector b {
  position: absolute;
  right: 3px;
  width: 7px;
  height: 7px;
  border-top: 1.5px solid currentColor;
  border-right: 1.5px solid currentColor;
  transform: rotate(45deg);
}
.path-connector.broken { --connector-color: var(--color-danger); }
.path-connector.broken i { height: 2px; background: repeating-linear-gradient(90deg, currentColor 0 5px, transparent 5px 9px); }
.path-connector.affected { --connector-color: var(--color-ink-2); }
.path-diagnosis {
  --diagnosis-color: var(--color-ink-2);
  --diagnosis-status-color: var(--color-success);
  display: flex;
  align-items: center;
  gap: 11px;
  margin-top: 14px;
  padding: 11px 13px;
  color: var(--diagnosis-color);
  border: 1px solid var(--color-rule);
  border-radius: 12px;
  background: transparent;
}
.path-diagnosis.tone-good {
  border-width: 1px 0 0;
  border-radius: 0;
}
.path-diagnosis.tone-warn {
  --diagnosis-color: var(--color-warning);
  --diagnosis-status-color: var(--color-warning);
  border-color: color-mix(in srgb, var(--color-warning) 34%, var(--color-rule));
  background: color-mix(in srgb, var(--color-warning) 5%, transparent);
}
.path-diagnosis.tone-bad {
  --diagnosis-color: var(--color-danger);
  --diagnosis-status-color: var(--color-danger);
  border-color: color-mix(in srgb, var(--color-danger) 34%, var(--color-rule));
  background: color-mix(in srgb, var(--color-danger) 5%, transparent);
}
.path-diagnosis.tone-muted { --diagnosis-status-color: var(--color-muted); }
.path-diagnosis-icon {
  display: grid;
  width: 29px;
  height: 29px;
  place-items: center;
  flex: none;
  color: var(--diagnosis-status-color);
  border-radius: 9px;
  background: color-mix(in srgb, currentColor 13%, transparent);
}
.path-diagnosis-icon svg { width: 18px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.6; }
.path-diagnosis > div { display: grid; flex: 1; gap: 2px; min-width: 0; }
.path-diagnosis strong { font-size: 10px; }
.path-diagnosis p { margin: 0; color: var(--color-muted); font-size: 10px; line-height: 1.4; }
.path-diagnosis-target {
  display: grid;
  min-width: 150px;
  max-width: 280px;
  padding: 7px 10px;
  color: var(--diagnosis-color);
  border: 1px solid color-mix(in srgb, var(--diagnosis-color) 23%, var(--color-rule));
  border-radius: 9px;
  background: color-mix(in srgb, var(--diagnosis-color) 6%, var(--color-paper-2));
}
.path-diagnosis-target small { color: currentColor; font-size: 7px; font-weight: 800; letter-spacing: .08em; }
.path-diagnosis-target strong, .path-diagnosis-target em {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.path-diagnosis-target strong { margin-top: 2px; font-size: 10px; }
.path-diagnosis-target em { color: var(--color-muted); font-size: 8px; font-style: normal; }
@media (max-width: 1500px) {
  .path-node { min-height: 122px; }
  .path-node-main {
    grid-template-columns: 34px minmax(0, 1fr);
    grid-template-rows: auto auto auto;
    column-gap: 8px;
    row-gap: 7px;
  }
  .path-icon {
    grid-row: auto;
    width: 34px;
    height: 34px;
  }
  .path-icon svg { width: 19px; height: 19px; }
  .path-node-meta {
    display: flex;
    grid-column: 1 / 3;
    align-items: center;
    justify-content: space-between;
    padding-top: 6px;
    border-top: 1px solid color-mix(in srgb, var(--node-color) 13%, var(--color-rule));
  }
  .path-node-meta em { align-self: auto; }
  .path-node-fact {
    grid-column: 1 / 3;
    padding-top: 6px;
  }
}
@media (max-width: 1320px) {
  .path-flow { grid-template-columns: repeat(13, minmax(0, auto)); overflow-x: auto; padding-bottom: 4px; scrollbar-width: thin; }
  .path-node { width: 176px; }
  .path-connector { width: 22px; }
}
@media (max-width: 680px) {
  .path-card-body { padding: 18px; }
  .path-card-head { align-items: stretch; flex-direction: column; gap: 12px; }
  .path-card-actions { justify-content: space-between; }
  .path-flow { grid-template-columns: 1fr; overflow: visible; padding-bottom: 0; }
  .path-node { width: auto; min-height: 122px; }
  .path-connector { width: 100%; height: 22px; justify-content: flex-start; padding-left: 31px; }
  .path-connector i { width: 1px; height: 100%; background: color-mix(in srgb, currentColor 45%, var(--color-rule)); }
  .path-connector b { right: auto; bottom: 3px; left: 27px; transform: rotate(135deg); }
  .path-diagnosis { align-items: flex-start; flex-wrap: wrap; }
  .path-diagnosis-target { width: 100%; max-width: none; margin-left: 40px; }
}
</style>

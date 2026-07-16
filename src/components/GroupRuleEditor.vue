<script setup lang="ts">
// One-layer AND/OR group-rule editor. Edits a single rule locally (a deep copy of
// the passed rule) and only mutates server state when the parent handles `save`.
// Conditions are ordered rows; each binds to a target that MUST be a member of
// the rule's monitor group, and its metric is chosen from presets compatible with
// that target's kind (client mirror of server rules.metricAllowedForKind). Client
// validation mirrors the server bounds but never replaces server validation — the
// parent still surfaces any server error.
import { reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Channel, GroupRule, GroupRuleInput, ProbeTarget, RuleConditionInput } from '../api'
import {
  FAIL_THRESHOLD_MAX,
  FOR_SECONDS_MAX,
  LAYERS,
  SEVERITIES,
  presetByKey,
  presetKeyForCondition,
  presetsForTarget,
} from '../lib/conditionPresets'

const props = defineProps<{
  rule: GroupRule
  members: ProbeTarget[]
  channels: Channel[]
  busy?: boolean
}>()
const emit = defineEmits<{ save: [GroupRuleInput]; remove: []; cancel: [] }>()

const { t: tr } = useI18n()

const isNew = () => !props.rule.id

// Local editable draft. A condition keeps the raw server fields; the preset is
// derived on the fly from (target, metric, comparator) so the row stays a plain
// data object.
type DraftCond = RuleConditionInput
interface Draft {
  name: string
  op: 'and' | 'or'
  layer: string
  severity: string
  channel_ids: string[]
  enabled: boolean
  conditions: DraftCond[]
}
const draft = reactive<Draft>(fromRule())
const validationErr = ref('')

function fromRule(): Draft {
  const r = props.rule
  const conditions = (r.conditions || []).map((c) => ({
    target_id: c.target_id,
    metric_kind: c.metric_kind,
    comparator: c.comparator,
    threshold: c.threshold,
    fail_threshold: c.fail_threshold,
    for_seconds: c.for_seconds,
  }))
  // A brand-new rule starts with one editable condition so the card is usable and
  // immediately passes the "at least one condition" rule.
  if (!conditions.length && !r.id && props.members.length) conditions.push(blankCondition())
  return {
    name: r.name || '',
    op: r.op === 'or' ? 'or' : 'and',
    layer: r.layer || 'internet',
    severity: r.severity || 'warn',
    channel_ids: [...(r.channel_ids || [])],
    enabled: r.enabled,
    conditions,
  }
}

// Re-sync when the parent swaps in a different rule (e.g. after a save reload).
watch(
  () => props.rule,
  () => {
    Object.assign(draft, fromRule())
    validationErr.value = ''
  },
)

function memberById(id: string): ProbeTarget | undefined {
  return props.members.find((m) => m.id === id)
}
function targetLabel(t: ProbeTarget): string {
  const base = t.name || t.target
  return `${base} · ${t.kind.toUpperCase()}`
}

// ---- conditions ----
function blankCondition(): DraftCond {
  const first = props.members[0]
  const preset = first ? presetsForTarget(first)[0] : undefined
  return {
    target_id: first?.id || '',
    metric_kind: preset?.metric || '',
    comparator: preset?.comparator || 'gt',
    threshold: preset ? (preset.fixed ?? (preset.def ?? 0) * (preset.scale ?? 1)) : 0,
    fail_threshold: 3,
    for_seconds: 0,
  }
}
function addCondition() {
  if (!props.members.length) return
  draft.conditions.push(blankCondition())
}
function removeCondition(i: number) {
  draft.conditions.splice(i, 1)
}
function onTargetChange(c: DraftCond, targetID: string) {
  c.target_id = targetID
  // Re-seed metric/comparator/threshold from the new target's first preset so the
  // condition never keeps a metric the new target's kind cannot emit.
  const t = memberById(targetID)
  const preset = t ? presetsForTarget(t)[0] : undefined
  if (preset) applyPreset(c, preset.key)
}
function presetKeyOf(c: DraftCond): string {
  const t = memberById(c.target_id)
  return t ? presetKeyForCondition(t, c.metric_kind, c.comparator) : ''
}
function presetsFor(c: DraftCond) {
  const t = memberById(c.target_id)
  return t ? presetsForTarget(t) : []
}
function applyPreset(c: DraftCond, key: string) {
  const t = memberById(c.target_id)
  const p = t ? presetByKey(t, key) : undefined
  if (!p) return
  c.metric_kind = p.metric
  c.comparator = p.comparator
  c.threshold = p.fixed != null ? p.fixed : (p.def ?? 0) * (p.scale ?? 1)
}
function isFixed(c: DraftCond): boolean {
  const t = memberById(c.target_id)
  const p = t ? presetByKey(t, presetKeyOf(c)) : undefined
  return p?.fixed != null
}
function unitOf(c: DraftCond): string {
  const t = memberById(c.target_id)
  return (t ? presetByKey(t, presetKeyOf(c))?.unit : '') || ''
}
function scaleOf(c: DraftCond): number {
  const t = memberById(c.target_id)
  return (t ? presetByKey(t, presetKeyOf(c))?.scale : 1) ?? 1
}
function thresholdDisplay(c: DraftCond): number {
  const s = scaleOf(c)
  return s === 1 ? c.threshold : c.threshold / s
}
function setThreshold(c: DraftCond, v: number) {
  const s = scaleOf(c)
  c.threshold = (Number.isNaN(v) ? 0 : v) * s
}

// ---- channels ----
function toggleChannel(id: string) {
  const i = draft.channel_ids.indexOf(id)
  if (i >= 0) draft.channel_ids.splice(i, 1)
  else draft.channel_ids.push(id)
}
function channelLabel(c: Channel): string {
  return c.name || (c.type === 'webhook' ? c.config.url : c.config.to) || c.type
}

// ---- validation (mirrors server rules.validate; the server still validates) ----
function validate(): string {
  if (!draft.name.trim()) return tr('grule.errNameRequired')
  if (!draft.conditions.length) return tr('grule.errNoConditions')
  const seen = new Set<string>()
  for (const c of draft.conditions) {
    const t = memberById(c.target_id)
    if (!t) return tr('grule.errTargetNotInGroup')
    if (!c.metric_kind) return tr('grule.errMetricRequired')
    if (!Number.isFinite(c.threshold)) return tr('grule.errThreshold')
    if (c.fail_threshold < 0 || c.fail_threshold > FAIL_THRESHOLD_MAX) return tr('grule.errFailRange')
    if (c.for_seconds < 0 || c.for_seconds > FOR_SECONDS_MAX) return tr('grule.errForRange')
    const key = `${c.target_id}|${c.metric_kind}|${c.comparator}|${c.threshold}`
    if (seen.has(key)) return tr('grule.errDuplicate')
    seen.add(key)
  }
  return ''
}

function onSave() {
  const err = validate()
  validationErr.value = err
  if (err) return
  const payload: GroupRuleInput = {
    name: draft.name.trim(),
    op: draft.op,
    layer: draft.layer,
    severity: draft.severity,
    channel_ids: [...draft.channel_ids],
    enabled: draft.enabled,
    conditions: draft.conditions.map((c) => ({
      target_id: c.target_id,
      metric_kind: c.metric_kind,
      comparator: c.comparator,
      threshold: Number(c.threshold),
      fail_threshold: Number(c.fail_threshold),
      for_seconds: Number(c.for_seconds || 0),
    })),
  }
  emit('save', payload)
}
</script>

<template>
  <div class="grule card">
    <div class="grule-head">
      <input
        v-model="draft.name"
        class="grule-name"
        :placeholder="tr('grule.namePlaceholder')"
        :aria-label="tr('grule.ruleName')"
      />
      <label class="inline">
        <input type="checkbox" v-model="draft.enabled" />
        <span>{{ tr('grule.enabled') }}</span>
      </label>
    </div>

    <div class="grule-meta">
      <fieldset class="op">
        <legend>{{ tr('grule.operator') }}</legend>
        <label class="inline">
          <input type="radio" value="and" v-model="draft.op" />
          <span>{{ tr('grule.opAnd') }}</span>
        </label>
        <label class="inline">
          <input type="radio" value="or" v-model="draft.op" />
          <span>{{ tr('grule.opOr') }}</span>
        </label>
      </fieldset>
      <label class="meta-field">
        <span>{{ tr('grule.layer') }}</span>
        <select v-model="draft.layer">
          <option v-for="l in LAYERS" :key="l" :value="l">{{ tr('incidents.layer.' + l) }}</option>
        </select>
      </label>
      <label class="meta-field">
        <span>{{ tr('grule.severity') }}</span>
        <select v-model="draft.severity">
          <option v-for="s in SEVERITIES" :key="s" :value="s">{{ tr('mform.sev_' + s) }}</option>
        </select>
      </label>
    </div>
    <p class="op-hint hint">{{ draft.op === 'and' ? tr('grule.opAndHint') : tr('grule.opOrHint') }}</p>

    <!-- conditions -->
    <div class="conds">
      <p v-if="!members.length" class="hint tiny">{{ tr('grule.noMembers') }}</p>
      <template v-else>
        <div v-for="(c, i) in draft.conditions" :key="i" class="cond-row">
          <span class="cond-idx" aria-hidden="true">{{ i + 1 }}</span>
          <label class="cond-field">
            <span class="cond-lbl">{{ tr('grule.condTarget') }}</span>
            <select :value="c.target_id" @change="onTargetChange(c, ($event.target as HTMLSelectElement).value)">
              <option v-for="m in members" :key="m.id" :value="m.id">{{ targetLabel(m) }}</option>
            </select>
          </label>
          <label class="cond-field grow">
            <span class="cond-lbl">{{ tr('grule.condMetric') }}</span>
            <select :value="presetKeyOf(c)" @change="applyPreset(c, ($event.target as HTMLSelectElement).value)">
              <option v-for="p in presetsFor(c)" :key="p.key" :value="p.key">{{ tr(p.label) }}</option>
            </select>
          </label>
          <label v-if="!isFixed(c)" class="cond-field">
            <span class="cond-lbl">{{ tr('grule.condThreshold') }}</span>
            <span class="thr">
              <input
                type="number"
                step="any"
                class="num"
                :value="thresholdDisplay(c)"
                @input="setThreshold(c, ($event.target as HTMLInputElement).valueAsNumber)"
              />
              <span v-if="unitOf(c)" class="unit">{{ unitOf(c) }}</span>
            </span>
          </label>
          <label class="cond-field">
            <span class="cond-lbl">{{ tr('grule.condConsecutive') }}</span>
            <input type="number" min="1" class="num sm" v-model.number="c.fail_threshold" />
          </label>
          <label class="cond-field">
            <span class="cond-lbl">{{ tr('grule.condDuration') }}</span>
            <input type="number" min="0" class="num sm" v-model.number="c.for_seconds" />
          </label>
          <button
            type="button"
            class="link-btn danger cond-del"
            :disabled="draft.conditions.length <= 1"
            :aria-label="tr('grule.removeCondition')"
            @click="removeCondition(i)"
          >
            ✕
          </button>
        </div>
        <button type="button" class="link-btn" @click="addCondition">{{ tr('grule.addCondition') }}</button>
      </template>
    </div>

    <!-- channels -->
    <div class="grule-channels">
      <span class="chan-label">{{ tr('grule.notifyChannels') }}</span>
      <span v-if="!channels.length" class="hint tiny">{{ tr('grule.noChannelHint') }}</span>
      <label v-for="c in channels" :key="c.id" class="chan">
        <input type="checkbox" :checked="draft.channel_ids.includes(c.id)" @change="toggleChannel(c.id)" />
        <span>{{ channelLabel(c) }}</span>
      </label>
    </div>

    <p v-if="validationErr" class="err cond-err" role="alert">{{ validationErr }}</p>

    <div class="grule-foot">
      <button type="button" class="btn btn-primary" :disabled="busy" @click="onSave">{{ tr('common.save') }}</button>
      <button v-if="isNew()" type="button" class="btn" :disabled="busy" @click="emit('cancel')">
        {{ tr('grule.discard') }}
      </button>
      <button v-else type="button" class="link-btn danger" :disabled="busy" @click="emit('remove')">
        {{ tr('common.delete') }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.grule {
  padding: 14px 16px;
  margin: 12px 0;
}
.grule-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
}
.grule-name {
  flex: 1;
  min-width: 160px;
}
.grule-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  align-items: flex-end;
}
.op {
  display: flex;
  align-items: center;
  gap: 12px;
  border: none;
  padding: 0;
  margin: 0;
}
.op legend {
  font-size: 12px;
  color: var(--text-dim);
  padding: 0;
  margin-right: 4px;
}
.meta-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--text-dim);
}
.op-hint {
  margin: 6px 0 0;
  font-size: 12px;
}
.inline {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  color: var(--text-dim);
}
.inline input {
  width: auto;
}
.conds {
  margin: 12px 0;
  padding-top: 10px;
  border-top: 1px dashed var(--border);
}
.cond-row {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 10px;
  padding: 8px 0;
}
.cond-idx {
  align-self: center;
  min-width: 18px;
  height: 18px;
  line-height: 18px;
  text-align: center;
  font-size: 11px;
  color: var(--text-muted);
  border: 1px solid var(--border);
  border-radius: 50%;
}
.cond-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--text-dim);
}
.cond-field.grow {
  flex: 1;
  min-width: 180px;
}
.cond-lbl {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}
.thr {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.unit {
  color: var(--text-dim);
  font-size: 12px;
}
.num {
  width: 96px;
}
.num.sm {
  width: 70px;
}
.cond-del {
  align-self: center;
  font-size: 13px;
}
.grule-channels {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  padding-top: 10px;
  border-top: 1px dashed var(--border);
}
.chan-label {
  font-size: 12.5px;
  color: var(--text-dim);
}
.chan {
  display: inline-flex;
  gap: 5px;
  align-items: center;
  font-size: 12.5px;
}
.chan input {
  width: auto;
}
.cond-err {
  margin: 10px 0 0;
}
.grule-foot {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 14px;
}
.tiny {
  font-size: 11.5px;
}
</style>

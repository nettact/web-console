<script setup lang="ts">
// Reusable editor for the hand-editable part of a notification policy. The model
// is a whole NotificationPolicyInput because that is what the caller has to POST/
// PATCH anyway, but scope_kind/scope_id are decided by the surface that owns the
// policy (site default / group override) and are never edited
// here.
//
// Delays are entered in minutes because a notification delay is a human patience
// setting, while the wire field is seconds (0..86400).
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Channel, NotificationPolicyInput, PolicyScope } from '../api'

const props = withDefaults(
  defineProps<{
    modelValue: NotificationPolicyInput
    channels: Channel[]
    disabled?: boolean
    // scope only changes what this editor SAYS and shows, never what it writes —
    // the two things below both depend on which incidents the policy governs.
    scope?: PolicyScope
  }>(),
  { disabled: false, scope: 'site' },
)
const emit = defineEmits<{ 'update:modelValue': [NotificationPolicyInput] }>()

const { t: tr } = useI18n()

const SEVERITIES = ['info', 'warn', 'error', 'critical']
const MAX_DELAY_SEC = 86400

// Disabling a policy does not mean the same thing at every scope. The site
// default is the last link in the chain, so switching it off leaves nothing
// governing the fault and nothing is sent. A group or agent policy is an
// override: switching it off hands its faults back to the site default, which
// may well have channels — so telling the user "no notifications are sent" there
// is not a wording nit, it is advice that can cause unintended paging.
const enabledHintKey = computed(() =>
  props.scope === 'site' ? 'notificationPolicy.enabledHint' : 'notificationPolicy.enabledHintFallback',
)

// Agent-offline faults are always critical. Every allowed floor covers critical
// and the delay tier consulted is always the critical one, so at this scope the
// minimum-severity and warning-delay controls are inert — offering them would
// let someone change and save a value that cannot affect anything.
const severityTiersApply = computed(() => props.scope !== 'agent')

function patch(p: Partial<NotificationPolicyInput>) {
  emit('update:modelValue', { ...props.modelValue, ...p })
}

function toMinutes(sec: number): number {
  return Math.round((sec / 60) * 100) / 100
}
// Committed on change, not on input: rounding every keystroke would eat a decimal
// point mid-typing.
function setDelay(field: 'warn_delay_sec' | 'critical_delay_sec', e: Event) {
  const minutes = Number((e.target as HTMLInputElement).value)
  const sec = Number.isFinite(minutes) ? Math.min(MAX_DELAY_SEC, Math.max(0, Math.round(minutes * 60))) : 0
  patch(field === 'warn_delay_sec' ? { warn_delay_sec: sec } : { critical_delay_sec: sec })
}

function toggleChannel(id: string) {
  const ids = props.modelValue.channel_ids
  patch({ channel_ids: ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id] })
}
</script>

<template>
  <div class="pf">
    <label class="pf-field">
      <span class="pf-label">{{ tr('notificationPolicy.name') }}</span>
      <input
        :value="modelValue.name"
        :disabled="disabled"
        :placeholder="tr('notificationPolicy.namePlaceholder')"
        @input="patch({ name: ($event.target as HTMLInputElement).value })"
      />
    </label>

    <label class="pf-toggle">
      <input
        type="checkbox"
        :checked="modelValue.enabled"
        :disabled="disabled"
        @change="patch({ enabled: ($event.target as HTMLInputElement).checked })"
      />
      <span>{{ tr('notificationPolicy.enabled') }}</span>
    </label>
    <p class="hint tiny">{{ tr(enabledHintKey) }}</p>

    <div class="pf-grid">
      <label v-if="severityTiersApply" class="pf-field">
        <span class="pf-label">{{ tr('notificationPolicy.minSeverity') }}</span>
        <select
          :value="modelValue.min_severity"
          :disabled="disabled"
          @change="patch({ min_severity: ($event.target as HTMLSelectElement).value })"
        >
          <option v-for="sv in SEVERITIES" :key="sv" :value="sv">{{ tr(`mform.sev_${sv}`) }}</option>
        </select>
        <small class="hint tiny">{{ tr('notificationPolicy.minSeverityHint') }}</small>
      </label>

      <label v-if="severityTiersApply" class="pf-field">
        <span class="pf-label">{{ tr('notificationPolicy.warnDelay') }}</span>
        <span class="pf-input">
          <input
            type="number"
            min="0"
            max="1440"
            step="1"
            :value="toMinutes(modelValue.warn_delay_sec)"
            :disabled="disabled"
            @change="setDelay('warn_delay_sec', $event)"
          />
          <span class="unit">{{ tr('notificationPolicy.unitMinutes') }}</span>
        </span>
        <small class="hint tiny">{{ tr('notificationPolicy.delaySeconds', { n: modelValue.warn_delay_sec }) }}</small>
      </label>

      <label class="pf-field">
        <span class="pf-label">
          {{ severityTiersApply ? tr('notificationPolicy.criticalDelay') : tr('notificationPolicy.singleDelay') }}
        </span>
        <span class="pf-input">
          <input
            type="number"
            min="0"
            max="1440"
            step="1"
            :value="toMinutes(modelValue.critical_delay_sec)"
            :disabled="disabled"
            @change="setDelay('critical_delay_sec', $event)"
          />
          <span class="unit">{{ tr('notificationPolicy.unitMinutes') }}</span>
        </span>
        <small class="hint tiny">
          {{ tr('notificationPolicy.delaySeconds', { n: modelValue.critical_delay_sec }) }}
        </small>
      </label>
    </div>
    <p class="hint tiny">
      {{ severityTiersApply ? tr('notificationPolicy.delayHint') : tr('notificationPolicy.singleDelayHint') }}
    </p>

    <label class="pf-toggle">
      <input
        type="checkbox"
        :checked="modelValue.notify_recovery"
        :disabled="disabled"
        @change="patch({ notify_recovery: ($event.target as HTMLInputElement).checked })"
      />
      <span>{{ tr('notificationPolicy.notifyRecovery') }}</span>
    </label>

    <div class="pf-channels">
      <span class="pf-label">{{ tr('notificationPolicy.channels') }}</span>
      <p class="hint tiny">{{ tr('notificationPolicy.channelsHint') }}</p>
      <div class="chip-row">
        <p v-if="!channels.length" class="hint tiny">{{ tr('notificationPolicy.noChannels') }}</p>
        <label v-for="c in channels" :key="c.id" class="chip">
          <input
            type="checkbox"
            :checked="modelValue.channel_ids.includes(c.id)"
            :disabled="disabled"
            @change="toggleChannel(c.id)"
          />
          <span>{{ c.name || c.type }}</span>
        </label>
      </div>
      <!-- An empty channel set is a legal, meaningful configuration — say what it
           means so it never reads as "detection is off". -->
      <p v-if="!modelValue.channel_ids.length" class="record-only">
        {{ tr('notificationPolicy.noChannelsPicked') }}
      </p>
    </div>
  </div>
</template>

<style scoped>
.pf {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.pf-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  color: var(--text-dim);
  max-width: 420px;
}
.pf-field input,
.pf-field select {
  width: 100%;
}
.pf-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-dim);
}
.pf-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 16px;
  margin: 12px 0 0;
}
.pf-grid .pf-field {
  max-width: none;
}
.pf-input {
  display: flex;
  align-items: center;
  gap: 8px;
}
.pf-input input {
  width: 110px;
  min-width: 90px;
}
.pf-input .unit {
  font-size: 12px;
  color: var(--text-muted);
}
.pf-toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin: 12px 0 0;
  font-size: 13px;
  color: var(--text);
}
.pf-toggle input {
  width: auto;
  min-width: 0;
}
.pf-channels {
  margin-top: 14px;
}
.chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 20px;
  margin-top: 8px;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text-dim);
}
.chip input {
  width: auto;
  min-width: 0;
  flex: none;
}
.record-only {
  margin: 10px 0 0;
  padding: 8px 11px;
  font-size: 12.5px;
  line-height: 1.55;
  color: var(--text-dim);
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-left: 3px solid var(--primary);
  border-radius: var(--radius-sm);
}
.tiny {
  font-size: 11.5px;
  margin: 4px 0 0;
}
</style>

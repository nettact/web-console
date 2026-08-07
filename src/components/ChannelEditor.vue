<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { api, type Channel } from '../api'
import { channelTypeCatalog, channelTypeDescriptor, type ChannelTypeGroup } from '../lib/channelTypes'
import { pushProvider } from '../lib/pushProviders'
import ChannelTypeMark from './ChannelTypeMark.vue'
import PushChannelForm from './PushChannelForm.vue'
import WebhookChannelForm from './WebhookChannelForm.vue'

const props = withDefaults(
  defineProps<{
    nativeNotify?: boolean
    initialType?: string
    exclude?: string[]
    mode?: 'add' | 'edit'
    channel?: Channel | null
  }>(),
  { nativeNotify: false, initialType: '', exclude: () => [], mode: 'add', channel: null },
)
const emit = defineEmits<{
  (e: 'added'): void
  (e: 'saved'): void
  (e: 'cancel'): void
}>()

const { t } = useI18n()
const LANGS = [
  { value: 'zh', label: '中文' },
  { value: 'en', label: 'English' },
]
const GROUPS: ChannelTypeGroup[] = ['collaboration', 'personal', 'integration', 'local']
const types = computed(() => channelTypeCatalog(props.nativeNotify, props.exclude))
const selectedType = ref(props.mode === 'edit' ? props.channel?.type || '' : props.initialType)
const selectedDescriptor = computed(() => channelTypeDescriptor(selectedType.value))
const enabled = ref(props.channel?.enabled ?? true)
const stormMerge = ref(props.channel?.storm_merge ?? true)
const initialConfig = props.channel?.config ?? {}
const email = reactive({
  name: props.channel?.name ?? '',
  host: initialConfig.host ?? '',
  port: initialConfig.port || '587',
  from: initialConfig.from ?? '',
  to: initialConfig.to ?? '',
  username: initialConfig.username ?? '',
  password: initialConfig.password ?? '',
  lang: initialConfig.lang || 'zh',
})
const system = reactive({ name: props.channel?.name ?? '', lang: initialConfig.lang || 'zh' })
const error = ref('')
const submitting = ref(false)

function groupedTypes(group: ChannelTypeGroup) {
  return types.value.filter((type) => type.group === group)
}

function typeLabel(type: string): string {
  const descriptor = channelTypeDescriptor(type)
  return descriptor.labelKey ? t(descriptor.labelKey) : type
}

function chooseType(type: string) {
  selectedType.value = type
  error.value = ''
}

function backToCatalog() {
  selectedType.value = ''
  error.value = ''
}

function finishSave() {
  if (props.mode === 'edit') emit('saved')
  else emit('added')
}

async function saveEmail() {
  if (!email.host.trim() || !email.from.trim() || !email.to.trim()) {
    error.value = t('settings.channelCatalog.emailRequired')
    return
  }
  error.value = ''
  submitting.value = true
  try {
    const { name, ...config } = email
    if (props.mode === 'edit' && props.channel) {
      await api.updateChannel(props.channel.id, {
        name: name.trim() || 'Email',
        enabled: enabled.value,
        storm_merge: stormMerge.value,
        config: { ...config },
      })
    } else {
      await api.createChannel(name.trim() || 'Email', 'email', { ...config }, stormMerge.value)
    }
    finishSave()
  } catch (e) {
    error.value = String((e as Error).message || e)
  } finally {
    submitting.value = false
  }
}

async function saveSystem() {
  error.value = ''
  submitting.value = true
  try {
    if (props.mode === 'edit' && props.channel) {
      await api.updateChannel(props.channel.id, {
        name: system.name.trim() || t('settings.sysNotify'),
        enabled: enabled.value,
        storm_merge: stormMerge.value,
        config: { lang: system.lang },
      })
    } else {
      await api.createChannel(system.name.trim() || t('settings.sysNotify'), 'system', { lang: system.lang }, stormMerge.value)
    }
    finishSave()
  } catch (e) {
    error.value = String((e as Error).message || e)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="channel-editor">
    <div v-if="!selectedType" class="channel-catalog">
      <div class="catalog-intro">
        <h3>{{ t('settings.channelCatalog.title') }}</h3>
        <p>{{ t('settings.channelCatalog.hint') }}</p>
      </div>
      <template v-for="group in GROUPS" :key="group">
        <section v-if="groupedTypes(group).length" class="catalog-group">
          <h4>{{ t(`settings.channelCatalog.groups.${group}`) }}</h4>
          <div class="catalog-options">
            <button
              v-for="item in groupedTypes(group)"
              :key="item.type"
              type="button"
              class="catalog-option"
              @click="chooseType(item.type)"
            >
              <ChannelTypeMark :type="item.type" />
              <span class="catalog-copy">
                <strong>{{ typeLabel(item.type) }}</strong>
                <small>{{ t(item.descriptionKey) }}</small>
              </span>
              <span class="catalog-arrow" aria-hidden="true">›</span>
            </button>
          </div>
        </section>
      </template>
    </div>

    <div v-else class="channel-config">
      <header class="config-identity">
        <button v-if="mode === 'add'" type="button" class="back-button" @click="backToCatalog">
          <span aria-hidden="true">←</span>{{ t('settings.channelCatalog.back') }}
        </button>
        <div class="config-type">
          <ChannelTypeMark :type="selectedType" />
          <div>
            <strong>{{ typeLabel(selectedType) }}</strong>
            <span>{{ t(selectedDescriptor.descriptionKey) }}</span>
          </div>
        </div>
      </header>

      <div class="delivery-options" :class="{ single: mode === 'add' }">
        <label v-if="mode === 'edit'" class="delivery-option">
          <input v-model="enabled" type="checkbox" />
          <span><strong>{{ t('settings.thEnabled') }}</strong><small>{{ t('settings.channelCatalog.enabledHint') }}</small></span>
        </label>
        <label class="delivery-option">
          <input v-model="stormMerge" type="checkbox" />
          <span><strong>{{ t('settings.thStormMerge') }}</strong><small>{{ t('settings.alertStorm.channelHint') }}</small></span>
        </label>
      </div>

      <WebhookChannelForm
        v-if="selectedType === 'webhook'"
        :mode="mode"
        :channel-id="channel?.id"
        :enabled="enabled"
        :storm-merge="stormMerge"
        :initial-name="channel?.name"
        :initial-config="channel?.config"
        @saved="finishSave"
        @cancel="emit('cancel')"
      />

      <PushChannelForm
        v-else-if="pushProvider(selectedType)"
        :key="selectedType"
        :provider="pushProvider(selectedType)!"
        :mode="mode"
        :channel-id="channel?.id"
        :enabled="enabled"
        :storm-merge="stormMerge"
        :initial-name="channel?.name"
        :initial-config="channel?.config"
        @saved="finishSave"
        @cancel="emit('cancel')"
      />

      <div v-else-if="selectedType === 'email'" class="simple-form">
        <div class="simple-grid">
          <label class="span-8"><span>{{ t('settings.namePlaceholder') }}</span><input v-model="email.name" /></label>
          <label class="span-4 lang-field">
            <span>{{ t('settings.langLabel') }}</span>
            <select v-model="email.lang"><option v-for="lang in LANGS" :key="lang.value" :value="lang.value">{{ lang.label }}</option></select>
          </label>
          <label class="span-9"><span>{{ t('settings.smtpHost') }}</span><input v-model="email.host" /></label>
          <label class="span-3"><span>{{ t('settings.port') }}</span><input v-model="email.port" inputmode="numeric" /></label>
          <label class="span-6"><span>{{ t('settings.from') }}</span><input v-model="email.from" type="email" /></label>
          <label class="span-6"><span>{{ t('settings.to') }}</span><input v-model="email.to" type="email" /></label>
          <label class="span-6"><span>{{ t('settings.usernameOpt') }}</span><input v-model="email.username" /></label>
          <label class="span-6"><span>{{ t('settings.passwordOpt') }}</span><input v-model="email.password" type="password" /></label>
        </div>
        <p v-if="error" class="err inline">{{ error }}</p>
        <div class="simple-actions">
          <button type="button" class="btn btn-primary" :disabled="submitting" @click="saveEmail">
            {{ mode === 'edit' ? t('common.save') : t('settings.addBtn') }}
          </button>
          <button v-if="mode === 'edit'" type="button" class="btn" @click="emit('cancel')">{{ t('settings.webhook.cancel') }}</button>
        </div>
      </div>

      <div v-else-if="selectedType === 'system'" class="simple-form">
        <p class="hint">{{ t('settings.sysNotifyHint') }}</p>
        <div class="simple-grid">
          <label class="span-8"><span>{{ t('settings.namePlaceholder') }}</span><input v-model="system.name" /></label>
          <label class="span-4 lang-field">
            <span>{{ t('settings.langLabel') }}</span>
            <select v-model="system.lang"><option v-for="lang in LANGS" :key="lang.value" :value="lang.value">{{ lang.label }}</option></select>
          </label>
        </div>
        <p v-if="error" class="err inline">{{ error }}</p>
        <div class="simple-actions">
          <button type="button" class="btn btn-primary" :disabled="submitting" @click="saveSystem">
            {{ mode === 'edit' ? t('common.save') : t('settings.addBtn') }}
          </button>
          <button v-if="mode === 'edit'" type="button" class="btn" @click="emit('cancel')">{{ t('settings.webhook.cancel') }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.channel-editor { min-width: 0; }
.catalog-intro h3 {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--text-lg);
  letter-spacing: 0;
}
.catalog-intro p {
  margin: var(--space-3xs) 0 0;
  color: var(--color-muted);
  font-size: var(--text-sm);
  line-height: 1.55;
}
.catalog-group { margin-top: var(--space-md); }
.catalog-group h4 {
  margin: 0 0 var(--space-2xs);
  color: var(--color-muted);
  font-size: var(--text-xs);
  font-weight: 650;
  letter-spacing: 0;
}
.catalog-options {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  border-top: var(--rule-hair) solid var(--color-rule);
}
.catalog-option {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  min-width: 0;
  min-height: 4.5rem;
  padding: var(--space-xs);
  border: 0;
  border-bottom: var(--rule-hair) solid var(--color-rule);
  color: var(--color-ink);
  background: transparent;
  text-align: left;
  cursor: pointer;
}
.catalog-option:nth-child(odd) { border-right: var(--rule-hair) solid var(--color-rule); }
.catalog-option:hover { background: var(--color-glass-hover); }
.catalog-option:focus-visible { outline: var(--rule-fine) solid var(--color-focus); outline-offset: calc(-1 * var(--rule-fine)); }
.catalog-option:active { transform: translateY(1px); }
.catalog-copy {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: var(--space-3xs);
}
.catalog-copy strong { font-size: var(--text-sm); }
.catalog-copy small {
  display: -webkit-box;
  overflow: hidden;
  color: var(--color-muted);
  font-size: var(--text-xs);
  line-height: 1.4;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
.catalog-arrow { color: var(--color-muted); font-size: var(--text-xl); }
.config-identity {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  margin-bottom: var(--space-md);
  padding-bottom: var(--space-sm);
  border-bottom: var(--rule-hair) solid var(--color-rule);
}
.back-button {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2xs);
  width: fit-content;
  min-height: 2.75rem;
  padding: 0 var(--space-xs);
  border: var(--rule-hair) solid var(--color-rule);
  border-radius: var(--radius-xs);
  color: var(--color-ink-2);
  background: var(--color-glass-subtle);
  cursor: pointer;
}
.back-button:hover { color: var(--color-ink); background: var(--color-glass-hover); }
.back-button:focus-visible { outline: var(--rule-fine) solid var(--color-focus); outline-offset: var(--space-3xs); }
.back-button:active { transform: translateY(1px); }
.config-type { display: flex; align-items: center; gap: var(--space-xs); }
.config-type > div { display: flex; min-width: 0; flex-direction: column; gap: var(--space-3xs); }
.config-type strong { font-family: var(--font-display); font-size: var(--text-md); }
.config-type span { color: var(--color-muted); font-size: var(--text-sm); }
.delivery-options {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-xs);
  margin-bottom: var(--space-md);
  padding-bottom: var(--space-md);
  border-bottom: var(--rule-hair) solid var(--color-rule);
}
.delivery-options.single { grid-template-columns: minmax(0, 1fr); }
.delivery-option {
  display: flex;
  align-items: flex-start;
  gap: var(--space-xs);
  min-width: 0;
  padding: var(--space-xs);
  border: var(--rule-hair) solid var(--color-rule);
  border-radius: var(--radius-xs);
  background: var(--color-glass-subtle);
}
.delivery-option input { margin-top: var(--space-3xs); }
.delivery-option span { display: flex; min-width: 0; flex-direction: column; gap: var(--space-3xs); }
.delivery-option strong { font-size: var(--text-sm); }
.delivery-option small { color: var(--color-muted); font-size: var(--text-xs); line-height: 1.45; }
.simple-form { display: flex; flex-direction: column; gap: var(--space-sm); }
.simple-form > .hint { margin: 0; }
.simple-grid {
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  gap: var(--space-xs);
}
.simple-grid label { display: flex; min-width: 0; flex-direction: column; gap: var(--space-3xs); }
.simple-grid .span-3 { grid-column: span 3; }
.simple-grid .span-4 { grid-column: span 4; }
.simple-grid .span-6 { grid-column: span 6; }
.simple-grid .span-8 { grid-column: span 8; }
.simple-grid .span-9 { grid-column: span 9; }
.simple-grid label > span { color: var(--color-muted); font-size: var(--text-xs); }
.simple-grid input,
.simple-grid select { width: 100%; min-width: 0; }
.simple-actions { display: flex; align-items: center; gap: var(--space-xs); }
.err.inline { margin: 0; }
@media (max-width: 520px) {
  .catalog-options,
  .delivery-options,
  .simple-grid { grid-template-columns: minmax(0, 1fr); }
  .catalog-option:nth-child(odd) { border-right: 0; }
  .simple-grid .span-3,
  .simple-grid .span-4,
  .simple-grid .span-6,
  .simple-grid .span-8,
  .simple-grid .span-9 { grid-column: auto; }
  .simple-actions { align-items: stretch; flex-direction: column; }
  .simple-actions .btn { width: 100%; }
}
</style>

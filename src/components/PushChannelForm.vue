<script setup lang="ts">
// 推送渠道（钉钉 / 企业微信 / 飞书 / Telegram / Server酱 / WxPusher）的添加/编辑表单。
//
// 这是六个平台共用的唯一实现：字段、必填、密钥与提示全部由 `provider` 描述符驱动
// （见 lib/pushProviders.ts），组件本身只负责六家一致的那部分行为 —— trim、必填
// 拦截、空可选键丢弃、恒带渠道语言 lang、发送测试、以及编辑态的密钥掩码。
//
// props 与 WebhookChannelForm 完全镜像（多一个 provider），Settings 的编辑展开行因此
// 能按渠道类型在两者之间二选一而不必改周边逻辑。
//
// 密钥掩码：服务端 List 渠道时把密钥键遮成 MaskedSecret（••••••），编辑态的输入框里
// 显示的就是它。用户不动即原样回传，服务端再合并回存值 —— 所以本组件不需要知道真实
// 密钥，也不该把掩码当成「空」而拦下必填。
import { reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { api, type ChannelTestResult } from '../api'
import type { PushProviderDescriptor } from '../lib/pushProviders'

const props = withDefaults(
  defineProps<{
    provider: PushProviderDescriptor
    mode: 'add' | 'edit'
    channelId?: string
    enabled?: boolean
    // The channel's current storm-merge flag. An update is a full PUT of the
    // channel's flags, so this form has to carry it through untouched — it edits
    // the push credentials, not the notification-grouping policy.
    stormMerge?: boolean
    initialName?: string
    initialConfig?: Record<string, string>
  }>(),
  { channelId: '', enabled: true, stormMerge: true, initialName: '', initialConfig: () => ({}) },
)
const emit = defineEmits<{
  (e: 'saved'): void
  (e: 'cancel'): void
}>()

const { t } = useI18n()

const LANGS = [
  { value: 'zh', label: '中文' },
  { value: 'en', label: 'English' },
]

const name = ref(props.initialName)
const lang = ref(props.initialConfig.lang || 'zh')
// One entry per declared field; the provider is fixed for the life of an
// instance (ChannelAddForm re-keys the component when the type tab changes).
const values = reactive<Record<string, string>>(
  Object.fromEntries(props.provider.fields.map((f) => [f.key, props.initialConfig[f.key] ?? ''])),
)
const hasSecret = props.provider.fields.some((f) => f.secret)

const localError = ref('')
const submitting = ref(false)
const testing = ref(false)
const testError = ref('')
const testResult = ref<ChannelTestResult | null>(null)

// buildConfig validates the form and returns the config map to persist (empty
// optional keys omitted), or null after setting localError.
function buildConfig(): Record<string, string> | null {
  localError.value = ''
  const cfg: Record<string, string> = {}
  for (const f of props.provider.fields) {
    // A masked secret is a non-empty string, so it satisfies "required" here on
    // its own — the server swaps it back for the stored value.
    const v = (values[f.key] ?? '').trim()
    if (!v) {
      if (f.required) {
        localError.value = t('settings.push.errRequired', { field: t(f.labelKey) })
        return null
      }
      continue
    }
    cfg[f.key] = v
  }
  // wxpusher is the one platform whose targets are two individually-optional
  // fields with an "at least one" rule between them. Special-cased by type
  // rather than modelled as a cross-field rule DSL for a single case.
  if (props.provider.type === 'wxpusher' && !cfg.uids && !cfg.topic_ids) {
    localError.value = t('settings.push.atLeastOneTarget')
    return null
  }
  cfg.lang = lang.value
  return cfg
}

function resetFields() {
  name.value = ''
  for (const f of props.provider.fields) values[f.key] = ''
  lang.value = 'zh'
  testResult.value = null
  testError.value = ''
}

// onSave owns persistence so it can surface create/update failures in the form
// (a Vue event handler can't be awaited by the parent) and reset the add form on
// success to avoid an accidental duplicate on the next click.
async function onSave() {
  const cfg = buildConfig()
  if (!cfg) return
  const label = name.value.trim() || t(props.provider.labelKey)
  submitting.value = true
  localError.value = ''
  try {
    if (props.mode === 'edit') {
      await api.updateChannel(props.channelId, {
        name: label,
        enabled: props.enabled,
        storm_merge: props.stormMerge,
        config: cfg,
      })
    } else {
      await api.createChannel(label, props.provider.type, cfg)
      resetFields()
    }
    emit('saved')
  } catch (e) {
    localError.value = String((e as Error).message || e)
  } finally {
    submitting.value = false
  }
}

async function onTest() {
  const cfg = buildConfig()
  if (!cfg) return
  testing.value = true
  testError.value = ''
  testResult.value = null
  try {
    // In edit mode the config can still carry masked secrets; the channel id
    // lets the server merge the stored ones back in before sending.
    testResult.value = await api.testChannel(
      props.provider.type,
      cfg,
      props.mode === 'edit' ? props.channelId : undefined,
    )
  } catch (e) {
    testError.value = String((e as Error).message || e)
  } finally {
    testing.value = false
  }
}
</script>

<template>
  <div class="wh-form">
    <p class="hint tiny wh-help">
      {{ t(provider.helpKey) }}
      <a v-if="provider.helpUrl" :href="provider.helpUrl" target="_blank" rel="noopener noreferrer">
        {{ t('settings.push.helpLink') }} ↗
      </a>
    </p>

    <div class="wh-grid">
      <label class="wh-field wh-name">
        <span class="wh-lbl">{{ t('settings.namePlaceholder') }}</span>
        <input v-model="name" :placeholder="t('settings.namePlaceholder')" />
      </label>
      <label
        v-for="f in provider.fields" :key="f.key"
        class="wh-field" :class="['wh-f-' + f.key, { 'wh-wide': f.multiline }]">
        <span class="wh-lbl">{{ t(f.labelKey) }}</span>
        <textarea
          v-if="f.multiline"
          v-model="values[f.key]" rows="2" spellcheck="false" :placeholder="f.placeholder"></textarea>
        <input
          v-else v-model="values[f.key]"
          :type="f.secret ? 'password' : 'text'" :placeholder="f.placeholder" />
        <span v-if="f.hintKey" class="hint tiny">{{ t(f.hintKey) }}</span>
      </label>
      <label class="wh-field">
        <span class="wh-lbl">{{ t('settings.langLabel') }}</span>
        <select v-model="lang">
          <option v-for="l in LANGS" :key="l.value" :value="l.value">{{ l.label }}</option>
        </select>
      </label>
    </div>

    <p v-if="mode === 'edit' && hasSecret" class="hint tiny">{{ t('settings.push.secretEditHint') }}</p>

    <p v-if="localError" class="err inline">{{ localError }}</p>

    <div class="wh-actions">
      <button type="button" class="btn wh-test" :disabled="testing || submitting" @click="onTest">
        {{ t('settings.webhook.testBtn') }}
      </button>
      <button type="button" class="btn btn-primary" :disabled="submitting" @click="onSave">
        {{ mode === 'edit' ? t('common.save') : t('settings.addBtn') }}
      </button>
      <button v-if="mode === 'edit'" type="button" class="link-btn" @click="emit('cancel')">
        {{ t('settings.webhook.cancel') }}
      </button>
    </div>

    <p v-if="testing" class="hint tiny">{{ t('settings.webhook.testing') }}</p>
    <p v-else-if="testError" class="err inline">{{ testError }}</p>
    <div v-else-if="testResult" class="wh-result" :class="testResult.ok ? 'ok' : 'bad'">
      <span class="wh-status">{{ testResult.ok ? '✓' : '✗' }} HTTP {{ testResult.status_code }}</span>
      <span v-if="testResult.error" class="wh-rerr">{{ testResult.error }}</span>
      <pre v-if="testResult.body" class="wh-rbody">{{ testResult.body }}</pre>
    </div>
  </div>
</template>

<style scoped>
.wh-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 4px 0;
}
.wh-help {
  margin: 0;
}
.wh-help a {
  white-space: nowrap;
}
.wh-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
.wh-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 120px;
  flex: 0 1 220px;
}
.wh-field.wh-name {
  flex: 0 1 160px;
}
.wh-field.wh-wide {
  flex: 1 1 280px;
}
.wh-field textarea {
  width: 100%;
  font-family: var(--font-mono, monospace);
  font-size: 12.5px;
  resize: vertical;
}
.wh-lbl {
  font-size: 12px;
  color: var(--text-dim);
}
.wh-actions {
  display: flex;
  gap: 10px;
  align-items: center;
}
.err.inline {
  margin: 0;
}
.wh-result {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--surface-2);
  font-size: 13px;
}
.wh-result.ok .wh-status {
  color: var(--success, #2e9e5b);
}
.wh-result.bad .wh-status {
  color: var(--danger, #d64550);
}
.wh-status {
  font-weight: 600;
}
.wh-rerr {
  color: var(--danger, #d64550);
}
.wh-rbody {
  margin: 0;
  max-height: 160px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
  font-size: 12px;
  color: var(--text-dim);
}
</style>

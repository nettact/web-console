<script setup lang="ts">
// 「添加通知渠道」表单：先选类型，再展示对应表单。Settings 与初始化引导共用同一份。
//
// 新增渠道类型时在此登记：
//   - 推送类平台（钉钉 / 企业微信 / 飞书 / Telegram / Server酱 / WxPusher 一类）不必
//     碰本文件 —— 在 `lib/pushProviders.ts` 加一个描述符即可，tab 与表单都从
//     PUSH_PROVIDERS 派生，表单由通用的 PushChannelForm 渲染。
//   - 结构特殊的类型才在这里加：CHANNEL_TYPES 追加一项 + 模板加一支 v-else-if
//     （必要时再加一个 add* 函数）。
//
// 「系统通知」仅当 server 运行于 Windows/macOS（native_notify）时才提供。
// webhook 的表单较复杂（headers / body 模板 / 发送测试），委托给 WebhookChannelForm。
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../api'
import { PUSH_PROVIDERS, pushProvider } from '../lib/pushProviders'
import PushChannelForm from './PushChannelForm.vue'
import WebhookChannelForm from './WebhookChannelForm.vue'

const props = withDefaults(
  defineProps<{
    // server 是否支持本机系统通知（ServerInfo.native_notify）。
    nativeNotify?: boolean
    // 初始选中的类型；为空时取第一个可用类型。
    initialType?: string
    // 不在此处提供的类型（如引导页已单独推荐了系统通知，就不必再列一次）。
    exclude?: string[]
  }>(),
  { nativeNotify: false, initialType: '', exclude: () => [] },
)
const emit = defineEmits<{
  (e: 'added'): void
}>()

const { t } = useI18n()

const CHANNEL_TYPES = computed(() => {
  const types = [
    { value: 'webhook', label: 'Webhook' },
    { value: 'email', label: 'Email' },
    ...PUSH_PROVIDERS.map((d) => ({ value: d.type, label: t(d.labelKey) })),
  ]
  if (props.nativeNotify) {
    types.push({ value: 'system', label: t('settings.sysNotify') })
  }
  return types.filter((ct) => !props.exclude.includes(ct.value))
})

// 通知渠道语言：决定该渠道推送的告警文案用中文还是英文（服务端在投递时渲染）。
const LANGS = [
  { value: 'zh', label: '中文' },
  { value: 'en', label: 'English' },
]

const addType = ref('')
// exclude/nativeNotify 变化会改变可选类型，当前选中项可能失效；始终收敛到一个
// 仍然可选的类型（优先 initialType）。
watch(
  CHANNEL_TYPES,
  (types) => {
    if (types.some((ct) => ct.value === addType.value)) return
    const preferred = types.find((ct) => ct.value === props.initialType)
    addType.value = preferred?.value ?? types[0]?.value ?? ''
  },
  { immediate: true },
)

const email = reactive({ name: '', host: '', port: '587', from: '', to: '', username: '', password: '', lang: 'zh' })
const system = reactive({ name: '', lang: 'zh' })
const error = ref('')

async function addEmail() {
  if (!email.host || !email.from || !email.to) return
  error.value = ''
  try {
    const { name, ...cfg } = email
    await api.createChannel(name || 'Email', 'email', { ...cfg }, true)
  } catch (e) {
    error.value = String((e as Error).message || e)
    return
  }
  email.name = ''
  emit('added')
}

async function addSystem() {
  error.value = ''
  try {
    await api.createChannel(system.name || t('settings.sysNotify'), 'system', { lang: system.lang }, true)
  } catch (e) {
    error.value = String((e as Error).message || e)
    return
  }
  system.name = ''
  emit('added')
}
</script>

<template>
  <div class="ch-add">
    <div class="type-tabs" role="tablist">
      <span class="type-label">{{ t('settings.addChannelType') }}</span>
      <button
        v-for="ct in CHANNEL_TYPES" :key="ct.value"
        class="type-tab" :class="{ active: addType === ct.value }"
        @click="addType = ct.value">
        {{ ct.label }}
      </button>
    </div>

    <div v-if="addType === 'webhook'" class="wh-add">
      <WebhookChannelForm mode="add" @saved="emit('added')" />
    </div>

    <!-- 推送平台共用一个表单；:key 让切换 tab 时重新挂载，上一个平台填了一半的值
         （如同名的 secret 字段）不会串到下一个。 -->
    <div v-else-if="pushProvider(addType)" class="wh-add">
      <PushChannelForm :key="addType" :provider="pushProvider(addType)!" mode="add" @saved="emit('added')" />
    </div>

    <div v-else-if="addType === 'email'" class="row field-row">
      <b class="ftag">Email</b>
      <input v-model="email.name" :placeholder="t('settings.namePlaceholder')" class="tiny-name" />
      <input v-model="email.host" :placeholder="t('settings.smtpHost')" />
      <input v-model="email.port" :placeholder="t('settings.port')" class="tiny" />
      <input v-model="email.from" :placeholder="t('settings.from')" />
      <input v-model="email.to" :placeholder="t('settings.to')" />
      <input v-model="email.username" :placeholder="t('settings.usernameOpt')" />
      <input v-model="email.password" type="password" :placeholder="t('settings.passwordOpt')" />
      <select v-model="email.lang" :title="t('settings.langLabel')">
        <option v-for="l in LANGS" :key="l.value" :value="l.value">{{ l.label }}</option>
      </select>
      <button class="btn btn-primary" @click="addEmail">{{ t('settings.addBtn') }}</button>
    </div>

    <div v-else-if="addType === 'system'" class="row field-row">
      <b class="ftag">{{ t('settings.sysNotify') }}</b>
      <input v-model="system.name" :placeholder="t('settings.namePlaceholder')" class="tiny-name" />
      <select v-model="system.lang" :title="t('settings.langLabel')">
        <option v-for="l in LANGS" :key="l.value" :value="l.value">{{ l.label }}</option>
      </select>
      <span class="hint">{{ t('settings.sysNotifyHint') }}</span>
      <button class="btn btn-primary" @click="addSystem">{{ t('settings.addBtn') }}</button>
    </div>

    <p v-if="error" class="err inline">{{ error }}</p>
  </div>
</template>

<style scoped>
.type-tabs {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 4px 0 2px;
  flex-wrap: wrap;
}
.type-label {
  font-size: 13px;
  color: var(--text-dim);
  margin-right: 4px;
}
.type-tab {
  padding: 6px 16px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-dim);
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  cursor: pointer;
  transition: background 0.16s, color 0.16s, border-color 0.16s;
}
.type-tab:hover {
  color: var(--text);
}
.type-tab.active {
  color: var(--color-accent-text);
  background: var(--primary-soft);
  border-color: rgba(56, 189, 248, 0.35);
}
.wh-add {
  margin: 12px 0 0;
}
.field-row {
  margin: 12px 0 0;
}
.field-row .ftag {
  min-width: 62px;
  font-size: 13px;
  color: var(--text-dim);
}
input {
  min-width: 140px;
}
input.tiny {
  min-width: 64px;
  width: 64px;
}
input.tiny-name {
  min-width: 96px;
  width: 96px;
}
.err.inline {
  margin: 8px 0 0;
}
</style>

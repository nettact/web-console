<script setup lang="ts">
// Add/edit form for a webhook notification channel: URL, HTTP method, custom
// headers, a body template with {{variables}}, plus a "send test" button and a
// collapsible protocol reference.
//
// IMPORTANT: variable tokens ({{title}} …) and the JSON example are rendered from
// the script-side constants below, NOT from i18n messages — vue-i18n treats
// {{ }} as interpolation, so those braces must never appear in a locale string.
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { api, type ChannelTestResult } from '../api'
import ComboInput from './ComboInput.vue'

const props = withDefaults(
  defineProps<{
    mode: 'add' | 'edit'
    channelId?: string
    enabled?: boolean
    // The channel's current storm-merge flag. An update is a full PUT of the
    // channel's flags, so this form has to carry it through untouched — it edits
    // the webhook config, not the notification-grouping policy.
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

const METHODS = ['POST', 'GET', 'PUT', 'PATCH', 'DELETE']
const LANGS = [
  { value: 'zh', label: '中文' },
  { value: 'en', label: 'English' },
]

// Body-template variables (docs table). Descriptions live in i18n (doc.v.*).
const VARS = [
  'title', 'text', 'summary', 'lines', 'target', 'targets',
  'event', 'state', 'severity', 'scope', 'incident_id', 'site_id',
  'suspected_layer', 'url', 'agent_count', 'at',
] as const
// Default JSON body fields (docs table). Descriptions in i18n (doc.f.*).
const BODY_FIELDS = [
  'event', 'incident_id', 'site_id', 'state', 'severity', 'scope',
  'agent_count', 'suspected_layer', 'url', 'at', 'title', 'text', 'lines', 'details',
] as const
// A DingTalk-style custom body example. Kept here (not i18n) for the {{ }} tokens.
const EXAMPLE = [
  '{',
  '  "msgtype": "markdown",',
  '  "markdown": {',
  '    "title": "{{title}}",',
  '    "text": "### {{title}}\\n\\n{{lines}}"',
  '  }',
  '}',
].join('\n')

// token wraps a name in braces in script (never in the template) so the Vue
// compiler doesn't see a stray "}}" and truncate the interpolation.
function token(name: string): string {
  return `{{${name}}}`
}

function parseHeaders(raw?: string): { key: string; value: string }[] {
  if (!raw) return []
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>
    return Object.entries(obj).map(([key, value]) => ({ key, value: String(value) }))
  } catch {
    return []
  }
}

const name = ref(props.initialName)
const url = ref(props.initialConfig.url ?? '')
const method = ref(props.initialConfig.method || 'POST')
const lang = ref(props.initialConfig.lang || 'zh')
const body = ref(props.initialConfig.body ?? '')
const headerRows = ref(parseHeaders(props.initialConfig.headers))

const localError = ref('')
const submitting = ref(false)
const testing = ref(false)
const testError = ref('')
const testResult = ref<ChannelTestResult | null>(null)

function addHeader() {
  headerRows.value.push({ key: '', value: '' })
}
function removeHeader(i: number) {
  headerRows.value.splice(i, 1)
}

// buildConfig validates the form and returns the config map to persist (default
// values omitted), or null after setting localError.
function buildConfig(): Record<string, string> | null {
  localError.value = ''
  let u = url.value.trim()
  if (!u) {
    localError.value = t('settings.webhook.errUrlRequired')
    return null
  }
  // Lowercase the scheme so it matches the server's case-sensitive validation
  // (a user typing HTTPS:// would otherwise pass here and be rejected on save).
  u = u.replace(/^(https?):\/\//i, (_m, s: string) => s.toLowerCase() + '://')
  if (!/^https?:\/\//.test(u)) {
    localError.value = t('settings.webhook.errUrlScheme')
    return null
  }
  const cfg: Record<string, string> = { url: u, lang: lang.value }

  const m = method.value.trim().toUpperCase()
  if (m && m !== 'POST') {
    if (!/^[A-Z]{1,16}$/.test(m)) {
      localError.value = t('settings.webhook.errMethod')
      return null
    }
    cfg.method = m
  }

  const headers: Record<string, string> = {}
  const seen = new Set<string>()
  for (const row of headerRows.value) {
    const k = row.key.trim()
    if (!k) continue
    const lower = k.toLowerCase()
    if (seen.has(lower)) {
      localError.value = t('settings.webhook.errDupHeader', { name: k })
      return null
    }
    seen.add(lower)
    headers[k] = row.value
  }
  if (Object.keys(headers).length) cfg.headers = JSON.stringify(headers)

  if (body.value.trim()) cfg.body = body.value
  return cfg
}

function resetFields() {
  name.value = ''
  url.value = ''
  method.value = 'POST'
  lang.value = 'zh'
  body.value = ''
  headerRows.value = []
  testResult.value = null
  testError.value = ''
}

// onSave owns persistence so it can surface create/update failures in the form
// (a Vue event handler can't be awaited by the parent) and reset the add form on
// success to avoid an accidental duplicate on the next click.
async function onSave() {
  const cfg = buildConfig()
  if (!cfg) return
  const label = name.value.trim() || 'Webhook'
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
      await api.createChannel(label, 'webhook', cfg)
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
    testResult.value = await api.testChannel('webhook', cfg)
  } catch (e) {
    testError.value = String((e as Error).message || e)
  } finally {
    testing.value = false
  }
}
</script>

<template>
  <div class="wh-form">
    <div class="wh-grid">
      <label class="wh-field wh-name">
        <span class="wh-lbl">{{ t('settings.namePlaceholder') }}</span>
        <input v-model="name" :placeholder="t('settings.namePlaceholder')" />
      </label>
      <label class="wh-field wh-url">
        <span class="wh-lbl">{{ t('settings.webhook.url') }}</span>
        <input v-model="url" :placeholder="t('settings.webhook.urlPlaceholder')" />
      </label>
      <label class="wh-field wh-method">
        <span class="wh-lbl">{{ t('settings.webhook.method') }}</span>
        <ComboInput v-model="method" :options="METHODS" placeholder="POST" />
      </label>
      <label class="wh-field">
        <span class="wh-lbl">{{ t('settings.langLabel') }}</span>
        <select v-model="lang">
          <option v-for="l in LANGS" :key="l.value" :value="l.value">{{ l.label }}</option>
        </select>
      </label>
    </div>

    <div class="wh-headers">
      <span class="wh-lbl">{{ t('settings.webhook.headers') }}</span>
      <div v-for="(h, i) in headerRows" :key="i" class="wh-hrow">
        <input v-model="h.key" :placeholder="t('settings.webhook.headerName')" class="wh-hkey" />
        <input v-model="h.value" :placeholder="t('settings.webhook.headerValue')" class="wh-hval" />
        <button
          type="button" class="link-btn danger"
          :aria-label="t('settings.webhook.removeHeader')" @click="removeHeader(i)">✕</button>
      </div>
      <button type="button" class="link-btn" @click="addHeader">+ {{ t('settings.webhook.addHeader') }}</button>
    </div>

    <label class="wh-field wh-body">
      <span class="wh-lbl">{{ t('settings.webhook.body') }}</span>
      <textarea v-model="body" rows="4" spellcheck="false" :placeholder="t('settings.webhook.bodyPlaceholder')"></textarea>
      <span class="hint tiny">{{ t('settings.webhook.bodyHint') }}</span>
    </label>

    <p v-if="localError" class="err inline">{{ localError }}</p>

    <div class="wh-actions">
      <button type="button" class="btn" :disabled="testing || submitting" @click="onTest">{{ t('settings.webhook.testBtn') }}</button>
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

    <details class="wh-docs">
      <summary>{{ t('settings.webhook.doc.summary') }}</summary>
      <div class="wh-docs-body">
        <p class="hint">{{ t('settings.webhook.doc.defaultIntro') }}</p>
        <table class="wh-doc-table">
          <thead>
            <tr><th>{{ t('settings.webhook.doc.fieldCol') }}</th><th>{{ t('settings.webhook.doc.descCol') }}</th></tr>
          </thead>
          <tbody>
            <tr v-for="f in BODY_FIELDS" :key="f">
              <td class="mono">{{ f }}</td><td>{{ t('settings.webhook.doc.f.' + f) }}</td>
            </tr>
          </tbody>
        </table>

        <p class="hint">{{ t('settings.webhook.doc.varsIntro') }}</p>
        <table class="wh-doc-table">
          <thead>
            <tr><th>{{ t('settings.webhook.doc.varCol') }}</th><th>{{ t('settings.webhook.doc.descCol') }}</th></tr>
          </thead>
          <tbody>
            <tr v-for="v in VARS" :key="v">
              <td class="mono">{{ token(v) }}</td><td>{{ t('settings.webhook.doc.v.' + v) }}</td>
            </tr>
          </tbody>
        </table>

        <p class="hint">{{ t('settings.webhook.doc.escapeNote') }}</p>
        <p class="hint">{{ t('settings.webhook.doc.exampleIntro') }}</p>
        <pre class="wh-example">{{ EXAMPLE }}</pre>
      </div>
    </details>
  </div>
</template>

<style scoped>
.wh-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 4px 0;
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
}
.wh-field.wh-url {
  flex: 1 1 260px;
}
.wh-field.wh-name {
  flex: 0 1 160px;
}
.wh-field.wh-method {
  flex: 0 0 140px;
}
.wh-lbl {
  font-size: 12px;
  color: var(--text-dim);
}
.wh-headers {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.wh-hrow {
  display: flex;
  gap: 8px;
  align-items: center;
}
.wh-hkey {
  flex: 0 1 200px;
}
.wh-hval {
  flex: 1 1 260px;
}
.wh-body textarea {
  width: 100%;
  font-family: var(--font-mono, monospace);
  font-size: 12.5px;
  resize: vertical;
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
.wh-docs {
  border-top: 1px solid var(--border);
  padding-top: 8px;
}
.wh-docs summary {
  cursor: pointer;
  font-size: 13px;
  color: var(--text-dim);
}
.wh-docs-body {
  padding: 10px 2px 2px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.wh-doc-table {
  border-collapse: collapse;
  font-size: 12.5px;
}
.wh-doc-table th,
.wh-doc-table td {
  text-align: left;
  padding: 3px 12px 3px 0;
  vertical-align: top;
}
.wh-doc-table th {
  color: var(--text-dim);
  font-weight: 600;
  border-bottom: 1px solid var(--border);
}
.wh-example {
  margin: 0;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  border: 1px solid var(--border);
  font-size: 12px;
  overflow-x: auto;
}
</style>

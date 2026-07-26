<script setup lang="ts">
// One-command Agent installers, grouped by target platform.
import { computed, ref } from 'vue'

const props = defineProps<{ serverUrl: string; token: string }>()

type Tab = 'windows' | 'macos' | 'linux' | 'docker'
const tabs: Tab[] = ['windows', 'macos', 'linux', 'docker']
const tab = ref<Tab>('windows')
const autoUpdate = ref(true)

// A real token when one was just generated, else a clear placeholder.
const tok = computed(() => props.token || '<enrollment-token>')
const url = computed(() => props.serverUrl || 'https://nettact.example:12450')

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'"'"'`)}'`
}

function powershellQuote(value: string) {
  return `'${value.replace(/'/g, "''")}'`
}

const windows = computed(
  () =>
    `& ([scriptblock]::Create((irm https://d.nettact.org/agent/install.ps1))) -ServerUrl ${powershellQuote(url.value)} -Token ${powershellQuote(tok.value)}${autoUpdate.value ? ' -AutoUpdate' : ''}`,
)

const nativeUnix = computed(
  () =>
    `curl -fsSL https://d.nettact.org/agent/install.sh | sudo bash -s -- \\\n  --server-url ${shellQuote(url.value)} \\\n  --token ${shellQuote(tok.value)}${autoUpdate.value ? ' --auto-update' : ''}`,
)

const docker = computed(
  () =>
    `curl -fsSL https://d.nettact.org/agent/install.sh | bash -s -- --docker \\\n  --server-url ${shellQuote(url.value)} \\\n  --token ${shellQuote(tok.value)}${autoUpdate.value ? ' --auto-update' : ''}`,
)

const snippet = computed(() => {
  if (tab.value === 'windows') return windows.value
  if (tab.value === 'docker') return docker.value
  return nativeUnix.value
})

const copied = ref(false)
async function copy() {
  await navigator.clipboard?.writeText(snippet.value)
  copied.value = true
  window.setTimeout(() => (copied.value = false), 1500)
}
</script>

<template>
  <div class="enroll">
    <div class="tabs" role="tablist">
      <button
        v-for="k in tabs"
        :key="k"
        class="tab"
        role="tab"
        :class="{ active: tab === k }"
        :aria-selected="tab === k"
        @click="tab = k"
      >
        {{ $t(`onboarding.tab_${k}`) }}
      </button>
    </div>

    <label class="auto-update">
      <input v-model="autoUpdate" type="checkbox" />
      <span>
        <strong>{{ $t('onboarding.autoUpdate') }}</strong>
        <small>{{ $t('onboarding.autoUpdateHint') }}</small>
      </span>
    </label>

    <div class="code-wrap">
      <button class="copy" @click="copy">{{ copied ? $t('common.saved') : $t('agents.copy') }}</button>
      <pre><code>{{ snippet }}</code></pre>
    </div>

    <ul class="callouts">
      <li>{{ $t('onboarding.calloutAdmin') }}</li>
      <li>{{ $t('onboarding.calloutInstall') }}</li>
      <li>{{ $t('onboarding.calloutTokenHistory') }}</li>
    </ul>
  </div>
</template>

<style scoped>
.enroll {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  border-bottom: 1px solid var(--border);
}
.tab {
  padding: 7px 14px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
}
.tab:hover {
  color: var(--text);
}
.tab.active {
  color: var(--primary);
  border-bottom-color: var(--primary);
}
.auto-update {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  width: fit-content;
  color: var(--text);
  cursor: pointer;
}
.auto-update input {
  margin-top: 3px;
}
.auto-update span {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.auto-update strong {
  font-size: 13px;
}
.auto-update small {
  color: var(--text-dim);
  font-size: 12px;
}
.code-wrap {
  position: relative;
}
.copy {
  position: absolute;
  top: 8px;
  right: 8px;
  padding: 3px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--text-dim);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.copy:hover {
  color: var(--text);
  border-color: var(--border-strong);
}
pre {
  margin: 0;
  padding: 14px 16px;
  overflow-x: auto;
  background: var(--code-bg, var(--surface-2));
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}
code {
  font-family: var(--mono, monospace);
  font-size: 12.5px;
  line-height: 1.65;
  color: var(--text);
  white-space: pre;
  background: none;
  border: none;
  padding: 0;
}
.callouts {
  margin: 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: 12.5px;
  color: var(--text-dim);
  line-height: 1.55;
}
</style>
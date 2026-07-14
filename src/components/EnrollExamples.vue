<script setup lang="ts">
// Enrollment examples for bringing an agent online, one tab per deployment style
// (PowerShell / systemd / container). The agent reads its server URL and a
// one-time enroll token from the environment; a token FILE is preferred over an
// inline value. All three share the same callouts: permissions are a complete
// replacement of the default policy, prefer the token file, and a restart is
// required to pick up config.
import { ref, computed } from 'vue'

const props = defineProps<{ serverUrl: string; token: string }>()

type Tab = 'powershell' | 'systemd' | 'container'
const tab = ref<Tab>('powershell')

// A real token when one was just generated, else a clear placeholder.
const tok = computed(() => props.token || '<enrollment-token>')
const url = computed(() => props.serverUrl || 'https://nettact.example:8080')

const powershell = computed(
  () =>
    `$env:NETTACT_AGENT_SERVER_URL = "${url.value}"
# Write the one-time token to a file (preferred over an inline value).
# -Encoding ascii is required: the default writes UTF-16 with a BOM, which the
# agent would read as a corrupt token.
New-Item -ItemType Directory -Force C:\\ProgramData\\nettact | Out-Null
Set-Content -Path C:\\ProgramData\\nettact\\enroll.token -Value "${tok.value}" -Encoding ascii -NoNewline
$env:NETTACT_AGENT_ENROLL_TOKEN_FILE = "C:\\ProgramData\\nettact\\enroll.token"
.\\nettact-agent.exe`,
)

const systemd = computed(
  () =>
    `# Create the config directory, then the one-time token file (root-owned, 0600):
sudo mkdir -p /etc/nettact
sudo install -m 0600 /dev/null /etc/nettact/enroll.token
printf '%s' '${tok.value}' | sudo tee /etc/nettact/enroll.token >/dev/null

# /etc/nettact/agent.env   (chmod 0600, root-owned)
NETTACT_AGENT_SERVER_URL=${url.value}
NETTACT_AGENT_ENROLL_TOKEN_FILE=/etc/nettact/enroll.token
# Optional — replace the default policy with an explicit grant:
# NETTACT_AGENT_PERMISSIONS=host.cpu.read,host.memory.read,probe.icmp

# /etc/systemd/system/nettact-agent.service
[Service]
EnvironmentFile=/etc/nettact/agent.env
ExecStart=/usr/local/bin/nettact-agent`,
)

const container = computed(
  () =>
    `docker run -d --name nettact-agent \\
  -e NETTACT_AGENT_SERVER_URL=${url.value} \\
  -e NETTACT_AGENT_ENROLL_TOKEN=${tok.value} \\
  -e NETTACT_AGENT_DATA_DIR=/data \\
  -v nettact-agent-data:/data \\
  ghcr.io/nettact/agent:latest`,
)

const snippet = computed(() =>
  tab.value === 'powershell' ? powershell.value : tab.value === 'systemd' ? systemd.value : container.value,
)

const copied = ref(false)
function copy() {
  navigator.clipboard?.writeText(snippet.value)
  copied.value = true
  window.setTimeout(() => (copied.value = false), 1500)
}
</script>

<template>
  <div class="enroll">
    <div class="tabs" role="tablist">
      <button
        v-for="k in (['powershell', 'systemd', 'container'] as Tab[])"
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

    <div class="code-wrap">
      <button class="copy" @click="copy">{{ copied ? $t('common.saved') : $t('agents.copy') }}</button>
      <pre><code>{{ snippet }}</code></pre>
    </div>

    <ul class="callouts">
      <li>{{ $t('onboarding.calloutReplace') }}</li>
      <li>{{ $t('onboarding.calloutTokenFile') }}</li>
      <li>{{ $t('onboarding.calloutRestart') }}</li>
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

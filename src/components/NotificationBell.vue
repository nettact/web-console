<script setup lang="ts">
// Topbar notification bell: unread badge + dropdown of active issues. The badge
// count is server-authoritative (notifications.unread). Each item deep-links to
// the relevant agent/monitor and can be marked read individually; a header action
// marks all read. Full issue state arrives over SSE via notifications.ts.
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { notifications, markRead, issueLink, issueReasonText } from '../notifications'
import type { Issue } from '../api'
import { toDateLocale } from '../i18n'
import { serverInfo, ensureServerInfo } from '../serverInfo'
import PermissionChips from './status/PermissionChips.vue'
import PermissionRemediationDialog from './status/PermissionRemediationDialog.vue'

const { locale } = useI18n()

const open = ref(false)
const activeIssues = computed(() => notifications.issues.filter((i) => i.state === 'active'))
// Recently resolved issues are shown as history so a resolution is visible (not
// just a row that silently vanished). Newest first, capped for the dropdown.
const resolvedIssues = computed(() =>
  notifications.issues.filter((i) => i.state === 'resolved').slice(0, 8),
)
const hasUnread = computed(() => notifications.unread > 0)
const badge = computed(() => (notifications.unread > 99 ? '99+' : String(notifications.unread)))

function toggle() {
  open.value = !open.value
}
function close() {
  open.value = false
}
function onClickItem(id: string) {
  markRead([id])
  close()
}
const fmtTime = (s: string) => new Date(s).toLocaleString(toDateLocale(locale.value), { hour12: false })

// The server attaches a full NETTACT_AGENT_PERMISSIONS line to permission_blocked
// issues; surface it inline with copy + a jump to the agent's detail (where the
// remediation dialog shows the per run-mode snippets). Guarded so non-permission
// issues render unchanged.
function issueEnv(iss: Issue): string {
  return iss.reason === 'permission_blocked' ? iss.remediation?.permissions_env || '' : ''
}
const copiedId = ref('')
function copyEnv(iss: Issue) {
  const env = issueEnv(iss)
  if (!env) return
  navigator.clipboard?.writeText(env)
  copiedId.value = iss.id
  window.setTimeout(() => {
    if (copiedId.value === iss.id) copiedId.value = ''
  }, 1500)
}
// A blocked permission's remediation lives entirely in the issue itself (its
// missing_permissions + the server-computed permissions_env), so a missing-
// permission chip opens the shared dialog inline rather than deep-linking to the
// Agent page — whose chips only cover granted-but-unsupported permissions and so
// would never surface this not-granted one. The dialog Teleports to <body>, so it
// layers above the dropdown regardless of the panel's stacking context; it is
// mounted outside the panel's v-if so it survives the panel closing.
const remediation = ref<{ permId: string; env: string } | null>(null)
function openRemediation(iss: Issue, permId: string) {
  ensureServerInfo()
  markRead([iss.id])
  remediation.value = { permId, env: issueEnv(iss) }
}

// Close on outside click while the dropdown is open.
function onDocClick(e: MouseEvent) {
  const el = e.target as HTMLElement
  if (!el.closest?.('.bell-wrap')) close()
}
watch(open, (v) => {
  if (v) document.addEventListener('click', onDocClick, true)
  else document.removeEventListener('click', onDocClick, true)
})
onBeforeUnmount(() => document.removeEventListener('click', onDocClick, true))
</script>

<template>
  <div class="bell-wrap">
    <button class="bell-btn" :class="{ active: open }" :aria-label="$t('issues.bellAria')" @click="toggle">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9"
        stroke-linecap="round" stroke-linejoin="round">
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>
      <span v-if="hasUnread" class="badge">{{ badge }}</span>
    </button>

    <div v-if="open" class="panel">
      <div class="panel-head">
        <span class="ttl">{{ $t('issues.centerTitle') }}</span>
        <button v-if="activeIssues.length" class="link-btn" @click="markRead('all')">{{ $t('issues.markAllRead') }}</button>
      </div>
      <div class="panel-body">
        <p v-if="!activeIssues.length && !resolvedIssues.length" class="empty">{{ $t('issues.noneActive') }}</p>
        <RouterLink
          v-for="iss in activeIssues"
          :key="iss.id"
          class="item"
          :class="{ unread: !iss.read }"
          :to="issueLink(iss)"
          @click="onClickItem(iss.id)"
        >
          <span class="dot" :class="{ on: !iss.read }" aria-hidden="true"></span>
          <div class="item-body">
            <p class="item-top">
              <span class="agent">{{ iss.agent_name || iss.agent_id }}</span>
              <span v-if="iss.monitor_name" class="mon">· {{ iss.monitor_name }}</span>
              <span v-if="iss.count > 1" class="count">×{{ iss.count }}</span>
            </p>
            <p class="reason">{{ issueReasonText(iss) }}</p>
            <div v-if="issueEnv(iss)" class="remediation" @click.stop.prevent>
              <code class="rem-env">{{ $t('issues.remediationEnv', { env: issueEnv(iss) }) }}</code>
              <div class="rem-actions">
                <button type="button" class="rem-btn" @click.stop.prevent="copyEnv(iss)">
                  {{ copiedId === iss.id ? $t('common.saved') : $t('agents.copy') }}
                </button>
              </div>
              <PermissionChips
                v-if="iss.missing_permissions.length"
                class="rem-perms"
                :label="$t('targetStatus.missingPermissions')"
                :ids="iss.missing_permissions"
                interactive
                @select="(permId: string) => openRemediation(iss, permId)"
              />
            </div>
            <p class="when">{{ fmtTime(iss.last_seen_at) }}</p>
          </div>
        </RouterLink>

        <template v-if="resolvedIssues.length">
          <p class="section-head">{{ $t('issues.resolvedTitle') }}</p>
          <RouterLink
            v-for="iss in resolvedIssues"
            :key="iss.id"
            class="item resolved"
            :to="issueLink(iss)"
            @click="close"
          >
            <span class="dot resolved-dot" aria-hidden="true"></span>
            <div class="item-body">
              <p class="item-top">
                <span class="agent">{{ iss.agent_name || iss.agent_id }}</span>
                <span v-if="iss.monitor_name" class="mon">· {{ iss.monitor_name }}</span>
                <span class="resolved-tag">{{ $t('issues.resolvedState') }}</span>
              </p>
              <p class="reason">{{ issueReasonText(iss) }}</p>
              <p class="when">{{ fmtTime(iss.resolved_at || iss.last_seen_at) }}</p>
            </div>
          </RouterLink>
        </template>
      </div>
    </div>

    <PermissionRemediationDialog
      :open="!!remediation"
      :perm-id="remediation?.permId || ''"
      :category="'permission_blocked'"
      :permissions-env="remediation?.env"
      :desktop="serverInfo.desktop"
      @close="remediation = null"
    />
  </div>
</template>

<style scoped>
.bell-wrap {
  position: relative;
  display: inline-flex;
}
.bell-btn {
  position: relative;
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  background: var(--surface-2);
  color: var(--text-dim);
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
}
.bell-btn:hover,
.bell-btn.active {
  color: var(--text);
  border-color: var(--border-strong);
}
.badge {
  position: absolute;
  top: -5px;
  right: -5px;
  min-width: 17px;
  height: 17px;
  padding: 0 4px;
  border-radius: 999px;
  font-size: 10.5px;
  font-weight: 700;
  line-height: 17px;
  text-align: center;
  color: #fff;
  background: var(--danger);
}
.panel {
  position: absolute;
  top: 44px;
  right: 0;
  width: 340px;
  max-height: 60vh;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface);
  box-shadow: 0 16px 40px -14px rgba(0, 0, 0, 0.5);
  z-index: 40;
}
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
}
.ttl {
  font-size: 13px;
  font-weight: 600;
}
.panel-body {
  overflow-y: auto;
}
.empty {
  padding: 22px 14px;
  text-align: center;
  font-size: 13px;
  color: var(--text-muted);
}
.section-head {
  margin: 0;
  padding: 8px 14px 4px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
  border-top: 1px solid var(--border);
}
.item.resolved {
  opacity: 0.72;
}
.resolved-dot {
  background: var(--ok, #34d399);
  border-color: var(--ok, #34d399);
}
.resolved-tag {
  margin-left: 6px;
  font-size: 11px;
  color: #6ee7b7;
}
.item {
  display: flex;
  gap: 10px;
  padding: 11px 14px;
  border-bottom: 1px solid var(--border);
  color: inherit;
}
.item:last-child {
  border-bottom: none;
}
.item:hover {
  background: var(--surface-2);
}
.item.unread {
  background: var(--primary-soft, rgba(56, 189, 248, 0.06));
}
.dot {
  flex: none;
  width: 8px;
  height: 8px;
  margin-top: 5px;
  border-radius: 50%;
  background: transparent;
  border: 1px solid var(--border-strong);
}
.dot.on {
  background: var(--primary);
  border-color: var(--primary);
}
.item-body {
  min-width: 0;
  flex: 1;
}
.item-top {
  margin: 0;
  font-size: 12.5px;
}
.agent {
  font-weight: 600;
  color: var(--text);
}
.mon {
  color: var(--text-dim);
}
.count {
  margin-left: 6px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}
.reason {
  margin: 3px 0 0;
  font-size: 12px;
  color: var(--text-dim);
  word-break: break-word;
}
.when {
  margin: 3px 0 0;
  font-size: 11px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}
.remediation {
  margin: 6px 0 0;
  padding: 7px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  cursor: default;
}
.rem-env {
  display: block;
  font-family: var(--mono, monospace);
  font-size: 11px;
  line-height: 1.5;
  color: var(--text-dim);
  word-break: break-all;
}
.rem-actions {
  display: flex;
  gap: 10px;
  margin-top: 6px;
}
.rem-perms {
  margin-top: 8px;
}
.rem-btn {
  border: none;
  background: transparent;
  color: var(--primary);
  font: inherit;
  font-size: 11.5px;
  padding: 0;
  cursor: pointer;
}
.rem-btn:hover {
  text-decoration: underline;
}
.link-btn {
  border: none;
  background: transparent;
  color: var(--primary);
  font: inherit;
  font-size: 12px;
  padding: 0;
  cursor: pointer;
}
.link-btn:hover {
  text-decoration: underline;
}
</style>

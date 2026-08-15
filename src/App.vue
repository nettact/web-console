<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter, useRoute, RouterLink, RouterView } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { auth, logout } from './auth'
import { showResumeBanner, saveOnboarding } from './onboarding'
import { serverInfo } from './serverInfo'
import { dismissUpdateBanner, showUpdateBanner, syncUpdateNotice } from './updateInfo'
import { initNotifications, resetNotifications, stopNotifications } from './notifications'
import { initTargetStatus, resetTargetStatus, stopTargetStatus } from './targetStatus'
import { initAgentStatus, resetAgentStatus, stopAgentStatus } from './agentStatus'
import LangSwitch from './components/LangSwitch.vue'
import ThemeSwitch from './components/ThemeSwitch.vue'
import NotificationBell from './components/NotificationBell.vue'
import Toasts from './components/Toasts.vue'
import BrandMark from './components/BrandMark.vue'

const router = useRouter()
const route = useRoute()
const { t } = useI18n()
const navOpen = ref(false)

async function doLogout() {
  await logout()
  router.push('/login')
}

// Keep one multiplexed SSE connection only while this tab is visible. Hidden
// NetTact tabs must not occupy Chrome's small HTTP/1.1 per-origin connection pool.
//
// Hiding only SUSPENDS the stores — their snapshots stay, so the kept-alive views
// keep rendering at full height and the browser keeps the user's scroll position.
// Only losing the session drops the data.
function syncLiveStreams(): void {
  if (!auth.user) {
    resetNotifications()
    resetTargetStatus()
    resetAgentStatus()
    return
  }
  if (document.visibilityState === 'visible') {
    // Authenticated, so it is read here rather than on mount to keep the update
    // settings off the login screen — and re-read on every return to the tab,
    // because the daily check and the desktop tray both change what it reports
    // while this tab sits open. It never rejects, so it needs no catch.
    void syncUpdateNotice()
    initNotifications()
    initTargetStatus()
    initAgentStatus()
  } else {
    stopNotifications()
    stopTargetStatus()
    stopAgentStatus()
  }
}

watch(
  () => auth.user,
  () => syncLiveStreams(),
  { immediate: true },
)

function onVisibilityChange(): void {
  syncLiveStreams()
}

onMounted(() => {
  document.addEventListener('visibilitychange', onVisibilityChange)
  syncLiveStreams()
})

onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', onVisibilityChange)
  resetNotifications()
  resetTargetStatus()
  resetAgentStatus()
})

// `label` is an i18n key resolved at render time so nav + breadcrumb re-translate live.
const nav = [
  { to: '/', label: 'nav.overview' },
  { to: '/incidents', label: 'nav.incidents' },
  { to: '/target-status', label: 'nav.targetStatus' },
  { to: '/agents', label: 'nav.agents' },
  { to: '/monitoring', label: 'nav.monitoring' },
  { to: '/proxies', label: 'nav.proxies' },
  { to: '/status-pages', label: 'nav.statusPages' },
  { to: '/settings', label: 'nav.settings' },
]

const navItemActive = (to: string) => route.path === to || (to !== '/' && route.path.startsWith(`${to}/`))

watch(
  () => route.fullPath,
  () => {
    navOpen.value = false
  },
)

const sectionTitle = computed(() => {
  const key = nav.find((n) => navItemActive(n.to))?.label ?? 'nav.overview'
  return t(key)
})
const initials = computed(() => (auth.user?.username ?? '?').slice(0, 1).toUpperCase())

// Bare routes (login, onboarding) render full-screen without the app shell.
const isBare = computed(() => route.meta.bare === true)

function resumeOnboarding(): void {
  router.push('/onboarding')
}
async function dismissBanner(): Promise<void> {
  try {
    await saveOnboarding({ banner_dismissed: true })
  } catch {
    /* ignore — the banner just reappears next load */
  }
}

// ---- update banner ----
// A Store install can report an update it cannot name, so the message has a
// version-less variant. The link always goes to the server-provided URL; the
// install type only decides whether it reads "Open Microsoft Store". An install
// managed by a Watchtower sidecar updates itself, so it says so instead of
// offering a download.
const updateText = computed(() => {
  const u = serverInfo.update
  if (u?.auto_update) {
    const v = u.latest_version?.trim()
    return v ? t('update.bannerTextAuto', { version: v }) : t('update.bannerTextAutoUnnamed')
  }
  const v = u?.latest_version?.trim()
  return v ? t('update.bannerText', { version: v }) : t('update.bannerTextUnnamed')
})
const updateActionLabel = computed(() =>
  serverInfo.update?.install_type === 'store' ? t('update.openStore') : t('update.download'),
)
async function dismissUpdate(): Promise<void> {
  try {
    await dismissUpdateBanner()
  } catch {
    /* ignore — the banner just reappears next load */
  }
}
</script>

<template>
  <div v-if="auth.user && !isBare" class="app-shell" :class="{ 'nav-open': navOpen }">
    <button
      v-if="navOpen"
      class="nav-backdrop"
      :aria-label="t('app.closeNavigation')"
      @click="navOpen = false"
    ></button>
    <aside id="primary-navigation" class="sidebar" :class="{ 'is-open': navOpen }">
      <div class="logo">
        <BrandMark class="logo-mark" variant="compact" />
        <span class="logo-text">
          <b>NetTact</b>
          <small>{{ t('app.consoleSubtitle') }}</small>
        </span>
      </div>

      <nav class="nav">
        <RouterLink
          v-for="n in nav"
          :key="n.to"
          :to="n.to"
          class="nav-link"
          :class="{ 'is-active': navItemActive(n.to) }"
          @click="navOpen = false"
        >
          <span class="nav-ico" aria-hidden="true">
            <!-- 总览 -->
            <svg v-if="n.to === '/'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"
              stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="7" height="9" rx="1.5" />
              <rect x="14" y="3" width="7" height="5" rx="1.5" />
              <rect x="14" y="12" width="7" height="9" rx="1.5" />
              <rect x="3" y="16" width="7" height="5" rx="1.5" />
            </svg>
            <!-- 监控目标状态 -->
            <svg v-else-if="n.to === '/target-status'" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
              <path d="M2 12h4l2.5 6 4-13 2.5 8 1.5-3h5.5" />
            </svg>
            <!-- 事故 -->
            <svg v-else-if="n.to === '/incidents'" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
              <path d="M10.3 3.2 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.2a2 2 0 0 0-3.4 0Z" />
              <path d="M12 9v4" />
              <path d="M12 17h.01" />
            </svg>
            <!-- 监控目标 -->
            <svg v-else-if="n.to === '/monitoring'" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="8" />
              <circle cx="12" cy="12" r="3.4" />
              <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
            </svg>
            <!-- Agent 管理 -->
            <svg v-else-if="n.to === '/agents'" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="4" width="18" height="7" rx="2" />
              <rect x="3" y="13" width="18" height="7" rx="2" />
              <path d="M7 7.5h.01M7 16.5h.01" />
            </svg>
            <!-- 代理：出站流量经中转节点绕行 -->
            <svg v-else-if="n.to === '/proxies'" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="4" cy="12" r="2" />
              <circle cx="12" cy="5" r="2" />
              <circle cx="20" cy="12" r="2" />
              <path d="M5.6 10.6 10.5 6.2M13.5 6.2l4.9 4.4" />
              <path d="M6 13.5c3 3.5 9 3.5 12 0" stroke-dasharray="2 2.5" />
            </svg>
            <!-- 公共状态页：对外公开的只读看板 -->
            <svg v-else-if="n.to === '/status-pages'" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
              <rect x="2.5" y="4" width="19" height="13" rx="2" />
              <path d="M8 21h8M12 17v4" />
              <path d="M6.5 12.5h2.5M11 9.5h2.5M15.5 12.5H18" />
            </svg>
            <!-- 设置 -->
            <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"
              stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 0 1-4 0v-.1A1.6 1.6 0 0 0 7 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H1a2 2 0 0 1 0-4h.1A1.6 1.6 0 0 0 2.6 7a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H7a1.6 1.6 0 0 0 1-1.5V1a2 2 0 0 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V7a1.6 1.6 0 0 0 1.5 1H23a2 2 0 0 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z" />
            </svg>
          </span>
          <span class="nav-label">{{ t(n.label) }}</span>
        </RouterLink>
      </nav>

      <div class="sidebar-foot">
        <span class="dot live"></span>
        <span>{{ t('app.liveCollect') }}</span>
      </div>
    </aside>

    <div class="main">
      <header class="topbar">
        <button
          class="menu-toggle"
          type="button"
          :aria-label="t('app.openNavigation')"
          aria-controls="primary-navigation"
          :aria-expanded="navOpen"
          @click="navOpen = true"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
        <div class="crumb">
          <span class="crumb-root">NetTact</span>
          <span class="crumb-sep">/</span>
          <span class="crumb-cur">{{ sectionTitle }}</span>
        </div>
        <span class="spacer"></span>
        <ThemeSwitch />
        <LangSwitch />
        <NotificationBell />
        <div class="user-chip">
          <span class="avatar">{{ initials }}</span>
          <span class="uname">{{ auth.user.username }}</span>
        </div>
        <button class="btn btn-ghost" @click="doLogout">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9"
            stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
          </svg>
          {{ t('app.logout') }}
        </button>
      </header>

      <div v-if="showResumeBanner" class="setup-banner">
        <span class="setup-banner-text">{{ t('setup.bannerText') }}</span>
        <button class="btn btn-primary btn-sm" @click="resumeOnboarding">{{ t('setup.bannerResume') }}</button>
        <button class="banner-close" :aria-label="t('setup.bannerDismiss')" @click="dismissBanner">✕</button>
      </div>

      <div v-if="showUpdateBanner && serverInfo.update" class="setup-banner update-banner">
        <span class="setup-banner-text">{{ updateText }}</span>
        <!-- Auto-updating installs have nothing to download; the sidecar handles
             it. Only the dismiss stays, so the banner reads as news. -->
        <a
          v-if="!serverInfo.update.auto_update"
          class="btn btn-primary btn-sm"
          :href="serverInfo.update.download_url"
          target="_blank"
          rel="noopener noreferrer"
        >{{ updateActionLabel }}</a>
        <button class="banner-close" :aria-label="t('update.bannerDismiss')" @click="dismissUpdate">✕</button>
      </div>

      <div class="content">
        <RouterView v-slot="{ Component }">
          <KeepAlive :include="['TargetStatus', 'Agents']">
            <component :is="Component" />
          </KeepAlive>
        </RouterView>
      </div>
    </div>
  </div>

  <RouterView v-else />

  <Toasts />
</template>

<style scoped>
.app-shell {
  display: grid;
  grid-template-columns: 244px 1fr;
  min-height: 100vh;
}

/* ---------------- resume-onboarding banner ---------------- */
.setup-banner {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 12px var(--page-edge) 0;
  padding: 10px 14px;
  border: 1px solid var(--primary);
  border-radius: 10px;
  background: var(--surface-2, rgba(56, 189, 248, 0.08));
}
.setup-banner-text {
  flex: 1;
  font-size: 13.5px;
}
.setup-banner .btn-sm {
  padding: 6px 12px;
  font-size: 13px;
}
.banner-close {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  padding: 4px;
}
.banner-close:hover {
  color: var(--text);
}

/* ---------------- sidebar ---------------- */
.sidebar {
  display: flex;
  flex-direction: column;
  padding: 20px 14px;
  border-right: 1px solid var(--border);
  background: var(--sidebar-bg);
  backdrop-filter: blur(12px);
  position: sticky;
  top: 0;
  height: 100vh;
}
.logo {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 6px 8px 22px;
}
.logo-mark {
  display: block;
  flex: none;
  width: 38px;
  height: 38px;
}
.logo-text {
  display: flex;
  flex-direction: column;
  line-height: 1.2;
}
.logo-text b {
  font-size: 16px;
  letter-spacing: 0;
}
.logo-text small {
  font-size: 11px;
  color: var(--text-muted);
}

.nav {
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex: 1;
}
.nav-link {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 10px;
  color: var(--text-dim);
  font-size: 14px;
  font-weight: 520;
  position: relative;
  transition: background 0.16s, color 0.16s;
}
.nav-link:hover {
  background: var(--surface-2);
  color: var(--text);
}
.nav-ico {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  flex: none;
  opacity: 0.85;
}
.nav-ico svg {
  width: 20px;
  height: 20px;
}
.nav-link.is-active {
  color: var(--text);
  background: linear-gradient(90deg, var(--primary-soft), rgba(56, 189, 248, 0.02));
}
.nav-link.is-active .nav-ico {
  color: var(--color-accent-text);
  opacity: 1;
}
.nav-link.is-active::before {
  content: "";
  position: absolute;
  left: -14px;
  top: 8px;
  bottom: 8px;
  width: 3px;
  border-radius: 0 3px 3px 0;
  background: var(--primary);
  box-shadow: 0 0 10px var(--primary-glow);
}

.sidebar-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 12px 4px;
  margin-top: 8px;
  border-top: 1px solid var(--border);
  font-size: 12px;
  color: var(--text-muted);
}

/* ---------------- main ---------------- */
.main {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.topbar {
  position: sticky;
  top: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 12px;
  height: 60px;
  padding: 0 var(--page-edge);
  border-bottom: 1px solid var(--border);
  background: var(--topbar-bg);
  backdrop-filter: blur(14px);
}
.crumb {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
}
.crumb-root {
  color: var(--text-muted);
}
.crumb-sep {
  color: var(--text-muted);
}
.crumb-cur {
  color: var(--text);
  font-weight: 600;
}
.user-chip {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 5px 12px 5px 5px;
  border-radius: var(--radius-pill);
  background: var(--surface-2);
  border: 1px solid var(--border);
}
.avatar {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  font-size: 12px;
  font-weight: 700;
  color: #04121c;
  background: linear-gradient(150deg, #7dd3fc, var(--accent));
}
.uname {
  font-size: 13px;
  color: var(--text-dim);
}
.content {
  flex: 1;
  min-height: 0;
}

/* ---------------- responsive ---------------- */
@media (max-width: 560px) {
  .uname {
    display: none;
  }
}

/* Hallmark material overrides: shell glass owns depth; page content stays legible. */
.app-shell {
  grid-template-columns: 16rem minmax(0, 1fr);
}

.sidebar {
  top: var(--space-xs);
  height: calc(100dvh - var(--space-md));
  margin: var(--space-xs) 0 var(--space-xs) var(--space-xs);
  padding: var(--space-sm) var(--space-xs);
  border: var(--rule-hair) solid var(--glass-border);
  border-radius: var(--radius-panel);
  background: var(--glass-specular), var(--color-glass-strong);
  box-shadow:
    inset 0 var(--rule-hair) var(--glass-highlight),
    var(--shadow-card);
  backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
}

.logo {
  gap: var(--space-xs);
  padding: var(--space-2xs) var(--space-2xs) var(--space-md);
}

.logo-mark {
  width: 2.5rem;
  height: 2.5rem;
}

.logo-text b {
  font-family: var(--font-display);
  font-size: var(--text-base);
  font-weight: 760;
  letter-spacing: 0;
}

.logo-text small {
  color: var(--color-muted);
  font-size: var(--text-xs);
}

.nav {
  gap: var(--space-3xs);
}

.nav-link {
  min-height: 2.75rem;
  gap: var(--space-xs);
  padding-inline: var(--space-xs);
  border: var(--rule-hair) solid transparent;
  border-radius: var(--radius-input);
  color: var(--color-ink-2);
  font-size: var(--text-sm);
  font-weight: 620;
  white-space: nowrap;
  transition:
    transform var(--dur-micro) var(--ease-out),
    opacity var(--dur-micro) var(--ease-out);
}

.nav-link.is-active {
  border-color: var(--color-rule);
  color: var(--color-ink);
  background: var(--color-glass-hover);
  box-shadow: inset 0 var(--rule-hair) color-mix(in oklch, var(--color-ink) 9%, transparent);
}

.nav-link.is-active::before {
  display: none;
}

.nav-link.is-active .nav-ico {
  color: var(--color-accent-text);
}

.sidebar-foot {
  margin-top: var(--space-xs);
  padding: var(--space-sm) var(--space-xs) var(--space-2xs);
  border-top-color: var(--color-rule);
  color: var(--color-muted);
  font-size: var(--text-xs);
}

.main {
  min-height: 100dvh;
}

.topbar {
  top: 0;
  z-index: var(--z-sticky);
  height: 3.5rem;
  margin: var(--space-xs) var(--page-edge) 0;
  padding-inline: var(--space-xs);
  border: var(--rule-hair) solid var(--glass-border);
  border-radius: var(--radius-card);
  background: var(--glass-specular-soft), var(--color-glass);
  box-shadow:
    inset 0 var(--rule-hair) var(--glass-highlight),
    var(--shadow-card);
  backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
}

.crumb {
  min-width: 0;
  font-size: var(--text-sm);
}

.crumb-root,
.crumb-sep {
  color: var(--color-muted);
}

.crumb-cur {
  overflow: hidden;
  color: var(--color-ink);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.user-chip {
  min-height: 2.5rem;
  padding: var(--space-3xs) var(--space-xs) var(--space-3xs) var(--space-3xs);
  border-color: var(--color-rule);
  background: var(--color-glass-subtle);
}

.avatar {
  width: 2rem;
  height: 2rem;
  color: var(--color-primary-action-text);
  background: var(--color-primary-action-bg);
}

.menu-toggle,
.nav-backdrop {
  display: none;
}

.menu-toggle {
  width: 2.75rem;
  height: 2.75rem;
  place-items: center;
  flex: none;
  padding: 0;
  border: var(--rule-hair) solid var(--color-rule);
  border-radius: var(--radius-input);
  color: var(--color-ink);
  background: var(--color-glass-subtle);
}

.menu-toggle svg {
  width: 1.25rem;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
}

.setup-banner {
  margin: var(--space-xs) var(--page-edge) 0;
  padding: var(--space-xs) var(--space-sm);
  border: var(--rule-hair) solid var(--color-rule-2);
  border-radius: var(--radius-card);
  background: var(--glass-specular), var(--color-glass-strong);
  box-shadow: var(--shadow-card);
  backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
}

/* Same shell as the resume banner; only the accent differs, so an update reads as
   news rather than as unfinished setup. */
.update-banner {
  border-color: color-mix(in oklch, var(--color-accent) 45%, var(--color-rule-2));
}

.banner-close {
  min-width: 2.75rem;
  min-height: 2.75rem;
  color: var(--color-muted);
}

@media (hover: hover) and (pointer: fine) {
  .nav-link:hover {
    color: var(--color-ink);
    background: var(--color-glass-hover);
    transform: translateX(var(--rule-hair));
  }
}

@media (max-width: 60rem) {
  .app-shell {
    grid-template-columns: 5rem minmax(0, 1fr);
  }

  .sidebar {
    margin-inline-start: var(--space-2xs);
    padding-inline: var(--space-2xs);
  }

  .logo-text,
  .nav-label,
  .sidebar-foot span:last-child {
    display: none;
  }

  .logo,
  .nav-link,
  .sidebar-foot {
    justify-content: center;
  }

  .logo {
    padding: var(--space-2xs) 0 var(--space-md);
  }

  .nav-link {
    padding: var(--space-xs) 0;
  }

  .nav-link.is-active::before {
    display: none;
  }
}

@media (max-width: 46rem) {
  .app-shell {
    display: block;
  }

  .menu-toggle {
    display: grid;
  }

  .sidebar {
    position: fixed;
    top: var(--space-2xs);
    bottom: var(--space-2xs);
    left: var(--space-2xs);
    z-index: var(--z-modal);
    width: min(19rem, calc(100% - var(--space-xl)));
    height: auto;
    margin: 0;
    padding: var(--space-sm);
    transform: translateX(calc(-100% - var(--space-md)));
    transition:
      transform var(--dur-long) var(--ease-out),
      opacity var(--dur-short) var(--ease-out);
    opacity: 0;
  }

  .sidebar.is-open {
    transform: translateX(0);
    opacity: 1;
  }

  .logo-text,
  .nav-label,
  .sidebar-foot span:last-child {
    display: flex;
  }

  .logo,
  .nav-link,
  .sidebar-foot {
    justify-content: flex-start;
  }

  .logo {
    padding: var(--space-2xs) var(--space-2xs) var(--space-md);
  }

  .nav-link {
    padding-inline: var(--space-xs);
  }

  .nav-backdrop {
    position: fixed;
    inset: 0;
    z-index: calc(var(--z-modal) - 1);
    display: block;
    border: 0;
    background: var(--color-backdrop);
    backdrop-filter: blur(var(--space-2xs));
    -webkit-backdrop-filter: blur(var(--space-2xs));
  }

  .topbar {
    top: 0;
    gap: var(--space-2xs);
    margin: var(--space-2xs) var(--space-2xs) 0;
  }

  .crumb-root,
  .crumb-sep,
  .user-chip,
  .topbar .btn-ghost {
    display: none;
  }

  .setup-banner {
    align-items: flex-start;
    flex-wrap: wrap;
    margin-inline: var(--space-2xs);
  }

  .setup-banner-text {
    flex-basis: calc(100% - 3.5rem);
  }
}
</style>

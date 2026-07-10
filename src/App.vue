<script setup lang="ts">
import { computed } from 'vue'
import { useRouter, useRoute, RouterLink, RouterView } from 'vue-router'
import { auth, logout } from './auth'

const router = useRouter()
const route = useRoute()

async function doLogout() {
  await logout()
  router.push('/login')
}

const nav = [
  { to: '/', label: '总览' },
  { to: '/history', label: '历史' },
  { to: '/incidents', label: '事故' },
  { to: '/monitoring', label: '监控目标' },
  { to: '/settings', label: '设置' },
]

const sectionTitle = computed(() => nav.find((n) => n.to === route.path)?.label ?? '总览')
const initials = computed(() => (auth.user?.username ?? '?').slice(0, 1).toUpperCase())
</script>

<template>
  <div v-if="auth.user" class="app-shell">
    <aside class="sidebar">
      <div class="logo">
        <span class="logo-mark">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2"
            stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 12h3l2.5 7 5-15L18 12h3" />
          </svg>
        </span>
        <span class="logo-text">
          <b>NetTact</b>
          <small>网络监控控制台</small>
        </span>
      </div>

      <nav class="nav">
        <RouterLink v-for="n in nav" :key="n.to" :to="n.to" class="nav-link">
          <span class="nav-ico" aria-hidden="true">
            <!-- 总览 -->
            <svg v-if="n.to === '/'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"
              stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="7" height="9" rx="1.5" />
              <rect x="14" y="3" width="7" height="5" rx="1.5" />
              <rect x="14" y="12" width="7" height="9" rx="1.5" />
              <rect x="3" y="16" width="7" height="5" rx="1.5" />
            </svg>
            <!-- 历史 -->
            <svg v-else-if="n.to === '/history'" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 3v18h18" />
              <path d="M7 14l3.5-4 3 3L21 6" />
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
            <!-- 设置 -->
            <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"
              stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 0 1-4 0v-.1A1.6 1.6 0 0 0 7 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H1a2 2 0 0 1 0-4h.1A1.6 1.6 0 0 0 2.6 7a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H7a1.6 1.6 0 0 0 1-1.5V1a2 2 0 0 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V7a1.6 1.6 0 0 0 1.5 1H23a2 2 0 0 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z" />
            </svg>
          </span>
          <span class="nav-label">{{ n.label }}</span>
        </RouterLink>
      </nav>

      <div class="sidebar-foot">
        <span class="dot live"></span>
        <span>实时采集 · 5s</span>
      </div>
    </aside>

    <div class="main">
      <header class="topbar">
        <div class="crumb">
          <span class="crumb-root">NetTact</span>
          <span class="crumb-sep">/</span>
          <span class="crumb-cur">{{ sectionTitle }}</span>
        </div>
        <span class="spacer"></span>
        <div class="user-chip">
          <span class="avatar">{{ initials }}</span>
          <span class="uname">{{ auth.user.username }}</span>
        </div>
        <button class="btn btn-ghost" @click="doLogout">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9"
            stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
          </svg>
          退出
        </button>
      </header>

      <div class="content">
        <RouterView />
      </div>
    </div>
  </div>

  <RouterView v-else />
</template>

<style scoped>
.app-shell {
  display: grid;
  grid-template-columns: 244px 1fr;
  min-height: 100vh;
}

/* ---------------- sidebar ---------------- */
.sidebar {
  display: flex;
  flex-direction: column;
  padding: 20px 14px;
  border-right: 1px solid var(--border);
  background: linear-gradient(180deg, rgba(13, 18, 28, 0.9), rgba(8, 11, 17, 0.72));
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
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: 11px;
  color: #04121c;
  background: linear-gradient(150deg, #7dd3fc, var(--primary-strong));
  box-shadow: 0 8px 20px -6px var(--primary-glow);
}
.logo-text {
  display: flex;
  flex-direction: column;
  line-height: 1.2;
}
.logo-text b {
  font-size: 16px;
  letter-spacing: -0.01em;
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
.nav-link.router-link-exact-active {
  color: var(--text);
  background: linear-gradient(90deg, var(--primary-soft), rgba(56, 189, 248, 0.02));
}
.nav-link.router-link-exact-active .nav-ico {
  color: var(--primary);
  opacity: 1;
}
.nav-link.router-link-exact-active::before {
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
  padding: 0 30px;
  border-bottom: 1px solid var(--border);
  background: rgba(8, 11, 17, 0.62);
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
@media (max-width: 960px) {
  .app-shell {
    grid-template-columns: 68px 1fr;
  }
  .logo-text,
  .nav-label,
  .sidebar-foot span:last-child {
    display: none;
  }
  .logo {
    justify-content: center;
    padding: 6px 0 20px;
  }
  .nav-link {
    justify-content: center;
    padding: 11px 0;
  }
  .nav-link.router-link-exact-active::before {
    left: -14px;
  }
  .sidebar-foot {
    justify-content: center;
  }
}
@media (max-width: 560px) {
  .topbar {
    padding: 0 16px;
  }
  .uname {
    display: none;
  }
}
</style>

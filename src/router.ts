import { createRouter, createWebHistory } from 'vue-router'
import { auth, refresh } from './auth'
import { onboarding, loadOnboarding } from './onboarding'
import Login from './views/Login.vue'
import Onboarding from './views/Onboarding.vue'
import Dashboard from './views/Dashboard.vue'
import Processes from './views/Processes.vue'
import TargetStatus from './views/TargetStatus.vue'
import TargetStatusHistory from './views/TargetStatusHistory.vue'
import HostMetrics from './views/HostMetrics.vue'
import GamePerformance from './views/GamePerformance.vue'
import GameRunDetail from './views/GameRunDetail.vue'
import Monitoring from './views/Monitoring.vue'
import MonitorForm from './views/MonitorForm.vue'
import MonitorGroupForm from './views/MonitorGroupForm.vue'
import Proxies from './views/Proxies.vue'
import ProxyForm from './views/ProxyForm.vue'
import Incidents from './views/Incidents.vue'
import Agents from './views/Agents.vue'
import AgentDetail from './views/AgentDetail.vue'
import Settings from './views/Settings.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', component: Login },
    { path: '/onboarding', component: Onboarding, meta: { bare: true } },
    { path: '/', component: Dashboard },
    { path: '/processes', component: Processes },
    { path: '/target-status', component: TargetStatus },
    { path: '/target-status/:targetId/agents/:agentId/history', component: TargetStatusHistory },
    { path: '/host-metrics', component: HostMetrics },
    // Game runs are not time series (a second of rendering is a distribution, not
    // a scalar), so they get their own pages rather than a Host Metrics section.
    { path: '/game-performance', component: GamePerformance },
    { path: '/game-performance/runs/:id', component: GameRunDetail },
    { path: '/monitoring', component: Monitoring },
    { path: '/monitoring/groups/new', component: MonitorGroupForm },
    { path: '/monitoring/groups/:id/edit', component: MonitorGroupForm },
    { path: '/monitoring/new', component: MonitorForm },
    { path: '/monitoring/new-host', component: MonitorForm },
    { path: '/monitoring/:id/edit', component: MonitorForm },
    // Egress proxies: site-scoped, reusable outbound paths a monitor can be pinned to.
    { path: '/proxies', component: Proxies },
    { path: '/proxies/new', component: ProxyForm },
    { path: '/proxies/:id/edit', component: ProxyForm },
    { path: '/incidents', component: Incidents },
    { path: '/agents', component: Agents },
    { path: '/agents/:id', component: AgentDetail },
    { path: '/settings', component: Settings },
  ],
})

// Auth guard: everything but /login requires a session. On genuine first run
// (onboarding state never saved), auto-open the wizard once; a read failure never
// blocks console entry.
router.beforeEach(async (to) => {
  if (!auth.ready) await refresh()
  if (to.path === '/login') {
    return auth.user ? '/' : true
  }
  if (!auth.user) return '/login'
  if (to.path !== '/onboarding') {
    if (!onboarding.loaded) await loadOnboarding()
    if (!onboarding.failed && onboarding.state === null) return '/onboarding'
  }
  return true
})

export default router

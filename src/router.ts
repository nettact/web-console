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
import Monitoring from './views/Monitoring.vue'
import MonitorForm from './views/MonitorForm.vue'
import MonitorGroupForm from './views/MonitorGroupForm.vue'
import Proxies from './views/Proxies.vue'
import ProxyForm from './views/ProxyForm.vue'
import StatusPages from './views/StatusPages.vue'
import StatusPageForm from './views/StatusPageForm.vue'
import Incidents from './views/Incidents.vue'
import IncidentReport from './views/IncidentReport.vue'
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
    // Public status pages. NOTE: the console must never claim the /status path —
    // the standalone public status app is mounted there by the server, and a
    // history-mode route would shadow it.
    { path: '/status-pages', component: StatusPages },
    { path: '/status-pages/new', component: StatusPageForm },
    { path: '/status-pages/:id/edit', component: StatusPageForm },
    { path: '/incidents', component: Incidents },
    // Self-contained diagnostic report (INCIDENT-004). Rendered bare (no app
    // shell) because it is a print document, not a page in the nav.
    { path: '/incidents/:id/report', component: IncidentReport, meta: { bare: true } },
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

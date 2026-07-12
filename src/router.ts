import { createRouter, createWebHistory } from 'vue-router'
import { auth, refresh } from './auth'
import Login from './views/Login.vue'
import Dashboard from './views/Dashboard.vue'
import Processes from './views/Processes.vue'
import TargetStatus from './views/TargetStatus.vue'
import HostMetrics from './views/HostMetrics.vue'
import Monitoring from './views/Monitoring.vue'
import MonitorForm from './views/MonitorForm.vue'
import Incidents from './views/Incidents.vue'
import Agents from './views/Agents.vue'
import Settings from './views/Settings.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', component: Login },
    { path: '/', component: Dashboard },
    { path: '/processes', component: Processes },
    { path: '/target-status', component: TargetStatus },
    { path: '/host-metrics', component: HostMetrics },
    { path: '/monitoring', component: Monitoring },
    { path: '/monitoring/new', component: MonitorForm },
    { path: '/monitoring/new-host', component: MonitorForm },
    { path: '/monitoring/:id/edit', component: MonitorForm },
    { path: '/incidents', component: Incidents },
    { path: '/agents', component: Agents },
    { path: '/settings', component: Settings },
  ],
})

// Auth guard: everything but /login requires a session.
router.beforeEach(async (to) => {
  if (!auth.ready) await refresh()
  if (to.path === '/login') {
    return auth.user ? '/' : true
  }
  return auth.user ? true : '/login'
})

export default router

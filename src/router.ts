import { createRouter, createWebHistory } from 'vue-router'
import { auth, refresh } from './auth'
import Login from './views/Login.vue'
import Dashboard from './views/Dashboard.vue'
import Processes from './views/Processes.vue'
import History from './views/History.vue'
import Monitoring from './views/Monitoring.vue'
import Incidents from './views/Incidents.vue'
import Settings from './views/Settings.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', component: Login },
    { path: '/', component: Dashboard },
    { path: '/processes', component: Processes },
    { path: '/history', component: History },
    { path: '/monitoring', component: Monitoring },
    { path: '/incidents', component: Incidents },
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

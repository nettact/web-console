<script setup lang="ts">
import { useRouter, RouterLink, RouterView } from 'vue-router'
import { auth, logout } from './auth'

const router = useRouter()
async function doLogout() {
  await logout()
  router.push('/login')
}
</script>

<template>
  <div>
    <nav v-if="auth.user" class="topnav">
      <span class="brand">NetTact</span>
      <RouterLink to="/">总览</RouterLink>
      <RouterLink to="/incidents">事故</RouterLink>
      <RouterLink to="/monitoring">监控目标</RouterLink>
      <RouterLink to="/rules">告警规则</RouterLink>
      <RouterLink to="/settings">设置</RouterLink>
      <span class="spacer"></span>
      <span class="user">{{ auth.user.username }}</span>
      <button class="link" @click="doLogout">退出</button>
    </nav>
    <RouterView />
  </div>
</template>

<style scoped>
.topnav {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 10px 20px;
  border-bottom: 1px solid rgba(128, 128, 128, 0.25);
  background: rgba(128, 128, 128, 0.06);
}
.brand {
  font-weight: 700;
}
.topnav a {
  text-decoration: none;
  color: inherit;
  opacity: 0.75;
}
.topnav a.router-link-active {
  opacity: 1;
  font-weight: 600;
}
.spacer {
  flex: 1;
}
.user {
  opacity: 0.7;
  font-size: 13px;
}
button.link {
  background: none;
  border: none;
  color: #3b82f6;
  cursor: pointer;
}
</style>

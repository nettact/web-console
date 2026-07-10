<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { login } from '../auth'

const username = ref('admin')
const password = ref('')
const error = ref('')
const busy = ref(false)
const router = useRouter()

async function submit() {
  error.value = ''
  busy.value = true
  try {
    await login(username.value, password.value)
    router.push('/')
  } catch (e) {
    error.value = String((e as Error).message || e)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="wrap">
    <form class="card" @submit.prevent="submit">
      <h1>NetTact 登录</h1>
      <input v-model="username" placeholder="用户名" autocomplete="username" />
      <input v-model="password" type="password" placeholder="密码" autocomplete="current-password" />
      <button :disabled="busy" type="submit">{{ busy ? '登录中…' : '登录' }}</button>
      <p v-if="error" class="err">{{ error }}</p>
    </form>
  </div>
</template>

<style scoped>
.wrap {
  min-height: 80vh;
  display: grid;
  place-items: center;
}
.card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 280px;
  padding: 28px;
  border: 1px solid rgba(128, 128, 128, 0.25);
  border-radius: 10px;
}
h1 {
  font-size: 18px;
  margin: 0 0 8px;
}
input,
button {
  padding: 8px 10px;
  font-size: 14px;
  border-radius: 6px;
  border: 1px solid rgba(128, 128, 128, 0.4);
}
button {
  background: #3b82f6;
  color: #fff;
  border: none;
  cursor: pointer;
}
.err {
  color: #c0392b;
  margin: 0;
  font-size: 13px;
}
</style>

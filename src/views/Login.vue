<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { login } from '../auth'
import LangSwitch from '../components/LangSwitch.vue'

const { t } = useI18n()

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
    <div class="glow"></div>
    <LangSwitch class="lang-corner" />
    <form class="card login" @submit.prevent="submit">
      <div class="brand">
        <span class="mark">
          <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2.2"
            stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 12h3l2.5 7 5-15L18 12h3" />
          </svg>
        </span>
        <div class="brand-text">
          <b>NetTact</b>
          <small>{{ t('app.consoleSubtitle') }}</small>
        </div>
      </div>

      <h1>{{ t('login.title') }}</h1>
      <p class="lead">{{ t('login.lead') }}</p>

      <label class="field">
        <span>{{ t('login.username') }}</span>
        <input v-model="username" :placeholder="t('login.usernamePlaceholder')" autocomplete="username" />
      </label>
      <label class="field">
        <span>{{ t('login.password') }}</span>
        <input v-model="password" type="password" placeholder="••••••••" autocomplete="current-password" />
      </label>

      <button class="btn btn-primary submit" :disabled="busy" type="submit">
        {{ busy ? t('login.signingIn') : t('login.signIn') }}
      </button>
      <p v-if="error" class="err">{{ error }}</p>
    </form>
  </div>
</template>

<style scoped>
.wrap {
  position: relative;
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 24px;
  overflow: hidden;
}
.glow {
  position: absolute;
  width: 520px;
  height: 520px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(56, 189, 248, 0.22), transparent 60%);
  filter: blur(20px);
  top: -120px;
  pointer-events: none;
}
.lang-corner {
  position: absolute;
  top: 20px;
  right: 20px;
  z-index: 2;
}
.login {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: 360px;
  max-width: 100%;
  padding: 32px 30px 30px;
}
.brand {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 6px;
}
.mark {
  display: grid;
  place-items: center;
  width: 46px;
  height: 46px;
  border-radius: 13px;
  color: #04121c;
  background: linear-gradient(150deg, #7dd3fc, var(--primary-strong));
  box-shadow: 0 10px 26px -8px var(--primary-glow);
}
.brand-text {
  display: flex;
  flex-direction: column;
  line-height: 1.25;
}
.brand-text b {
  font-size: 18px;
}
.brand-text small {
  font-size: 12px;
  color: var(--text-muted);
}
h1 {
  font-size: 20px;
  margin-top: 8px;
}
.lead {
  margin: -8px 0 6px;
  color: var(--text-dim);
  font-size: 13px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.field span {
  font-size: 12px;
  color: var(--text-dim);
  font-weight: 550;
}
.submit {
  margin-top: 6px;
  padding: 11px;
  font-size: 14.5px;
}
.err {
  margin: 2px 0 0;
}
</style>

<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { login } from '../auth'
import LangSwitch from '../components/LangSwitch.vue'
import ThemeSwitch from '../components/ThemeSwitch.vue'

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
    <div class="corner">
      <ThemeSwitch />
      <LangSwitch />
    </div>

    <section class="login-story" aria-labelledby="login-brand-title">
      <div class="brand">
        <span class="mark">
          <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2.2"
            stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 12h3l2.5 7 5-15L18 12h3" />
          </svg>
        </span>
        <div class="brand-text">
          <b id="login-brand-title">NetTact</b>
          <small>{{ t('app.consoleSubtitle') }}</small>
        </div>
      </div>

      <div class="story-copy">
        <svg class="story-signal" viewBox="0 0 320 64" preserveAspectRatio="none" aria-hidden="true">
          <path d="M0 42h42l18-24 34 42 34-54 36 44 24-20 26 12h106" />
        </svg>
        <p>{{ t('login.lead') }}</p>
      </div>
    </section>

    <form class="login" :aria-busy="busy" @submit.prevent="submit">
      <h1>{{ t('login.title') }}</h1>
      <p class="lead">{{ t('login.lead') }}</p>

      <label class="field">
        <span>{{ t('login.username') }}</span>
        <input
          v-model="username"
          :placeholder="t('login.usernamePlaceholder')"
          :aria-invalid="error ? 'true' : undefined"
          autocomplete="username"
        />
      </label>
      <label class="field">
        <span>{{ t('login.password') }}</span>
        <input
          v-model="password"
          type="password"
          :aria-invalid="error ? 'true' : undefined"
          autocomplete="current-password"
        />
      </label>

      <button
        class="btn btn-primary submit"
        :data-state="busy ? 'loading' : undefined"
        :disabled="busy"
        type="submit"
      >
        {{ busy ? t('login.signingIn') : t('login.signIn') }}
      </button>
      <p v-if="error" class="err" role="alert">{{ error }}</p>
    </form>
  </div>
</template>

<style scoped>
.wrap {
  position: relative;
  min-height: 100dvh;
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(22rem, 0.85fr);
  gap: var(--space-sm);
  padding: var(--space-sm);
}
.corner {
  position: fixed;
  top: var(--space-lg);
  right: var(--space-lg);
  z-index: var(--z-raised);
  display: flex;
  align-items: center;
  gap: var(--space-2xs);
}
.login-story,
.login {
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  border: var(--rule-hair) solid var(--color-rule);
  border-radius: var(--radius-panel);
  background: var(--color-glass);
  box-shadow:
    inset 0 var(--rule-hair) color-mix(in oklch, var(--color-ink) 10%, transparent),
    var(--shadow-card);
  backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
}
.login-story {
  justify-content: space-between;
  min-height: calc(100dvh - var(--space-lg));
  padding: clamp(var(--space-lg), 6vw, var(--space-2xl));
  overflow: hidden;
}
.login {
  align-self: center;
  gap: var(--space-sm);
  width: min(100%, 30rem);
  margin-inline: auto;
  padding: clamp(var(--space-md), 5vw, var(--space-xl));
}
.brand {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
}
.mark {
  display: grid;
  place-items: center;
  width: 3rem;
  height: 3rem;
  border-radius: var(--radius-input);
  color: var(--color-accent-ink);
  background: var(--color-accent);
}
.brand-text {
  display: flex;
  flex-direction: column;
  line-height: 1.25;
}
.brand-text b {
  font-family: var(--font-display);
  font-size: var(--text-lg);
  font-weight: 760;
  letter-spacing: -0.028em;
}
.brand-text small {
  color: var(--color-muted);
  font-size: var(--text-xs);
}
.story-copy {
  max-width: 36rem;
}
.story-signal {
  width: min(100%, 32rem);
  height: 6rem;
  margin-bottom: var(--space-md);
  fill: none;
  stroke: var(--color-accent);
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
  opacity: 0.82;
}
.story-copy p {
  max-width: 42ch;
  margin: 0;
  color: var(--color-ink-2);
  font-family: var(--font-display);
  font-size: clamp(var(--text-xl), 4vw, var(--text-3xl));
  font-weight: 700;
  line-height: 1.18;
  letter-spacing: -0.03em;
}
h1 {
  margin-top: var(--space-lg);
  font-size: var(--text-2xl);
}
.lead {
  margin: calc(var(--space-2xs) * -1) 0 var(--space-2xs);
  color: var(--color-muted);
  font-size: var(--text-sm);
}
.field {
  display: flex;
  flex-direction: column;
  gap: var(--space-2xs);
}
.field span {
  color: var(--color-ink-2);
  font-size: var(--text-sm);
  font-weight: 620;
}
.submit {
  width: 100%;
  margin-top: var(--space-2xs);
}
.err {
  margin: 0;
}
@media (max-width: 52rem) {
  .wrap {
    display: flex;
    flex-direction: column;
  }
  .corner {
    top: var(--space-md);
    right: var(--space-md);
  }
  .login-story {
    min-height: 12rem;
    padding: var(--space-md);
  }
  .story-copy {
    display: none;
  }
  .login {
    width: 100%;
  }
}
@media (max-width: 26rem) {
  .wrap {
    padding: var(--space-2xs);
  }
  .corner {
    position: absolute;
    top: var(--space-sm);
    right: var(--space-sm);
  }
  .login-story {
    min-height: 10rem;
  }
  .login {
    padding: var(--space-md);
  }
}
</style>

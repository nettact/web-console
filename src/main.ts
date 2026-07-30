import { createApp } from 'vue'
import '@fontsource-variable/manrope'
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import App from './App.vue'
import router from './router'
import { i18n } from './i18n'
import './theme'
import './style.css'

createApp(App).use(router).use(i18n).mount('#app')

import './assets/main.css'
import './config/projections.js'
import 'primeicons/primeicons.css'

import { createApp } from 'vue'
import PrimeVue from 'primevue/config'
import Aura from '@primevue/themes/aura'
import { definePreset } from '@primevue/themes'

const EO4FUSPreset = definePreset(Aura, {
  semantic: {
    primary: {
      50: '{blue.50}',
      100: '{blue.100}',
      200: '{blue.200}',
      300: '{blue.300}',
      400: '{blue.400}',
      500: '#144fb7',
      600: '#1245a3',
      700: '#0f3a8f',
      800: '#0d307a',
      900: '#0a2566',
      950: '#071a52',
    },
  },
})
import Tooltip from 'primevue/tooltip'
import App from './App.vue'
import router from './router'
import { setupVueQuery } from './plugins/vueQuery'
import i18n from './i18n/index.js'

const app = createApp(App)

app.use(router)
app.use(i18n)
app.use(PrimeVue, {
  theme: {
    preset: EO4FUSPreset,
    options: {
      darkModeSelector: false,
    },
  },
})
app.directive('tooltip', Tooltip)
setupVueQuery(app)

app.mount('#app')

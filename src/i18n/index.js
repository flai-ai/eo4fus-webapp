import { createI18n } from 'vue-i18n'
import sl from '@/locales/sl.json'
import en from '@/locales/en.json'

const LOCALE_KEY = 'eo4fus-locale'
const savedLocale = localStorage.getItem(LOCALE_KEY) ?? 'sl'

const i18n = createI18n({
  legacy: false,
  locale: savedLocale,
  fallbackLocale: 'sl',
  messages: { sl, en },
  pluralRules: {
    sl: (choice) => {
      if (choice % 100 >= 11 && choice % 100 <= 14) return 3
      switch (choice % 10) {
        case 1: return 0
        case 2: return 1
        case 3:
        case 4: return 2
        default: return 3
      }
    },
  },
})

export default i18n

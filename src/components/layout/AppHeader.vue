<script setup>
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'

const { t, locale } = useI18n()
const base = import.meta.env.BASE_URL
const aboutVisible = ref(false)

function setLocale(lang) {
  locale.value = lang
  localStorage.setItem('eo4fus-locale', lang)
}
</script>

<template>
  <header class="app-header">
    <div class="app-header__brand">
      <h1 class="app-header__title">EO4FUS</h1>
      <span class="app-header__subtitle">Earth observation data fusion for forest mapping</span>
    </div>

    <div class="app-header__actions">
      <div class="lang-toggle">
        <button
          class="lang-btn"
          :class="{ 'lang-btn--active': locale === 'sl' }"
          @click="setLocale('sl')"
        >SI</button>
        <span class="lang-divider">|</span>
        <button
          class="lang-btn"
          :class="{ 'lang-btn--active': locale === 'en' }"
          @click="setLocale('en')"
        >EN</button>
      </div>
      <Button
        icon="pi pi-info-circle"
        text
        rounded
        severity="secondary"
        class="app-header__info-btn"
        :aria-label="t('header.aboutTooltip')"
        v-tooltip.bottom="t('header.aboutTooltip')"
        @click="aboutVisible = true"
      />
    </div>

    <Dialog
      v-model:visible="aboutVisible"
      modal
      :header="t('header.aboutTitle')"
      :style="{ width: '560px' }"
    >
      <p class="about-description">{{ t('header.aboutDescription') }}</p>

      <div class="about-partners">
        <h3 class="about-partners__title">{{ t('header.partnersTitle') }}</h3>
        <div class="about-partners__grid">
          <div class="about-logo-card">
            <img :src="base + 'logos/flai-logo.svg'" alt="FLAI" class="about-logo" />
          </div>
          <div class="about-logo-card">
            <img :src="base + 'logos/esa-logo.svg'" alt="ESA" class="about-logo" />
          </div>
          <div class="about-logo-card">
            <img :src="base + 'logos/zrc-sazu-logo.svg'" alt="ZRC SAZU" class="about-logo" />
          </div>
          <div class="about-logo-card">
            <img
              :src="base + 'logos/gozdis-logo.svg'"
              alt="Gozdarski inštitut Slovenije"
              class="about-logo"
            />
          </div>
        </div>
      </div>
    </Dialog>
  </header>
</template>

<style scoped>
.app-header {
  display: flex;
  align-items: center;
  justify-content: center;
  height: var(--header-height);
  padding: 0 0.75rem;
  background: var(--color-header-bg);
  color: var(--color-header-text);
  border-bottom: 1px solid var(--color-border);
  position: relative;
}

.app-header__brand {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
}

.app-header__logo {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  background: var(--color-accent);
  color: #fff;
  border-radius: 4px;
  font-weight: 700;
  font-size: 0.75rem;
}

.app-header__title {
  font-size: 1.1rem;
  font-weight: 700;
  letter-spacing: 0.5px;
}

.app-header__subtitle {
  font-size: 0.8rem;
  opacity: 0.7;
  line-height: 1.2;
}

.app-header__actions {
  position: absolute;
  right: 0.75rem;
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.lang-toggle {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.05em;
}

.lang-btn {
  background: none;
  border: none;
  padding: 2px 4px;
  cursor: pointer;
  color: var(--color-header-text);
  opacity: 0.5;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.05em;
  line-height: 1;
}

.lang-btn:hover {
  opacity: 0.8;
}

.lang-btn--active {
  opacity: 1;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.lang-divider {
  color: var(--color-header-text);
  opacity: 0.3;
  font-size: 0.7rem;
}

.app-header__info-btn {
  color: var(--color-header-text) !important;
  opacity: 0.7;
}

.app-header__info-btn:hover {
  opacity: 1;
}

/* Dialog content */
.about-description {
  font-size: 0.9rem;
  line-height: 1.6;
  color: var(--color-text);
  margin-bottom: 1.5rem;
  text-align: justify;
}

.about-partners__title {
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--color-text-muted);
  margin-bottom: 0.75rem;
}

.about-partners__grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
}

.about-logo-card {
  display: flex;
  align-items: center;
  justify-content: center;
  background: #fff;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 1rem 1.5rem;
}

.about-logo {
  max-height: 48px;
  width: auto;
  max-width: 100%;
  object-fit: contain;
}
</style>

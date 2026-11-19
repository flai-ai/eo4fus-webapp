<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import Slider from 'primevue/slider'
import { useLayerVisibility } from '@/composables/useLayerVisibility.js'
import { getRasterLayerConfigs, getLayerLabelKeyMap } from '@/config/layers.js'
import { classPalette, CONTINUOUS_RAMP } from '@/config/palette.js'
import { useClassLabels } from '@/composables/useClassLabels.js'

const { t, locale } = useI18n()
const { labelsFor } = useClassLabels()
const { visibility, rasterOpacity } = useLayerVisibility()
const RASTER_CONFIGS = getRasterLayerConfigs()
const layerLabelKeys = getLayerLabelKeyMap()

const numberLocale = computed(() => (locale.value === 'sl' ? 'sl-SI' : 'en-GB'))

/** The visible raster layer (rasters are mutually exclusive) */
const layer = computed(() => RASTER_CONFIGS.find((c) => visibility[c.id]) ?? null)

const title = computed(() => {
  const key = layerLabelKeys.get(layer.value?.id)
  return key ? t(key) : null
})

/** Class names and palette colours of the visible classified raster, in class order */
const speciesRows = computed(() => {
  const config = layer.value
  if (config?.valueType !== 'classified') return null
  const palette = classPalette(config.classSet)
  return labelsFor(config.classSet).map((name, cls) => ({ name, color: palette[cls] }))
})

/** Opacity slider minimum, so an enabled raster cannot become invisible */
const MIN_OPACITY_PERCENT = 20

/** The slider works in whole percent, the layer in a 0–1 fraction */
const opacityPercent = computed({
  get: () => Math.round(rasterOpacity.value * 100),
  set: (percent) => {
    rasterOpacity.value = percent / 100
  },
})

const ramp = computed(() => {
  const config = layer.value
  if (config?.valueType !== 'continuous') return null
  const stops = CONTINUOUS_RAMP.map(([at, color]) => `${color} ${at * 100}%`).join(', ')
  const format = (value) => value.toLocaleString(numberLocale.value)
  return {
    gradient: `linear-gradient(to right, ${stops})`,
    min: format(config.rampMin),
    // Values above rampMax are drawn in the top colour
    max: `${format(config.rampMax)}+`,
    unit: t(config.unitKey),
  }
})
</script>

<template>
  <div
    v-if="speciesRows || ramp"
    class="map-legend"
  >
    <span class="map-legend__title">{{ title }}</span>

    <ul
      v-if="speciesRows"
      class="map-legend__species"
    >
      <li
        v-for="row in speciesRows"
        :key="row.name"
      >
        <span
          class="map-legend__swatch"
          :style="{ background: row.color }"
        />
        {{ row.name }}
      </li>
    </ul>

    <template v-if="ramp">
      <div
        class="map-legend__ramp"
        :style="{ background: ramp.gradient }"
      />
      <div class="map-legend__scale">
        <span>{{ ramp.min }}</span>
        <span>{{ ramp.unit }}</span>
        <span>{{ ramp.max }}</span>
      </div>
    </template>

    <!-- The legend lets pointer events through; this row stops them reaching the
         map so dragging the slider does not select a feature underneath. -->
    <div
      class="map-legend__opacity"
      @pointerdown.stop
      @click.stop
      @dblclick.stop
    >
      <div class="map-legend__opacity-head">
        <span>{{ t('legend.opacity') }}</span>
        <span class="map-legend__opacity-value">{{ opacityPercent }} %</span>
      </div>
      <Slider
        v-model="opacityPercent"
        :aria-label="t('legend.opacity')"
        :min="MIN_OPACITY_PERCENT"
        :max="100"
        class="map-legend__opacity-slider"
      />
    </div>
  </div>
</template>

<style scoped>
.map-legend {
  position: absolute;
  right: 12px;
  bottom: 12px;
  z-index: 5;
  background: var(--color-panel-bg);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  padding: 8px 10px;
  font-size: 0.78rem;
  color: var(--color-text);
  box-shadow: 0 1px 4px rgb(0 0 0 / 0.15);
  max-width: 210px;
  pointer-events: none;
}

.map-legend__title {
  display: block;
  font-weight: 600;
  margin-bottom: 6px;
}

.map-legend__species {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.map-legend__species li {
  display: flex;
  align-items: center;
  gap: 6px;
}

.map-legend__swatch {
  width: 12px;
  height: 12px;
  border-radius: 2px;
  flex-shrink: 0;
  /* A hairline keeps the pale yellow from vanishing against the panel */
  border: 1px solid rgb(0 0 0 / 0.25);
}

.map-legend__ramp {
  width: 100%;
  height: 10px;
  border-radius: 2px;
  border: 1px solid rgb(0 0 0 / 0.25);
}

.map-legend__scale {
  display: flex;
  justify-content: space-between;
  gap: 6px;
  margin-top: 3px;
  color: var(--color-text-muted);
}

/* The only part of the legend that takes pointer events */
.map-legend__opacity {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--color-border);
  pointer-events: auto;
}

.map-legend__opacity-head {
  display: flex;
  justify-content: space-between;
  gap: 6px;
  color: var(--color-text-muted);
}

/* Room for the 20px handle, which overhangs each end of the track by 10px */
.map-legend__opacity-slider {
  margin: 2px 10px 0;
}

.map-legend__opacity-value {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
</style>

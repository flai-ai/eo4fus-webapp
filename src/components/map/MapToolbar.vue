<script setup>
import { watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Button from 'primevue/button'
import { useMap } from '@/composables/useMap.js'
import { useDrawInteraction } from '@/composables/useDrawInteraction.js'
import { useMeasureInteraction } from '@/composables/useMeasureInteraction.js'
import { usePointCloud } from '@/composables/usePointCloud.js'
import { fromLonLat } from 'ol/proj'

const { t } = useI18n()
const { map } = useMap()
const { isDrawActive, toggleDraw, clearDraw, deactivateDraw } = useDrawInteraction()
const { activeMeasureTool, toggleMeasure, clearMeasure, deactivateMeasure } = useMeasureInteraction()
const { isWindowOpen: isPointCloudWindowOpen } = usePointCloud()

// Deactivate map tools while the point cloud window covers the map
watch(isPointCloudWindowOpen, (open) => {
  if (!open) return
  deactivateDraw()
  deactivateMeasure()
})

const SLOVENIA_CENTER = fromLonLat([14.9955, 46.1512])
const SLOVENIA_ZOOM = 9

function zoomHome() {
  map.value?.getView().animate({ center: SLOVENIA_CENTER, zoom: SLOVENIA_ZOOM, duration: 500 })
}

function handleToggleDraw() {
  deactivateMeasure()
  clearMeasure()
  toggleDraw()
}

function handleToggleMeasure(type) {
  deactivateDraw()
  toggleMeasure(type)
}

function handleClear() {
  deactivateDraw()
  deactivateMeasure()
  clearDraw()
  clearMeasure()
}
</script>

<template>
  <div class="map-toolbar">
    <Button
      v-tooltip.bottom="t('toolbar.home')"
      icon="pi pi-home"
      text
      rounded
      size="small"
      @click="zoomHome"
    />
    <div class="map-toolbar__separator" />
    <Button
      v-tooltip.bottom="t('toolbar.drawPolygon')"
      icon="pi pi-pencil"
      :disabled="isPointCloudWindowOpen"
      :text="!isDrawActive"
      rounded
      size="small"
      @click="handleToggleDraw"
    />
    <Button
      v-tooltip.bottom="t('toolbar.measureDistance')"
      icon="pi pi-arrows-h"
      :disabled="isPointCloudWindowOpen"
      :text="activeMeasureTool !== 'distance'"
      rounded
      size="small"
      @click="handleToggleMeasure('distance')"
    />
    <Button
      v-tooltip.bottom="t('toolbar.measureArea')"
      icon="pi pi-stop"
      :disabled="isPointCloudWindowOpen"
      :text="activeMeasureTool !== 'area'"
      rounded
      size="small"
      @click="handleToggleMeasure('area')"
    />
    <div class="map-toolbar__separator" />
    <Button
      v-tooltip.bottom="t('toolbar.clear')"
      icon="pi pi-trash"
      :disabled="isPointCloudWindowOpen"
      text
      rounded
      size="small"
      @click="handleClear"
    />
  </div>
</template>

<style scoped>
.map-toolbar {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.25rem 0.5rem;
  background: var(--color-toolbar-bg);
  border-bottom: 1px solid var(--color-border);
}

.map-toolbar__separator {
  width: 1px;
  height: 1.25rem;
  background: var(--color-border);
  margin: 0 0.125rem;
}
</style>

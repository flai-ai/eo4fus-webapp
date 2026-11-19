<script setup>
import { useMouseCoordinates } from '@/composables/useMouseCoordinates.js'
import { useMapScale } from '@/composables/useMapScale.js'

const { coordinates } = useMouseCoordinates()
const { scale } = useMapScale()

function formatCoord(val, decimals = 5) {
  return val != null ? val.toFixed(decimals) : '—'
}

function formatScale(val) {
  if (val == null) return '—'
  return `1:${val.toLocaleString('sl-SI')}`
}
</script>

<template>
  <div class="map-status-bar">
    <span class="map-status-bar__scale">{{ formatScale(scale) }}</span>
    <span class="map-status-bar__separator">|</span>
    <span class="map-status-bar__coords">
      {{ formatCoord(coordinates?.lon) }}° E,
      {{ formatCoord(coordinates?.lat) }}° N
    </span>
  </div>
</template>

<style scoped>
.map-status-bar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.25rem 0.75rem;
  background: var(--color-statusbar-bg);
  border-top: 1px solid var(--color-border);
  font-size: 0.8rem;
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
}

.map-status-bar__separator {
  opacity: 0.3;
}
</style>

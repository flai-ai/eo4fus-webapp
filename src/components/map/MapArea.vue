<script setup>
import MapToolbar from './MapToolbar.vue'
import MapContainer from '../MapContainer.vue'
import MapStatusBar from './MapStatusBar.vue'
import PointCloudWindow from './PointCloudWindow.vue'
import { usePointCloud } from '@/composables/usePointCloud.js'

const { isWindowOpen } = usePointCloud()
</script>

<template>
  <div class="map-area">
    <MapToolbar class="map-area__toolbar" />
    <!-- Bounds the floating point cloud window; the map stays mounted underneath -->
    <div class="map-area__stage">
      <MapContainer class="map-area__map" />
      <PointCloudWindow v-if="isWindowOpen" />
    </div>
    <MapStatusBar class="map-area__status" />
  </div>
</template>

<style scoped>
.map-area {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.map-area__toolbar {
  flex-shrink: 0;
}

.map-area__stage {
  position: relative;
  flex: 1;
  min-height: 0;
}

.map-area__map {
  width: 100%;
  height: 100%;
}

.map-area__status {
  flex-shrink: 0;
}
</style>

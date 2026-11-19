<script setup>
import AppHeader from './AppHeader.vue'
import LayerPanel from '../panels/LayerPanel.vue'
import MapArea from '../map/MapArea.vue'
import ResultsPanel from '../panels/ResultsPanel.vue'
import { useResultsPanel } from '@/composables/useResultsPanel.js'
import { usePointCloud } from '@/composables/usePointCloud.js'

const { isOpen: resultsOpen } = useResultsPanel()
const { isPreviewOpen: pointCloudOpen } = usePointCloud()
</script>

<template>
  <div
    class="app-layout"
    :class="{
      'app-layout--results-open': resultsOpen,
      'app-layout--pointcloud-open': pointCloudOpen,
    }"
  >
    <AppHeader class="app-layout__header" />
    <LayerPanel class="app-layout__layers" />
    <MapArea class="app-layout__map" />
    <ResultsPanel v-if="resultsOpen" class="app-layout__results" />
  </div>
</template>

<style scoped>
.app-layout {
  display: grid;
  grid-template-columns: var(--panel-width-left) 1fr;
  grid-template-rows: var(--header-height) 1fr;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
  transition: grid-template-columns 0.18s ease;
}

.app-layout--results-open {
  grid-template-columns: var(--panel-width-left) 1fr var(--panel-width-right);
}

/* Wider results panel while the point cloud viewer is open */
.app-layout--results-open.app-layout--pointcloud-open {
  grid-template-columns: var(--panel-width-left) 1fr var(--panel-width-right-wide);
}

.app-layout__header {
  grid-column: 1 / -1;
}

.app-layout__layers {
  grid-row: 2;
  grid-column: 1;
  overflow-y: auto;
}

.app-layout__map {
  grid-row: 2;
  grid-column: 2;
  min-width: 0;
  min-height: 0;
}

.app-layout__results {
  grid-row: 2;
  grid-column: 3;
  overflow-y: auto;
}
</style>

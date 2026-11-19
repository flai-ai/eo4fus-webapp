<script setup>
import { ref, watch, onMounted, onUnmounted } from 'vue'
import { useResizeObserver } from '@vueuse/core'
import Map from 'ol/Map'
import View from 'ol/View'
import TileLayer from 'ol/layer/Tile'
import OSM from 'ol/source/OSM'
import TileWMS from 'ol/source/TileWMS'
import Overlay from 'ol/Overlay'
import { fromLonLat } from 'ol/proj'
import { useMap } from '@/composables/useMap.js'
import { useVectorTileLayers } from '@/composables/useVectorTileLayers.js'
import { useFeatureInteraction } from '@/composables/useFeatureInteraction.js'
import { useFeaturePopup } from '@/composables/useFeaturePopup.js'
import { useDrawInteraction } from '@/composables/useDrawInteraction.js'
import { useRasterLayers } from '@/composables/useRasterLayers.js'
import { useWmsOverlayLayers } from '@/composables/useWmsOverlayLayers.js'
import { useResultsOverlay } from '@/composables/useResultsOverlay.js'
import { useLayerVisibility } from '@/composables/useLayerVisibility.js'
import { useSelectionMarker } from '@/composables/useSelectionMarker.js'
import { layerGroups } from '@/config/layers.js'
import FeaturePopup from '@/components/map/FeaturePopup.vue'
import MapLegend from '@/components/map/MapLegend.vue'
import 'ol/ol.css'

const mapRef = ref(null)
const popupRef = ref(null)
const { map } = useMap()
const { activeBaseLayer } = useLayerVisibility()
const { isPopupOpen, popupCoordinate } = useFeaturePopup()
useVectorTileLayers()
useRasterLayers()
useWmsOverlayLayers()
useFeatureInteraction()
useSelectionMarker()
useDrawInteraction()
useResultsOverlay()

// Slovenia center
const SLOVENIA_CENTER = fromLonLat([14.9955, 46.1512])
const SLOVENIA_ZOOM = 9

/** WMS layer instances keyed by layer ID */
const wmsLayers = {}

let overlay = null

onMounted(() => {
  overlay = new Overlay({
    element: popupRef.value,
    positioning: 'bottom-center',
    stopEvent: true,
    autoPan: { animation: { duration: 250 } },
    offset: [0, -12],
  })

  // Build base layer OL instances from config
  const baseConfigs = layerGroups
    .flatMap((g) => g.layers)
    .filter((l) => l.base)

  for (const config of baseConfigs) {
    const source =
      config.type === 'wms'
        ? new TileWMS({
            url: config.wms.url,
            params: config.wms.params,
            serverType: config.wms.serverType,
            transition: 0,
          })
        : new OSM()

    wmsLayers[config.id] = new TileLayer({
      source,
      visible: config.id === activeBaseLayer.value,
      zIndex: 0,
    })
  }

  map.value = new Map({
    target: mapRef.value,
    controls: [],
    overlays: [overlay],
    layers: Object.values(wmsLayers),
    view: new View({
      center: SLOVENIA_CENTER,
      zoom: SLOVENIA_ZOOM,
    }),
  })
})

watch(activeBaseLayer, (activeId) => {
  for (const [id, layer] of Object.entries(wmsLayers)) {
    layer.setVisible(id === activeId)
  }
})

onUnmounted(() => {
  if (map.value) {
    map.value.setTarget(null)
    map.value = null
  }
})

watch([isPopupOpen, popupCoordinate], ([open, coordinate]) => {
  if (!overlay) return
  if (open && coordinate) {
    overlay.setPosition(coordinate)
  } else {
    overlay.setPosition(undefined)
  }
})

// Handle resize when layout changes (e.g. results panel opens/closes)
useResizeObserver(mapRef, () => {
  map.value?.updateSize()
})
</script>

<template>
  <div
    ref="mapRef"
    class="map-container"
  >
    <div ref="popupRef">
      <FeaturePopup v-if="isPopupOpen" />
    </div>
    <MapLegend />
  </div>
</template>

<style scoped>
.map-container {
  width: 100%;
  height: 100%;
  /* Positioning context for the legend */
  position: relative;
}
</style>

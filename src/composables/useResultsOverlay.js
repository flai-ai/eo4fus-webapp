import { watch, computed } from 'vue'
import Feature from 'ol/Feature'
import VectorLayer from 'ol/layer/Vector'
import VectorSource from 'ol/source/Vector'
import GeoJSON from 'ol/format/GeoJSON'
import { Style, Fill, Stroke, Circle as CircleStyle } from 'ol/style'
import { useMap } from './useMap.js'
import { useResultsPanel } from './useResultsPanel.js'

const format = new GeoJSON()

const POINT_STYLE = new Style({
  image: new CircleStyle({
    radius: 7,
    fill: new Fill({ color: 'rgba(255, 60, 60, 0.3)' }),
    stroke: new Stroke({ color: 'rgba(255, 60, 60, 0.9)', width: 2.5 }),
  }),
})

const AREA_STYLE = new Style({
  fill: new Fill({ color: 'rgba(255, 60, 60, 0.12)' }),
  stroke: new Stroke({ color: 'rgba(255, 60, 60, 0.85)', width: 2.5 }),
})

/** Dashed blue outline of the drawn area, shown around the sampled cells */
const REQUESTED_AREA_STYLE = new Style({
  stroke: new Stroke({ color: 'rgba(51, 136, 255, 0.8)', width: 1.5, lineDash: [6, 4] }),
})

function tabStyle(geometryType) {
  if (geometryType === 'Point' || geometryType === 'MultiPoint') return POINT_STYLE
  return AREA_STYLE
}

let overlaySource = null
let overlayLayer = null

function ensureLayer(olMap) {
  if (overlayLayer) return
  overlaySource = new VectorSource()
  overlayLayer = new VectorLayer({
    source: overlaySource,
    zIndex: 90,
  })
  olMap.addLayer(overlayLayer)
}

export function useResultsOverlay() {
  const { map } = useMap()
  const { tabs, activeTabId, isOpen } = useResultsPanel()

  const activeTab = computed(() => tabs.value.find((t) => t.id === activeTabId.value) ?? null)

  watch(
    [map, activeTab, isOpen],
    ([olMap, tab, open]) => {
      if (!olMap) return
      ensureLayer(olMap)

      overlaySource.clear()
      if (!open || !tab?.geometry) return

      function add(geojson, style) {
        const geometry = format.readGeometry(geojson, {
          dataProjection: 'EPSG:3857',
          featureProjection: 'EPSG:3857',
        })
        const feature = new Feature({ geometry })
        feature.setStyle(style)
        overlaySource.addFeature(feature)
      }

      // When sampled cells exist, draw both the drawn area and the cells inside it
      if (tab.pixelGeometry) {
        add(tab.geometry, REQUESTED_AREA_STYLE)
        add(tab.pixelGeometry, AREA_STYLE)
        return
      }

      add(tab.geometry, tabStyle(tab.geometryType))
    },
    { immediate: true },
  )
}

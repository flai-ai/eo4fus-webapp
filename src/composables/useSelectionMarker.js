import { watch } from 'vue'
import VectorLayer from 'ol/layer/Vector'
import VectorSource from 'ol/source/Vector'
import GeoJSON from 'ol/format/GeoJSON'
import { Style, Circle, Fill, Stroke } from 'ol/style'
import { useMap } from './useMap.js'
import { selectedFeatureGeometry } from './useFeatureInteraction.js'

/**
 * Draws the selected feature on its own layer. Feature IDs cannot be compared in the
 * WebGL style, since it stores them as float32 and tree-top IDs exceed 2^24.
 */
const RED = 'rgba(255, 60, 60'

const style = new Style({
  image: new Circle({
    radius: 6,
    fill: new Fill({ color: `${RED}, 0.7)` }),
    stroke: new Stroke({ color: `${RED}, 0.9)`, width: 1 }),
  }),
  fill: new Fill({ color: `${RED}, 0.25)` }),
  stroke: new Stroke({ color: `${RED}, 0.9)`, width: 3 }),
})

const format = new GeoJSON()

export function useSelectionMarker() {
  const { map } = useMap()

  let source = null

  function ensureLayer(olMap) {
    if (source) return
    source = new VectorSource()
    olMap.addLayer(
      new VectorLayer({
        source,
        style,
        // Above the vector tiles (zIndex 10)
        zIndex: 20,
        // Lets clicks pass through to the features underneath
        properties: { selectionMarker: true },
      }),
    )
  }

  watch(
    map,
    (olMap) => {
      if (olMap) ensureLayer(olMap)
    },
    { immediate: true },
  )

  watch(selectedFeatureGeometry, (geometry) => {
    if (!source) return
    source.clear()
    if (!geometry) return
    source.addFeature(format.readFeature(geometry))
  })
}

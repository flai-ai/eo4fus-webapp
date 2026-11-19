import { watch } from 'vue'
import VectorLayer from 'ol/layer/Vector'
import VectorSource from 'ol/source/Vector'
import GeoJSON from 'ol/format/GeoJSON'
import { bbox as bboxStrategy } from 'ol/loadingstrategy'
import { Style, Fill, Stroke } from 'ol/style'
import { useMap } from './useMap.js'
import { useLayerVisibility } from './useLayerVisibility.js'
import { getWfsLayerConfigs } from '@/config/layers.js'

const WFS_CONFIGS = getWfsLayerConfigs()

/** Plain object, since OL layer instances don't need Vue reactivity */
export const activeWfsLayers = {}

function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [50, 120, 200]
}

function makeStyle(color) {
  const [r, g, b] = hexToRgb(color)
  return new Style({
    fill: new Fill({ color: `rgba(${r}, ${g}, ${b}, 0.15)` }),
    stroke: new Stroke({ color: `rgba(${r}, ${g}, ${b}, 0.7)`, width: 1.5 }),
  })
}

export function useWfsLayers() {
  const { map } = useMap()
  const { visibility } = useLayerVisibility()

  function addLayer(config, initiallyVisible) {
    const { id, color, wfs } = config
    if (activeWfsLayers[id]) return

    const source = new VectorSource({
      format: new GeoJSON(),
      url: (extent) =>
        `${wfs.url}?service=WFS&version=2.0.0&request=GetFeature` +
        `&typeName=${wfs.typeName}&outputFormat=application/json` +
        `&srsName=EPSG:3857&bbox=${extent.join(',')},EPSG:3857`,
      strategy: bboxStrategy,
    })

    const layer = new VectorLayer({
      source,
      style: makeStyle(color),
      // Use opacity instead of visible so forEachFeatureAtPixel still works when hidden
      opacity: initiallyVisible ? 1 : 0,
      properties: { layerId: id, layerType: 'wfs' },
      zIndex: 10,
    })

    map.value.addLayer(layer)
    activeWfsLayers[id] = layer
  }

  function removeLayer(layerId) {
    const layer = activeWfsLayers[layerId]
    if (!layer) return

    map.value?.removeLayer(layer)
    layer.dispose()
    delete activeWfsLayers[layerId]
  }

  watch(
    map,
    (newMap) => {
      if (!newMap) return

      for (const config of WFS_CONFIGS) {
        if (config.alwaysOn) {
          // Always load so forEachFeatureAtPixel works regardless of visibility
          addLayer(config, visibility[config.id])
          watch(
            () => visibility[config.id],
            (visible) => {
              const layer = activeWfsLayers[config.id]
              if (layer) layer.setOpacity(visible ? 1 : 0)
            },
          )
        } else {
          // Load only when visible to avoid unneeded WFS requests
          watch(
            () => visibility[config.id],
            (visible) => {
              if (visible) {
                addLayer(config, true)
              } else {
                removeLayer(config.id)
              }
            },
            { immediate: true },
          )
        }
      }
    },
    { immediate: true },
  )

  return { activeWfsLayers }
}

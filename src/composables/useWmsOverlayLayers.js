import { watch } from 'vue'
import TileLayer from 'ol/layer/Tile'
import TileWMS from 'ol/source/TileWMS'
import { useMap } from './useMap.js'
import { useLayerVisibility } from './useLayerVisibility.js'
import { layerGroups } from '@/config/layers.js'

/** Non-base WMS overlay layer configs */
const WMS_OVERLAY_CONFIGS = layerGroups
  .flatMap((g) => g.layers)
  .filter((l) => l.type === 'wms' && !l.base)

/** Plain object, since OL layer instances don't need Vue reactivity */
export const activeWmsOverlayLayers = {}

export function useWmsOverlayLayers() {
  const { map } = useMap()
  const { visibility } = useLayerVisibility()

  function addLayer(config) {
    const { id, wms } = config
    if (activeWmsOverlayLayers[id]) return

    const layer = new TileLayer({
      source: new TileWMS({
        url: wms.url,
        params: wms.params,
        serverType: wms.serverType,
        transition: 0,
      }),
      properties: { layerId: id, layerType: 'wms' },
      zIndex: 8,
    })

    map.value.addLayer(layer)
    activeWmsOverlayLayers[id] = layer
  }

  function removeLayer(layerId) {
    const layer = activeWmsOverlayLayers[layerId]
    if (!layer) return

    map.value?.removeLayer(layer)
    layer.dispose()
    delete activeWmsOverlayLayers[layerId]
  }

  watch(
    map,
    (newMap) => {
      if (!newMap) return

      for (const config of WMS_OVERLAY_CONFIGS) {
        watch(
          () => visibility[config.id],
          (visible) => {
            if (visible) {
              addLayer(config)
            } else {
              removeLayer(config.id)
            }
          },
          { immediate: true },
        )
      }
    },
    { immediate: true },
  )

  return { activeWmsOverlayLayers }
}

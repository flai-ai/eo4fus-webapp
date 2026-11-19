import { watch } from 'vue'
import VectorTileLayer from 'ol/layer/VectorTile'
import WebGLVectorTileLayer from 'ol/layer/WebGLVectorTile'
import VectorTileSource from 'ol/source/VectorTile'
import MVTFormat from 'ol/format/MVT'
import { useMap } from './useMap.js'
import { useLayerVisibility } from './useLayerVisibility.js'
import { useResultsPanel } from './useResultsPanel.js'
import { useFeaturePopup } from './useFeaturePopup.js'
import {
  selectedFeatureId,
  selectedLayerId,
  selectedFeatureGeometry,
} from './useFeatureInteraction.js'
import { layerGroups } from '@/config/layers.js'
import { createFlatStyle } from '@/config/vectorTileStyle.js'

const API_BASE = import.meta.env.VITE_API_BASE_URL

/** All vector-tile layer configs, computed once at module load */
const VECTOR_TILE_CONFIGS = layerGroups
  .flatMap((g) => g.layers)
  .filter((l) => l.type === 'vector-tile' && l.datasetId)

/** Plain object, since OL layer instances don't need Vue reactivity */
export const activeLayers = {}

/** Hit-only layers for alwaysQueryable configs (always on map, no renderLayer) */
const alwaysHitLayers = {}

export function useVectorTileLayers() {
  const { map } = useMap()
  const { visibility } = useLayerVisibility()
  const { close } = useResultsPanel()
  const { closePopup } = useFeaturePopup()

  function makeSource(datasetId) {
    return new VectorTileSource({
      format: new MVTFormat({ idProperty: 'id' }),
      url: `${API_BASE}/public/vectors/${datasetId}/tiles/{z}/{x}/{y}.pbf`,
      transition: 0,
      maxZoom: 22,
    })
  }

  /** Add an always-on invisible hit layer for alwaysQueryable configs */
  function ensureAlwaysHitLayer(layerConfig) {
    const { id, datasetId } = layerConfig
    if (alwaysHitLayers[id]) return

    const hitLayer = new VectorTileLayer({
      source: makeSource(datasetId),
      opacity: 0,
      properties: { layerId: id, hitLayer: true },
      zIndex: 10,
    })
    map.value.addLayer(hitLayer)
    alwaysHitLayers[id] = hitLayer
  }

  function addLayer(layerConfig) {
    const { id, datasetId } = layerConfig
    if (activeLayers[id]) return

    // alwaysQueryable layers already have a permanent hitLayer; reuse its source
    const source = alwaysHitLayers[id]
      ? alwaysHitLayers[id].getSource()
      : makeSource(datasetId)

    // WebGL render layer; hit detection is off (forEachFeatureAtPixel does not support it in OL 10)
    const renderLayer = new WebGLVectorTileLayer({
      source,
      style: createFlatStyle(layerConfig.color),
      disableHitDetection: true,
      properties: { layerId: id },
      zIndex: 10,
    })

    // Invisible canvas layer used solely for forEachFeatureAtPixel hit detection
    // (skipped for alwaysQueryable, which already has a permanent hitLayer)
    const hitLayer = alwaysHitLayers[id]
      ? null
      : new VectorTileLayer({
          source,
          opacity: 0,
          properties: { layerId: id, hitLayer: true },
          zIndex: 10,
        })

    map.value.addLayer(renderLayer)
    if (hitLayer) map.value.addLayer(hitLayer)
    activeLayers[id] = { renderLayer, hitLayer }
  }

  function removeLayer(layerId) {
    const entry = activeLayers[layerId]
    if (!entry) return

    if (entry.hitLayer) map.value.removeLayer(entry.hitLayer)
    map.value.removeLayer(entry.renderLayer)
    entry.renderLayer.dispose()
    delete activeLayers[layerId]

    if (selectedLayerId.value === layerId) {
      selectedFeatureId.value = null
      selectedLayerId.value = null
      selectedFeatureGeometry.value = null
      close()
    }
    closePopup()
  }

  watch(
    map,
    (newMap) => {
      if (!newMap) return

      // Always-on hit layers must be added before the visibility watchers run
      for (const config of VECTOR_TILE_CONFIGS) {
        if (config.alwaysQueryable) ensureAlwaysHitLayer(config)
      }

      for (const config of VECTOR_TILE_CONFIGS) {
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

  return { activeLayers }
}

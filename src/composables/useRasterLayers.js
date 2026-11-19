import { watch } from 'vue'
import WebGLTileLayer from 'ol/layer/WebGLTile'
import GeoTIFF from 'ol/source/GeoTIFF'
import { useMap } from './useMap.js'
import { useLayerVisibility } from './useLayerVisibility.js'
import { DatasetService } from '@/api/services/DatasetService.js'
import { layerGroups } from '@/config/layers.js'
import { CONTINUOUS_RAMP, classPalette, CLASS_FALLBACK } from '@/config/palette.js'

const RASTER_CONFIGS = layerGroups
  .flatMap((g) => g.layers)
  .filter((l) => l.type === 'raster' && l.datasetId)

/** Active raster layers by id (plain object, OL layers need no reactivity) */
export const activeRasterLayers = {}

/**
 * Style for a classified raster: one colour per class from its classSet palette.
 * Band 2 is the mask OL derives from the nodata value (0 = nodata, transparent).
 */
function classifiedStyle(config) {
  const palette = classPalette(config.classSet)
  return {
    color: [
      'case',
      ['==', ['band', 2], 0],
      [0, 0, 0, 0],
      // Rounded because overview levels can resample class values to non-integers.
      [
        'match',
        ['round', ['band', 1]],
        ...palette.flatMap((hex, cls) => [cls, hex]),
        CLASS_FALLBACK,
      ],
    ],
  }
}

/**
 * Style for a continuous raster: clamp to [rampMin, rampMax] and interpolate
 * through CONTINUOUS_RAMP.
 *
 * Transparency comes from the band 2 nodata mask because OL substitutes 0 for NaN nodata,
 * and 0 is a valid value.
 */
function continuousStyle({ rampMin, rampMax }) {
  const stops = CONTINUOUS_RAMP.flatMap(([fraction, color]) => [
    rampMin + fraction * (rampMax - rampMin),
    color,
  ])
  return {
    color: [
      'case',
      ['==', ['band', 2], 0],
      [0, 0, 0, 0],
      ['interpolate', ['linear'], ['clamp', ['band', 1], rampMin, rampMax], ...stops],
    ],
  }
}

export function useRasterLayers() {
  const { map } = useMap()
  const { visibility, rasterOpacity } = useLayerVisibility()

  /**
   * OL opacity for a raster: the user's setting when visible, 0 when hidden.
   * Hidden layers stay rendered at opacity 0 so getData() keeps working.
   */
  function layerOpacity(visible) {
    return visible ? rasterOpacity.value : 0
  }

  async function addLayer(config, initiallyVisible) {
    const { id, datasetId, numClasses, nodata } = config
    if (activeRasterLayers[id]) return

    const dataset = await DatasetService.getById(datasetId)
    if (!dataset?.rasters?.length) return

    // Guard against race condition if layer was added while fetch was in flight
    if (!map.value || activeRasterLayers[id]) return

    const isContinuous = config.valueType === 'continuous'

    const source = new GeoTIFF({
      sources: dataset.rasters.map((r) => ({
        url: r.presigned_url,
        nodata: nodata ?? undefined,
      })),
      // Keep raw band values (class codes, measurements) for the style expressions.
      normalize: false,
      // Nearest-neighbour sampling. Interpolation would blend class codes into other
      // classes and blend continuous values with nodata (0) along data edges.
      interpolate: false,
    })
    const style = isContinuous
      ? continuousStyle(config)
      : numClasses != null
        ? classifiedStyle(config)
        : undefined

    const layer = new WebGLTileLayer({
      source,
      style,
      // No per-tile fade-in, to avoid repeated re-renders on tile load.
      transition: 0,
      // Hidden via opacity so getData() keeps working (see layerOpacity()).
      opacity: layerOpacity(initiallyVisible),
      properties: {
        layerId: id,
        layerType: 'raster',
        // Layer config, for consumers that format values
        rasterConfig: config,
        rastersInfo: dataset.rasters.map(({ raster_file, resolution_x, resolution_y }) => ({
          raster_file,
          resolution_x,
          resolution_y,
        })),
        // Source GeoTIFF URL for direct reads (see useRasterPixelReader.js).
        rasterUrl: dataset.rasters[0].presigned_url,
      },
      zIndex: 5,
    })

    map.value.addLayer(layer)
    activeRasterLayers[id] = layer

    // Store the native pixel resolution and extent in map projection so pixel
    // geometry can be grid-snapped when displaying click results.
    source.getView().then((viewOptions) => {
      layer.set('rasterViewInfo', {
        extent: viewOptions.extent,
        resolution: viewOptions.resolutions[viewOptions.resolutions.length - 1],
      })
    })
  }

  watch(
    map,
    (newMap) => {
      if (!newMap) return

      for (const config of RASTER_CONFIGS) {
        // All raster layers are loaded so getData() works regardless of visibility.
        addLayer(config, visibility[config.id])

        watch([() => visibility[config.id], rasterOpacity], ([visible]) => {
          const layer = activeRasterLayers[config.id]
          if (layer) layer.setOpacity(layerOpacity(visible))
        })
      }
    },
    { immediate: true },
  )

  return { activeRasterLayers }
}

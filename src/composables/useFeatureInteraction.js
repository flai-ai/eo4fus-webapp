import { ref, watch } from 'vue'
import { useMap } from './useMap.js'
import { useFeaturePopup } from './useFeaturePopup.js'
import { activeRasterLayers } from './useRasterLayers.js'
import { canReadAtNativeResolution } from './useRasterSampling.js'
import { readPixelAt } from './useRasterPixelReader.js'
import { useLayerVisibility } from './useLayerVisibility.js'
import { getRasterLayerConfigs } from '@/config/layers.js'
import { queryWfsWithBbox } from './wfsQuery.js'

const RASTER_CONFIGS = getRasterLayerConfigs()
const { visibility } = useLayerVisibility()

/** Module-scope interaction state */
export const selectedFeatureId = ref(null)
export const selectedLayerId = ref(null)

/**
 * Geometry of the selected feature, in EPSG:3857, as a GeoJSON-shaped object.
 * The selection marker is drawn from this because WebGL styles store feature IDs as
 * float32, which cannot tell apart tree-top IDs above 2^24.
 */
export const selectedFeatureGeometry = ref(null)

/**
 * Convert RenderFeature flat coordinates into nested arrays matching GeoJSON structure.
 * RenderFeature (from MVT) exposes getFlatCoordinates/getEnds instead of getCoordinates.
 */
export function extractGeometry(feature) {
  const type = feature.getType()
  const flat = feature.getFlatCoordinates()
  const stride = feature.getStride?.() ?? 2
  const ends = feature.getEnds?.()

  if (!flat || flat.length === 0) return null

  function chunk(start, end) {
    const coords = []
    for (let i = start; i < end; i += stride) {
      coords.push([flat[i], flat[i + 1]])
    }
    return coords
  }

  if (type === 'Point') {
    return { type, coordinates: [flat[0], flat[1]] }
  }
  if (type === 'MultiPoint' || type === 'LineString') {
    return { type, coordinates: chunk(0, flat.length) }
  }
  if (type === 'MultiLineString' || type === 'Polygon') {
    const rings = []
    let offset = 0
    for (const end of ends ?? [flat.length]) {
      rings.push(chunk(offset, end))
      offset = end
    }
    return { type, coordinates: rings }
  }
  if (type === 'MultiPolygon') {
    const polygons = []
    let offset = 0
    for (const polyEnds of ends ?? []) {
      const rings = []
      for (const end of polyEnds) {
        rings.push(chunk(offset, end))
        offset = end
      }
      polygons.push(rings)
    }
    return { type, coordinates: polygons }
  }
  return null
}

/**
 * Read one pixel per raster from the source file, for layers the view is too coarse to
 * read from the canvas. pixelData mimics getData() as [value, mask]; readPixelAt returns
 * null for nodata, so the mask is always 1.
 */
async function readRastersFromSource(reads, coordinate) {
  if (reads.length === 0) return []
  const values = await Promise.all(
    reads.map(({ config, url }) => readPixelAt(url, coordinate, config.nodata)),
  )
  return reads
    .map(({ config, layer }, i) => ({ config, layer, value: values[i] }))
    .filter(({ value }) => value != null)
    .map(({ config, layer, value }) => ({
      type: 'raster',
      featureId: null,
      layerId: config.id,
      coordinate,
      pixelData: [value, 1],
      rastersInfo: layer.get('rastersInfo'),
      properties: {},
      geometryType: null,
      geometry: null,
    }))
}

function clickBbox(coordinate, resolution) {
  const tol = resolution * 10
  const [x, y] = coordinate
  return `${x - tol},${y - tol},${x + tol},${y + tol},EPSG:3857`
}

export function useFeatureInteraction() {
  const { map } = useMap()
  const { openPopup, closePopup, popupFeatures, isWfsLoading } = useFeaturePopup()

  let clickAbortController = null
  let clickGeneration = 0

  function getFeatureId(feature) {
    return feature.getId() ?? feature.getProperties().id ?? null
  }

  function isOverOverlay(evt) {
    return evt.originalEvent?.target?.closest('.ol-overlaycontainer-stopevent') != null
  }

  async function onClick(evt) {
    if (isOverOverlay(evt)) return

    // Cancel any in-flight WFS query from a previous click
    clickAbortController?.abort()
    clickAbortController = new AbortController()
    const generation = ++clickGeneration

    const olMap = map.value
    const seen = new Set()
    const features = []

    olMap.forEachFeatureAtPixel(evt.pixel, (feature, layer) => {
      const layerId = layer?.get('layerId')
      if (!layerId) return

      const featureId = getFeatureId(feature)
      const key = `${layerId}::${featureId}`
      if (seen.has(key)) return
      seen.add(key)

      const geom = feature.getGeometry()
      features.push({
        featureId,
        layerId,
        properties: feature.getProperties(),
        geometryType: geom?.getType() ?? null,
        geometry: geom ? extractGeometry(geom) : null,
      })
    })

    // A single tree hit is selected directly; with several hits nothing is selected
    const treeHits = features.filter((f) => f.layerId === 'tops')
    if (treeHits.length === 1) {
      selectedFeatureId.value = treeHits[0].featureId
      selectedLayerId.value = 'tops'
      selectedFeatureGeometry.value = treeHits[0].geometry
    } else if (selectedLayerId.value === 'tops') {
      selectedFeatureId.value = null
      selectedLayerId.value = null
      selectedFeatureGeometry.value = null
    }

    // Add a raster entry if there is pixel data at the clicked location (regardless of visibility).
    // Rasters too coarse to read from the canvas are read from source after the popup opens.
    const sourceReads = []
    const outlineCandidates = []
    for (const config of RASTER_CONFIGS) {
      const layer = activeRasterLayers[config.id]
      if (!layer) continue

      if (!canReadAtNativeResolution(olMap, layer)) {
        const url = layer.get('rasterUrl')
        if (url) sourceReads.push({ config, layer, url })
        continue
      }

      const pixelData = layer.getData(evt.pixel)
      // pixelData[1] is the mask band (0 = nodata). A NaN nodata value gives no usable
      // mask, so the value must also be finite.
      if (!pixelData || pixelData[1] === 0 || !Number.isFinite(pixelData[0])) continue
      features.push({
        type: 'raster',
        featureId: null,
        layerId: config.id,
        coordinate: evt.coordinate,
        pixelData,
        rastersInfo: layer.get('rastersInfo'),
        properties: {},
        geometryType: null,
        geometry: null,
      })
      const viewInfo = layer.get('rasterViewInfo')
      if (viewInfo) outlineCandidates.push({ id: config.id, viewInfo })
    }

    // Outline the pixel of the visible layer, since rasters can use different grids
    const outline =
      outlineCandidates.find(({ id }) => visibility[id]) ?? outlineCandidates[0] ?? null

    let pixelBbox = null
    let pixelTopCenter = null
    if (outline) {
      const { extent, resolution: rasterRes } = outline.viewInfo
      const [cx, cy] = evt.coordinate
      const col = Math.floor((cx - extent[0]) / rasterRes)
      const row = Math.floor((extent[3] - cy) / rasterRes)
      const minX = extent[0] + col * rasterRes
      const maxX = minX + rasterRes
      const maxY = extent[3] - row * rasterRes
      const minY = maxY - rasterRes
      pixelBbox = `${minX},${minY},${maxX},${maxY},EPSG:3857`
      // Anchor popup to top-center of pixel so it appears above the pixel
      pixelTopCenter = [(minX + maxX) / 2, maxY]
    }

    // Open popup immediately with synchronous results while WFS query is in flight
    openPopup(pixelTopCenter ?? evt.coordinate, features)
    isWfsLoading.value = true

    try {
      const resolution = olMap.getView().getResolution()
      const [wfsFeatures, rasterFeatures] = await Promise.all([
        queryWfsWithBbox(
          pixelBbox ?? clickBbox(evt.coordinate, resolution),
          evt.coordinate,
          clickAbortController.signal,
          10,
          evt.coordinate,
        ),
        readRastersFromSource(sourceReads, evt.coordinate),
      ])
      // Discard result if a newer click has already taken over
      if (generation !== clickGeneration) return
      isWfsLoading.value = false
      const allFeatures = [...popupFeatures.value, ...rasterFeatures, ...wfsFeatures]
      if (allFeatures.length > 0) {
        popupFeatures.value = allFeatures
      } else {
        closePopup()
        selectedFeatureId.value = null
        selectedLayerId.value = null
        selectedFeatureGeometry.value = null
      }
    } catch (err) {
      if (generation !== clickGeneration) return
      if (err.name === 'AbortError') return
      console.error('WFS query failed', err)
      isWfsLoading.value = false
      if (popupFeatures.value.length === 0) {
        closePopup()
        selectedFeatureId.value = null
        selectedLayerId.value = null
        selectedFeatureGeometry.value = null
      }
    }
  }

  watch(
    map,
    (newMap, oldMap) => {
      if (oldMap) {
        oldMap.un('click', onClick)
      }
      if (newMap) {
        newMap.on('click', onClick)
      }
    },
    { immediate: true },
  )

  return { selectedFeatureId, selectedLayerId, selectedFeatureGeometry }
}

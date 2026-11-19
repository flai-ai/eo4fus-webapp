import { ref } from 'vue'
import Draw from 'ol/interaction/Draw'
import VectorLayer from 'ol/layer/Vector'
import VectorTileLayer from 'ol/layer/VectorTile'
import VectorSource from 'ol/source/Vector'
import TileState from 'ol/TileState'
import { Style, Fill, Stroke } from 'ol/style'
import { intersects as extentsIntersect } from 'ol/extent'
import { getArea } from 'ol/sphere'
import { useMap } from './useMap.js'
import { useFeaturePopup } from './useFeaturePopup.js'
import { extractGeometry } from './useFeatureInteraction.js'
import { activeRasterLayers } from './useRasterLayers.js'
import { queryWfsWithBbox } from './wfsQuery.js'
import { getRasterLayerConfigs } from '@/config/layers.js'

const RASTER_CONFIGS = getRasterLayerConfigs()

/** Maximum drawn area before skipping WFS/raster queries (260 000 ha in m²). */
const MAX_DRAW_AREA_M2 = 260_000 * 10_000

/** Module-scope draw state */
export const isDrawActive = ref(false)

/** Drawn shape state, shared by all callers */
let drawAbortController = null
let drawGeneration = 0
let drawInteraction = null
let drawSource = null
let drawLayer = null

export function useDrawInteraction() {
  const { map } = useMap()
  const { openPopup, closePopup, popupFeatures, isWfsLoading, isAreaTooLarge } = useFeaturePopup()

  function ensureDrawLayer(olMap) {
    if (drawLayer) return
    drawSource = new VectorSource()
    drawLayer = new VectorLayer({
      source: drawSource,
      zIndex: 100,
      style: new Style({
        fill: new Fill({ color: 'rgba(51, 136, 255, 0.1)' }),
        stroke: new Stroke({ color: '#3388ff', width: 2 }),
      }),
    })
    olMap.addLayer(drawLayer)
  }

  function findFeaturesInPolygon(polygon) {
    const olMap = map.value
    const polygonExtent = polygon.getExtent()
    const processedSources = new Set()
    const all = []

    olMap.getLayers().forEach((layer) => {
      if (!(layer instanceof VectorTileLayer)) return
      const layerId = layer.get('layerId')
      if (!layerId) return

      // source.sourceTiles_ holds the actual loaded VectorTile objects
      // (source.getTile() returns VectorRenderTile wrappers without feature data)
      const source = layer.getSource()
      if (processedSources.has(source)) return
      processedSources.add(source)

      const sourceTiles = source.sourceTiles_
      if (!sourceTiles) return

      const tileGrid = source.getTileGrid()
      if (!tileGrid) return
      const targetZoom = tileGrid.getZForResolution(olMap.getView().getResolution(), 1)

      const seenIds = new Set()

      for (const sourceTile of Object.values(sourceTiles)) {
        if (sourceTile.tileCoord[0] !== targetZoom) continue
        if (sourceTile.getState() !== TileState.LOADED) continue
        if (sourceTile.extent && !extentsIntersect(sourceTile.extent, polygonExtent)) continue

        const tileFeatures = sourceTile.getFeatures()
        if (!tileFeatures) continue

        for (const feature of tileFeatures) {
          const flat = feature.getFlatCoordinates()
          if (!flat || flat.length < 2) continue

          const type = feature.getType()
          let inside = false
          if (type === 'Point') {
            inside = polygon.containsXY(flat[0], flat[1])
          } else if (type === 'MultiPoint') {
            for (let i = 0; i < flat.length - 1; i += 2) {
              if (polygon.containsXY(flat[i], flat[i + 1])) { inside = true; break }
            }
          } else {
            inside = polygon.containsXY(flat[0], flat[1])
          }

          if (!inside) continue

          const id = feature.getId()
          if (id !== undefined) {
            if (seenIds.has(id)) continue
            seenIds.add(id)
          }

          all.push({
            featureId: id ?? null,
            layerId,
            properties: feature.getProperties(),
            geometryType: type,
            geometry: extractGeometry(feature),
          })
        }
      }
    })

    return all
  }

  function onKeyDown(evt) {
    if (evt.key === 'Escape') deactivateDraw()
  }

  function deactivateDraw() {
    if (drawInteraction) {
      map.value?.removeInteraction(drawInteraction)
      drawInteraction = null
    }
    document.removeEventListener('keydown', onKeyDown)
    drawSource?.clear()
    isDrawActive.value = false
  }

  async function onDrawEnd(evt) {
    const polygon = evt.feature.getGeometry()
    map.value.removeInteraction(drawInteraction)
    drawInteraction = null
    document.removeEventListener('keydown', onKeyDown)
    isDrawActive.value = false

    drawAbortController?.abort()
    drawAbortController = new AbortController()
    const generation = ++drawGeneration

    const features = findFeaturesInPolygon(polygon)
    const area = getArea(polygon)
    const polygonExtent = polygon.getExtent()
    const center = [(polygonExtent[0] + polygonExtent[2]) / 2, polygonExtent[3]]

    if (area > MAX_DRAW_AREA_M2) {
      openPopup(center, features, area)
      isAreaTooLarge.value = true
      return
    }

    const rasterEntries = RASTER_CONFIGS
      .filter((c) => activeRasterLayers[c.id])
      .map((c) => ({
        type: 'raster',
        layerId: c.id,
        coordinate: center,
        pixelData: null,
        rastersInfo: activeRasterLayers[c.id].get('rastersInfo'),
        polygonGeometry: polygon,
        properties: {},
        featureId: null,
        geometryType: null,
        geometry: null,
      }))

    openPopup(center, [...features, ...rasterEntries], area)
    isWfsLoading.value = true

    try {
      const bbox = `${polygonExtent.join(',')},EPSG:3857`
      const wfsFeatures = await queryWfsWithBbox(bbox, center, drawAbortController.signal, null, polygon.getCoordinates()[0])
      if (generation !== drawGeneration) return
      isWfsLoading.value = false
      const allFeatures = [...popupFeatures.value, ...wfsFeatures]
      if (allFeatures.length > 0) {
        popupFeatures.value = allFeatures
      } else {
        drawSource?.clear()
        closePopup()
      }
    } catch (err) {
      if (generation !== drawGeneration) return
      if (err.name === 'AbortError') return
      console.error('WFS query failed', err)
      isWfsLoading.value = false
      if (popupFeatures.value.length === 0) {
        drawSource?.clear()
        closePopup()
      }
    }
  }

  function activateDraw() {
    const olMap = map.value
    if (!olMap) return

    ensureDrawLayer(olMap)
    drawSource.clear()
    closePopup()

    drawInteraction = new Draw({
      source: drawSource,
      type: 'Polygon',
      stopClick: true,
    })

    drawInteraction.on('drawend', onDrawEnd)
    olMap.addInteraction(drawInteraction)
    document.addEventListener('keydown', onKeyDown)
    isDrawActive.value = true
  }

  function toggleDraw() {
    if (isDrawActive.value) {
      deactivateDraw()
    } else {
      activateDraw()
    }
  }

  function clearDraw() {
    drawSource?.clear()
    closePopup()
  }

  /** Remove the drawn shape without closing the popup (used once results are shown) */
  function clearDrawnShape() {
    drawSource?.clear()
  }

  return { isDrawActive, toggleDraw, clearDraw, clearDrawnShape, deactivateDraw }
}

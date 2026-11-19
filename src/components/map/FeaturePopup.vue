<script setup>
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useFeaturePopup } from '@/composables/useFeaturePopup.js'
import { useValueFormat } from '@/composables/useValueFormat.js'
import { classPalette, CLASS_FALLBACK } from '@/config/palette.js'
import { useResultsPanel } from '@/composables/useResultsPanel.js'
import { selectedFeatureId, selectedLayerId, selectedFeatureGeometry } from '@/composables/useFeatureInteraction.js'
import { getLayerLabelKeyMap, getLayerColorMap, getPopupIgnoredLayerIds, getRasterLayerConfigs, relativeErrorPct } from '@/config/layers.js'
import { useMap } from '@/composables/useMap.js'
import { useLayerVisibility } from '@/composables/useLayerVisibility.js'
import { useDrawInteraction } from '@/composables/useDrawInteraction.js'
import { activeRasterLayers } from '@/composables/useRasterLayers.js'
import { sampleRasterPolygon, traceCoveredBoundary } from '@/composables/useRasterSampling.js'
import { collectTreesInPolygon, measureTreesInPolygon } from '@/composables/useTreeCount.js'
import { toLonLat, transform } from 'ol/proj'
import { getCenter } from 'ol/extent'
import Polygon from 'ol/geom/Polygon'

const { t } = useI18n()
const { popupFeatures, popupArea, isWfsLoading, isAreaTooLarge, closePopup } = useFeaturePopup()
const { open } = useResultsPanel()
const { map } = useMap()
const { visibility } = useLayerVisibility()
const { clearDrawnShape } = useDrawInteraction()
const layerLabelKeys = getLayerLabelKeyMap()
const layerColors = getLayerColorMap()
const ignoredLayerIds = getPopupIgnoredLayerIds()
const RASTER_CONFIGS = getRasterLayerConfigs()

const { numberLocale } = useValueFormat()

const CONTEXT_LAYER_IDS = new Set(['ggo', 'gge', 'odseki-gozdni'])

/**
 * Layers whose sampled cells define the tree-counting region, in order of preference.
 * Tree species is the only raster that covers the whole country.
 */
const TREE_GRID_LAYER_IDS = ['tree-type']

const rasterFeatures = computed(() => popupFeatures.value.filter((f) => f.type === 'raster'))

/**
 * True for a drawn area or a compartment, false for a single-point click.
 * Tree counts for areas are left to the results panel, since the loaded tiles may be incomplete.
 */
const isAreaSelection = computed(() => rasterFeatures.value.some((f) => f.polygonGeometry))

const mainFeatures = computed(() =>
  popupFeatures.value.filter(
    (f) =>
      f.type !== 'raster' &&
      !CONTEXT_LAYER_IDS.has(f.layerId) &&
      !ignoredLayerIds.has(f.layerId),
  ),
)

function formatArea(m2) {
  const ha = m2 / 10_000
  return `${Math.round(m2).toLocaleString(numberLocale.value)} m² (${ha.toLocaleString(numberLocale.value, { maximumFractionDigits: 2 })} ha)`
}
const featureCount = computed(() => {
  const clusterGroupCount = groupedFeatures.value.filter((g) => g.isCluster).length
  const individualCount = mainFeatures.value.filter((f) => (f.properties.cluster_count ?? 1) <= 1).length
  return individualCount + clusterGroupCount
})

function uniqueNames(features, prop) {
  return [...new Set(features.map((f) => f.properties[prop]).filter(Boolean))].join(', ')
}

const ggoNames = computed(() => uniqueNames(popupFeatures.value.filter((f) => f.layerId === 'ggo'), 'ggo_naziv'))
const ggeNames = computed(() => uniqueNames(popupFeatures.value.filter((f) => f.layerId === 'gge'), 'gge_naziv'))
const odsekFeatures = computed(() => popupFeatures.value.filter((f) => f.layerId === 'odseki-gozdni'))

function getLabel(f) {
  const p = f.properties
  return p.name || p.naziv || p.id || f.featureId || t('popup.unknown')
}

function getLayerLabel(layerId) {
  const key = layerLabelKeys.get(layerId)
  return key ? t(key) : layerId
}

function selectFeature(f) {
  selectedFeatureId.value = f.featureId
  selectedLayerId.value = f.layerId
  selectedFeatureGeometry.value = f.geometry
  open({
    feature: f.properties,
    geometryType: f.geometryType,
    geometry: f.geometry,
    tabType: 'vector',
  })
}

/**
 * Tree total over the sampled area. Each polygon is counted against its own sampled cells;
 * if the coverages do not match the polygons one-to-one, the drawn outlines are used instead.
 *
 * @returns {Promise<{count: number}|{tooBig: true, area: number, maxArea: number}|null>}
 */
async function countTreesForSample(polygons, coverages) {
  const aligned = coverages?.length === polygons.length ? coverages : null
  const results = await Promise.all(
    polygons.map((polygon, i) =>
      measureTreesInPolygon(polygon, { coverages: aligned ? [aligned[i]] : null }),
    ),
  )

  const tooBig = results.find((r) => r?.tooBig)
  if (tooBig) return tooBig
  if (results.some((r) => r == null)) return null
  return {
    count: results.reduce((sum, r) => sum + r.count, 0),
    heights: results.flatMap((r) => r.heights),
    crownArea: results.reduce((sum, r) => sum + (r.crownArea ?? 0), 0),
  }
}

/** Minimum sample size for reporting a 95th percentile */
const P95_MIN_SAMPLE = 20

/** Height histogram class width, in metres */
const HEIGHT_BIN_M = 5

/** Minimum sample size for showing a height histogram */
const HISTOGRAM_MIN_SAMPLE = 20

/**
 * Counts per height class, spanning only the classes between min and max.
 * Empty classes inside the span are kept.
 */
function binHeights(heights, min, max) {
  const first = Math.floor(min / HEIGHT_BIN_M) * HEIGHT_BIN_M
  const last = Math.floor(max / HEIGHT_BIN_M) * HEIGHT_BIN_M
  const bins = []
  for (let from = first; from <= last; from += HEIGHT_BIN_M) {
    bins.push({ from, to: from + HEIGHT_BIN_M, count: 0 })
  }
  for (const height of heights) {
    const index = Math.min(bins.length - 1, Math.floor((height - first) / HEIGHT_BIN_M))
    bins[index].count++
  }
  return bins
}

/**
 * Summarise a sample of detected tree heights (min, max, mean, 95th percentile, histogram).
 * Trees under 3 m are not detected, so the sample mostly reflects the upper canopy.
 */
function summariseHeights(heights) {
  if (!heights?.length) return null

  // A loop, since Math.min(...heights) exceeds the argument limit on large samples
  let min = Infinity
  let max = -Infinity
  let sum = 0
  for (const height of heights) {
    if (height < min) min = height
    if (height > max) max = height
    sum += height
  }

  let p95 = null
  if (heights.length >= P95_MIN_SAMPLE) {
    const sorted = [...heights].sort((a, b) => a - b)
    p95 = sorted[Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1)]
  }

  const bins = heights.length >= HISTOGRAM_MIN_SAMPLE ? binHeights(heights, min, max) : null

  return { min, max, mean: sum / heights.length, p95, bins }
}

/** Error message for a refused sample (view too coarse, or polygon partly off screen) */
function sampleRefusalMessage({ reason }) {
  return reason === 'offScreen'
    ? t('popup.errors.polygonOffScreen')
    : t('popup.errors.zoomInToSample')
}

/** Corner ring of the raster pixel containing `coordinate`, snapped to the grid */
function pixelRing({ extent, resolution }, [cx, cy]) {
  const col = Math.floor((cx - extent[0]) / resolution)
  const row = Math.floor((extent[3] - cy) / resolution)
  const minX = extent[0] + col * resolution
  const maxX = minX + resolution
  const maxY = extent[3] - row * resolution
  const minY = maxY - resolution
  return [
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
    [minX, maxY],
    [minX, minY],
  ]
}

/**
 * Ground area of one raster pixel in m². The rasters are in EPSG:3857, so the
 * resolution is scaled by cos(latitude).
 */
function realPixelArea(layer, coordinate) {
  const viewInfo = layer?.get('rasterViewInfo')
  if (!viewInfo || !coordinate) return null
  const [, lat] = toLonLat(coordinate)
  const realRes = viewInfo.resolution * Math.cos((lat * Math.PI) / 180)
  return realRes * realRes
}

/** Orders raster layer IDs with visible layers first, to pick the grid for a pixel outline */
function preferredRasterOrder(layerIds) {
  return [...layerIds].sort((a, b) => Number(!!visibility[b]) - Number(!!visibility[a]))
}

/**
 * Sample every loaded raster across one or more polygons, each on its own grid.
 * Layers are sampled concurrently.
 */
async function sampleAllRasters(polygons, coordinate) {
  const loaded = RASTER_CONFIGS.filter((c) => activeRasterLayers[c.id])

  const perLayer = await Promise.all(
    loaded.map(async (config) => {
      const layer = activeRasterLayers[config.id]
      const parts = []
      for (const polygon of polygons) {
        const result = await sampleRasterPolygon(map.value, polygon, layer)
        if (result?.tooBig) return { config, tooBig: result }
        if (result?.notSampleable) return { config, notSampleable: result }
        if (result) parts.push(result)
      }
      return { config, layer, parts }
    }),
  )

  const tooBig = perLayer.find((r) => r.tooBig)
  if (tooBig) return { tooBig: tooBig.tooBig }

  const notSampleable = perLayer.find((r) => r.notSampleable)
  if (notSampleable) return { notSampleable: notSampleable.notSampleable }

  // One entry per classified layer
  const classBlocks = []
  const coveredByLayer = new Map()
  let classPixelCount = 0
  let classPixelArea = null
  const rasterStats = []
  const coveragesByLayer = new Map()

  for (const { config, layer, parts } of perLayer) {
    if (parts.length === 0) continue

    const pixelCount = parts.reduce((sum, p) => sum + p.pixelCount, 0)
    const pixelArea = realPixelArea(layer, coordinate)
    // One coverage per polygon, since each sampling window has its own cell origin
    const coverages = parts.map((p) => p.coverage).filter(Boolean)
    if (coverages.length > 0) coveragesByLayer.set(config.id, coverages)
    if (pixelArea != null) coveredByLayer.set(config.id, pixelCount * pixelArea)

    if (config.valueType === 'continuous') {
      const merged = parts.reduce(
        (acc, p) => ({
          sum: acc.sum + p.stats.sum,
          count: acc.count + p.stats.count,
          min: Math.min(acc.min, p.stats.min),
          max: Math.max(acc.max, p.stats.max),
        }),
        { sum: 0, count: 0, min: Infinity, max: -Infinity },
      )
      if (merged.count === 0) continue
      rasterStats.push({
        layerId: config.id,
        unit: t(config.unitKey),
        mean: merged.sum / merged.count,
        min: merged.min,
        max: merged.max,
        pixelCount,
        pixelArea,
        // Area where this layer has a prediction (can be smaller than the selection)
        coveredArea: pixelArea != null ? pixelCount * pixelArea : null,
        // Values are per hectare, so the total is the sum times the pixel area in ha
        total: pixelArea != null ? (merged.sum * pixelArea) / 10_000 : null,
      })
    } else {
      const counts = {}
      for (const part of parts) {
        for (const [cls, count] of Object.entries(part.counts)) {
          counts[cls] = (counts[cls] ?? 0) + Number(count)
        }
      }
      if (Object.keys(counts).length > 0) {
        classBlocks.push({
          layerId: config.id,
          label: getLayerLabel(config.id),
          classSet: config.classSet,
          counts,
        })
      }
      classPixelCount = pixelCount
      classPixelArea = pixelArea
    }
  }

  // Coverage of the tree grid layer, used to count trees
  const coverages = TREE_GRID_LAYER_IDS.map((id) => coveragesByLayer.get(id)).find(Boolean) ?? null
  // Area covered by the tree grid layer, used as the denominator for tree density
  const treeArea = TREE_GRID_LAYER_IDS.map((id) => coveredByLayer.get(id)).find(Boolean) ?? null

  // Area where any layer has a prediction (the same cells the outline traces)
  const capturedArea = (() => {
    const groups = new Map()
    for (const coverages of coveragesByLayer.values()) {
      for (const { cells, origin, resolution } of coverages) {
        const key = `${origin[0]},${origin[1]},${resolution}`
        const group = groups.get(key) ?? { cells: new Set(), resolution }
        for (const cell of cells) group.cells.add(cell)
        groups.set(key, group)
      }
    }
    if (groups.size === 0) return null
    const [, lat] = toLonLat(coordinate)
    const shrink = Math.cos((lat * Math.PI) / 180)
    let total = 0
    for (const { cells, resolution } of groups.values()) {
      const cellArea = (resolution * shrink) ** 2
      total += cells.size * cellArea
    }
    return total
  })()
  const fallback = rasterStats[0]

  return {
    classBlocks: classBlocks.length > 0 ? classBlocks : null,
    rasterStats,
    pixelCount: classPixelCount || fallback?.pixelCount || null,
    pixelArea: classPixelArea ?? fallback?.pixelArea ?? null,
    coverages,
    treeArea,
    capturedArea,
    // Traced outline of all covered cells, with holes where there is no prediction
    pixelBoundaryGeometry: traceCoveredBoundary([...coveragesByLayer.values()]),
  }
}

async function openOdsekResults(odsekFeature) {
  if (!odsekFeature.geometry) return
  const { type, coordinates } = odsekFeature.geometry

  function transformRing(ring) {
    return ring.map((pt) => transform(pt, 'EPSG:3794', 'EPSG:3857'))
  }

  let polygons
  if (type === 'Polygon') {
    polygons = [new Polygon(coordinates.map(transformRing))]
  } else if (type === 'MultiPolygon') {
    polygons = coordinates.map((rings) => new Polygon(rings.map(transformRing)))
  } else {
    return
  }

  if (!RASTER_CONFIGS.some((c) => activeRasterLayers[c.id])) return

  isSampling.value = true
  samplingError.value = null
  try {
    const center = getCenter(polygons[0].getExtent())
    const sampled = await sampleAllRasters(polygons, center)

    if (sampled.tooBig) {
      samplingError.value = t('popup.errors.compartmentTooLarge', {
        area: formatArea(sampled.tooBig.bboxArea),
        max: formatArea(sampled.tooBig.maxArea),
      })
      return
    }
    if (sampled.notSampleable) {
      samplingError.value = sampleRefusalMessage(sampled.notSampleable)
      return
    }
    // Every cell in the selection is outside the forest mask
    if (!sampled.classBlocks && sampled.rasterStats.length === 0) {
      samplingError.value = t('popup.errors.noPredictionHere')
      return
    }

    const displayGeometry =
      type === 'Polygon'
        ? { type: 'Polygon', coordinates: coordinates.map(transformRing) }
        : { type: 'MultiPolygon', coordinates: coordinates.map((rings) => rings.map(transformRing)) }

    const trees = await countTreesForSample(polygons, sampled.coverages)
    const sampledArea = sampled.pixelArea != null ? sampled.pixelCount * sampled.pixelArea : null
    open({
      treeArea: sampled.treeArea,
      capturedArea: sampled.capturedArea,
      geometryType: polygons.length > 1 ? 'MultiPolygon' : 'Polygon',
      geometry: displayGeometry,
      classBlocks: sampled.classBlocks,
      tabType: 'sample',
      pixelCount: sampled.pixelCount,
      pixelArea: sampledArea,
      treeCount: trees?.tooBig ? null : (trees?.count ?? null),
      treeCountUnavailable: trees == null || trees.tooBig === true,
      treeCountMaxArea: trees?.tooBig ? trees.maxArea : null,
      treeCrownArea: trees?.tooBig ? null : (trees?.crownArea ?? null),
      treeHeights: trees?.tooBig
        ? null
        : summariseHeights(trees?.heights),
      pixelGeometry: sampled.pixelBoundaryGeometry,
      rasterStats: sampled.rasterStats,
    })
    closePopup()
  } finally {
    isSampling.value = false
  }
}

const GROUP_THRESHOLD = 4

const groupedFeatures = computed(() => {
  const groups = new Map()
  for (const f of mainFeatures.value) {
    if (!groups.has(f.layerId)) groups.set(f.layerId, [])
    groups.get(f.layerId).push(f)
  }
  return [...groups.entries()].map(([layerId, features]) => {
    const isCluster = features.some((f) => (f.properties.cluster_count ?? 1) > 1)
    const clusterTotal = isCluster
      ? features.reduce((sum, f) => sum + (f.properties.cluster_count ?? 1), 0)
      : 0
    return {
      layerId,
      label: getLayerLabel(layerId),
      color: layerColors.get(layerId) ?? null,
      features: isCluster ? [] : features,
      grouped: !isCluster && features.length > GROUP_THRESHOLD,
      isCluster,
      clusterTotal,
    }
  })
})

const expandedGroups = ref(new Set())
const isSampling = ref(false)
const samplingError = ref(null)

/** Raster entry whose grid defines the clicked pixel, preferring the visible layer */
function pixelRasterEntry() {
  const candidates = rasterFeatures.value.filter((r) => !r.polygonGeometry && r.coordinate)
  if (candidates.length === 0) return null
  const preferredId = preferredRasterOrder(candidates.map((r) => r.layerId))[0] ?? null
  return candidates.find((r) => r.layerId === preferredId) ?? candidates[0]
}

/** Polygon of the clicked raster pixel, snapped to that layer's grid */
function pixelPolygonFor(entry) {
  const viewInfo = activeRasterLayers[entry.layerId]?.get('rasterViewInfo')
  return viewInfo ? new Polygon([pixelRing(viewInfo, entry.coordinate)]) : null
}

// Trees inside the clicked raster pixel, fetched asynchronously from tiles at a fixed zoom
const pixelTrees = ref([])
let pixelTreesGeneration = 0

watch(
  popupFeatures,
  async () => {
    const generation = ++pixelTreesGeneration
    pixelTrees.value = []

    // Clicking a tree top directly shows that tree, not the whole pixel's list
    if (mainFeatures.value.some((f) => f.layerId === 'tops')) return

    const entry = pixelRasterEntry()
    const polygon = entry ? pixelPolygonFor(entry) : null
    if (!polygon) return

    const result = await collectTreesInPolygon(polygon)
    if (generation !== pixelTreesGeneration) return
    pixelTrees.value = result?.trees ?? []
  },
  { immediate: true },
)

// Reset expanded/error state when the popup features change
watch(popupFeatures, () => {
  expandedGroups.value = new Set()
  samplingError.value = null
})

function selectPixelTree(tree) {
  const geometry = tree.coordinate ? { type: 'Point', coordinates: tree.coordinate } : null
  selectedFeatureId.value = tree.id
  selectedLayerId.value = 'tops'
  selectedFeatureGeometry.value = geometry
  // The geometry goes onto the tab too, so reopening it restores the marker
  open({ feature: tree.properties, geometryType: 'Point', geometry, tabType: 'vector' })
}

function toggleGroup(layerId) {
  const s = new Set(expandedGroups.value)
  if (s.has(layerId)) s.delete(layerId)
  else s.add(layerId)
  expandedGroups.value = s
}

function isExpanded(layerId) {
  return expandedGroups.value.has(layerId)
}

async function openAllRastersResults() {
  if (rasterFeatures.value.length === 0) return

  // Polygon draw mode: use first raster's distribution (single combined tab)
  const polygonEntry = rasterFeatures.value.find((r) => r.polygonGeometry)
  if (polygonEntry) {
    isSampling.value = true
    samplingError.value = null
    try {
      const sampled = await sampleAllRasters(
        [polygonEntry.polygonGeometry],
        polygonEntry.coordinate,
      )
      if (sampled.tooBig) {
        samplingError.value = t('popup.errors.areaTooLarge', {
          area: formatArea(sampled.tooBig.bboxArea),
          max: formatArea(sampled.tooBig.maxArea),
        })
        return
      }
      if (sampled.notSampleable) {
        samplingError.value = sampleRefusalMessage(sampled.notSampleable)
        return
      }
      // Every cell in the selection is outside the forest mask
      if (!sampled.classBlocks && sampled.rasterStats.length === 0) {
        samplingError.value = t('popup.errors.noPredictionHere')
        return
      }

      const trees = await countTreesForSample(
        [polygonEntry.polygonGeometry],
        sampled.coverages,
      )
      const sampledArea = sampled.pixelArea != null ? sampled.pixelCount * sampled.pixelArea : null
      open({
        treeArea: sampled.treeArea,
        capturedArea: sampled.capturedArea,
        geometryType: 'Polygon',
        geometry: { type: 'Polygon', coordinates: polygonEntry.polygonGeometry.getCoordinates() },
        classBlocks: sampled.classBlocks,
        tabType: 'sample',
        pixelCount: sampled.pixelCount,
        pixelArea: sampledArea,
        treeCount: trees?.tooBig ? null : (trees?.count ?? null),
        treeCountUnavailable: trees == null || trees.tooBig === true,
        treeCountMaxArea: trees?.tooBig ? trees.maxArea : null,
        treeCrownArea: trees?.tooBig ? null : (trees?.crownArea ?? null),
        treeHeights: trees?.tooBig
          ? null
          : summariseHeights(trees?.heights),
        pixelGeometry: sampled.pixelBoundaryGeometry,
        rasterStats: sampled.rasterStats,
      })
      // Remove the drawn shape; the results panel shows its outline instead
      clearDrawnShape()
      closePopup()
    } finally {
      isSampling.value = false
    }
    return
  }

  // Snap the displayed pixel to the visible raster's grid; its area converts densities to amounts
  const preferred = pixelRasterEntry()

  let pixelGeometry = null
  let singlePixelArea = null
  if (preferred) {
    const layer = activeRasterLayers[preferred.layerId]
    const viewInfo = layer?.get('rasterViewInfo')
    if (viewInfo) {
      pixelGeometry = { type: 'Polygon', coordinates: [pixelRing(viewInfo, preferred.coordinate)] }
      singlePixelArea = realPixelArea(layer, preferred.coordinate)
    }
  }

  // Single-pixel click mode: one value entry per loaded raster, formatted by the panel
  const pixelValues = []
  const readByLayer = new Map(rasterFeatures.value.map((r) => [r.layerId, r]))
  // Layers with no value at this cell get a `missing` entry
  for (const config of RASTER_CONFIGS.filter((c) => activeRasterLayers[c.id])) {
    const r = readByLayer.get(config.id)
    const data = r?.pixelData
    if (!data) {
      pixelValues.push({
        layerId: config.id,
        valueType: config.valueType,
        classSet: config.classSet,
        missing: true,
      })
      continue
    }
    if (config.valueType === 'continuous') {
      // Convert the density using this layer's own pixel area
      const ownArea = realPixelArea(activeRasterLayers[r.layerId], r.coordinate) ?? singlePixelArea
      const unit = t(config.unitKey)
      pixelValues.push({
        layerId: r.layerId,
        valueType: 'continuous',
        density: data[0],
        unit,
        // Only per-hectare quantities are converted to an absolute amount
        absolute: ownArea != null && unit.endsWith('/ha') ? (data[0] * ownArea) / 10_000 : null,
        errorPct: relativeErrorPct(data[0], config),
      })
    } else {
      const classValue = data[0]
      pixelValues.push({
        layerId: r.layerId,
        valueType: 'classified',
        classValue,
        classSet: config.classSet,
        // Same palette as the map style, so the swatch matches the cell colour
        color: classPalette(config.classSet)[classValue] ?? CLASS_FALLBACK,
      })
    }
  }
  // No layer has a value here, so no tab is opened
  if (!pixelValues.some((v) => !v.missing)) return

  const pixelOlPolygon = pixelGeometry ? new Polygon(pixelGeometry.coordinates) : null
  // The pixel ring is the counting region, so no coverage set is needed. Trees are
  // collected so the panel can list them individually.
  const pixelTreeResult = pixelOlPolygon
    ? await measureTreesInPolygon(pixelOlPolygon, { collect: true })
    : null
  const treeCount = pixelTreeResult?.tooBig ? null : (pixelTreeResult?.count ?? null)
  const trees = pixelTreeResult?.tooBig ? null : (pixelTreeResult?.trees ?? null)
  open({
    pixelValues,
    trees,
    geometryType: 'Polygon',
    geometry: pixelGeometry,
    tabType: 'pixel',
    pixelCount: 1,
    pixelArea: singlePixelArea,
    treeCount,
    treeCountUnavailable: pixelOlPolygon != null && treeCount == null,
  })
  closePopup()
}
</script>

<template>
  <div class="feature-popup">
    <div class="popup-header">
      <span class="popup-title">{{ t('popup.title', featureCount, { count: featureCount }) }}</span>
      <button class="popup-close" @click="closePopup">
        &times;
      </button>
    </div>
    <div v-if="isAreaTooLarge" class="popup-context popup-context--warning">
      <div class="context-row">
        <span class="popup-area-warning">{{ t('popup.areaTooLarge') }}</span>
      </div>
    </div>
    <div v-else-if="isWfsLoading || ggoNames || ggeNames || odsekFeatures.length > 0" class="popup-context">
      <template v-if="isWfsLoading">
        <div class="context-row context-row--loading">
          <span class="popup-loading-dot" />
          <span class="context-key">{{ t('popup.loading') }}</span>
        </div>
      </template>
      <template v-else>
        <div v-if="ggoNames" class="context-row">
          <span class="context-key">{{ t('popup.ggo') }}</span>
          <span class="context-value">{{ ggoNames }}</span>
        </div>
        <div v-if="ggeNames" class="context-row">
          <span class="context-key">{{ t('popup.gge') }}</span>
          <span class="context-value">{{ ggeNames }}</span>
        </div>
        <div v-if="odsekFeatures.length > 0" class="context-row">
          <span class="context-key">{{ t('popup.compartment') }}</span>
          <span class="context-value">
            <template v-for="(f, i) in odsekFeatures" :key="i">
              <span v-if="i > 0">, </span>
              <button v-if="f.geometry" class="odsek-link" :disabled="isSampling" @click="openOdsekResults(f)">{{ f.properties.odsek }}</button>
              <span v-else>{{ f.properties.odsek }}</span>
            </template>
          </span>
        </div>
      </template>
    </div>
    <div v-if="popupArea != null" class="popup-context popup-context--area">
      <div class="context-row">
        <span class="context-key">{{ t('popup.area') }}</span>
        <span class="context-value">{{ formatArea(popupArea) }}</span>
      </div>
    </div>
    <ul v-if="mainFeatures.length > 0 || pixelTrees.length > 0" class="popup-list">
      <!-- Pixel trees: all tree-tops within the clicked raster pixel, by ID -->
      <template v-if="pixelTrees.length > 0">
        <li class="popup-group-header" @click="toggleGroup('__pixelTrees')">
          <span class="group-chevron">{{ isExpanded('__pixelTrees') ? '▾' : '▸' }}</span>
          <span class="layer-badge" :style="{ background: layerColors.get('tops') ?? null }">{{ getLayerLabel('tops') }}</span>
          <span class="group-count">{{ pixelTrees.length }}</span>
        </li>
        <template v-if="isExpanded('__pixelTrees')">
          <li
            v-for="tree in pixelTrees"
            :key="tree.id"
            class="popup-item popup-item--indented"
            :class="{ 'popup-item--selected': selectedFeatureId === tree.id }"
            @click="selectPixelTree(tree)"
          >
            <span class="feature-label">{{ tree.id }}</span>
          </li>
        </template>
      </template>

      <template v-for="group in groupedFeatures.filter(g => !(pixelTrees.length > 0 && g.layerId === 'tops'))" :key="group.layerId">
        <!-- Cluster: zoomed-out tiles, show count + zoom hint -->
        <template v-if="group.isCluster">
          <li class="popup-item popup-item--cluster">
            <span class="layer-badge" :style="group.color ? { background: group.color } : {}">{{ group.label }}</span>
            <span class="cluster-body">
              <span class="cluster-count">~{{ group.clusterTotal.toLocaleString(numberLocale) }} {{ t('popup.treeCountUnit', group.clusterTotal) }}</span>
              <span class="cluster-hint">{{ t('popup.clusterHint') }}</span>
            </span>
          </li>
        </template>

        <!-- Grouped: more than GROUP_THRESHOLD items of the same layer -->
        <template v-else-if="group.grouped">
          <li class="popup-group-header" @click="toggleGroup(group.layerId)">
            <span class="group-chevron">{{ isExpanded(group.layerId) ? '▾' : '▸' }}</span>
            <span class="layer-badge" :style="group.color ? { background: group.color } : {}">{{ group.label }}</span>
            <span v-if="!(isAreaSelection && group.layerId === 'tops')" class="group-count">{{ group.features.length }}</span>
          </li>
          <template v-if="isExpanded(group.layerId)">
            <li v-for="(f, i) in group.features" :key="i" class="popup-item popup-item--indented"
              @click="selectFeature(f)">
              <span class="feature-label">{{ getLabel(f) }}</span>
            </li>
          </template>
        </template>

        <!-- Flat: 4 or fewer items, render individually -->
        <template v-else>
          <li v-for="(f, i) in group.features" :key="i" class="popup-item" @click="selectFeature(f)">
            <span class="layer-badge" :style="group.color ? { background: group.color } : {}">{{ group.label }}</span>
            <span class="feature-label">{{ getLabel(f) }}</span>
          </li>
        </template>
      </template>
    </ul>
    <div v-if="rasterFeatures.length > 0 && !isAreaTooLarge" class="popup-raster-footer">
      <button class="popup-raster-btn" :disabled="isSampling" @click="openAllRastersResults">
        {{ isSampling ? t('popup.sampling') : t('popup.showPixelValues') }}
      </button>
      <span v-if="samplingError" class="popup-sampling-error">{{ samplingError }}</span>
    </div>
  </div>
</template>

<style scoped>
.feature-popup {
  background: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
  min-width: 200px;
  max-width: 320px;
  max-height: 280px;
  display: flex;
  flex-direction: column;
  font-size: 13px;
}

.popup-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--color-border);
}

.popup-title {
  font-weight: 600;
  color: var(--color-heading);
}

.popup-close {
  background: none;
  border: none;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  color: var(--color-text-muted);
  padding: 0 2px;
}

.popup-close:hover {
  color: var(--color-text);
}

.popup-list {
  list-style: none;
  padding: 0;
  margin: 0;
  overflow-y: auto;
}

.popup-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  border-bottom: 1px solid var(--color-border);
}

.popup-item:last-child {
  border-bottom: none;
}

.popup-item:hover {
  background: var(--color-background-soft);
}

/* Clickable rows are styled as links (cluster rows have no click handler) */
.popup-item:not(.popup-item--cluster) .feature-label {
  color: var(--color-accent);
}
.popup-item:not(.popup-item--cluster):hover .feature-label {
  text-decoration: underline;
}
.popup-item:not(.popup-item--cluster)::after {
  content: '›';
  margin-left: auto;
  padding-left: 8px;
  flex-shrink: 0;
  font-size: 15px;
  line-height: 1;
  color: var(--color-accent);
}

.popup-item--indented {
  padding-left: 28px;
}

.popup-group-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-background-soft);
  user-select: none;
}

.popup-group-header:hover {
  filter: brightness(0.96);
}

.group-chevron {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--color-text-muted);
  width: 12px;
}

.group-count {
  margin-left: auto;
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-muted);
  background: var(--color-border);
  padding: 1px 6px;
  border-radius: 10px;
}

.layer-badge {
  flex-shrink: 0;
  background: var(--color-accent);
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 4px;
  white-space: nowrap;
}

.feature-label {
  color: var(--color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.popup-context {
  border-bottom: 1px solid var(--color-border);
  padding: 6px 12px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.popup-context+.popup-context {
  border-top: none;
}

.context-row {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-size: 11px;
}

.context-row--loading {
  opacity: 0.6;
}

.popup-loading-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-text-muted);
  flex-shrink: 0;
  animation: popup-pulse 1s ease-in-out infinite;
}

@keyframes popup-pulse {

  0%,
  100% {
    opacity: 0.3;
  }

  50% {
    opacity: 1;
  }
}

.context-key {
  flex-shrink: 0;
  font-weight: 600;
  color: var(--color-text-muted);
}

.context-value {
  color: var(--color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.odsek-link {
  background: none;
  border: none;
  padding: 0;
  font-size: inherit;
  color: var(--color-accent, #1976d2);
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.odsek-link:hover {
  opacity: 0.8;
}

.popup-raster-footer {
  border-top: 1px solid var(--color-border);
  padding: 8px 12px;
}

.popup-raster-btn {
  background: none;
  border: none;
  padding: 0;
  font-size: 12px;
  color: var(--color-accent, #1976d2);
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.popup-raster-btn:hover {
  opacity: 0.8;
}

.popup-area-warning {
  font-size: 11px;
  color: var(--p-orange-600, #d97706);
  line-height: 1.4;
  white-space: normal;
}

.popup-sampling-error {
  display: block;
  margin-top: 4px;
  font-size: 11px;
  color: var(--p-red-500, #ef4444);
  line-height: 1.3;
  white-space: normal;
}

.popup-item--selected {
  background: var(--color-background-soft);
  font-weight: 600;
}

.popup-item--cluster {
  cursor: default;
  align-items: flex-start;
}

.popup-item--cluster:hover {
  background: transparent;
}

.cluster-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.cluster-count {
  font-weight: 600;
  color: var(--color-text);
}

.cluster-hint {
  font-size: 11px;
  color: var(--color-text-muted);
  font-style: italic;
  white-space: normal;
  line-height: 1.3;
}
</style>

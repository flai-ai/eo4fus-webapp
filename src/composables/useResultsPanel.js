import { ref, computed, watch } from 'vue'
import { useFeaturePopup } from './useFeaturePopup.js'
import {
  selectedFeatureId,
  selectedLayerId,
  selectedFeatureGeometry,
} from './useFeatureInteraction.js'
import { useMap } from './useMap.js'

const { isWfsLoading, popupFeatures, popupArea, popupCoordinate, openPopup } = useFeaturePopup()
const { map } = useMap()

const isOpen = ref(false)
const tabs = ref([])
const activeTabId = ref(null)
let nextTabId = 0
let nextTabSeq = 1
let stopCtxWatch = null
let ctxSession = 0

// Computed views of the active tab
const activeTab = computed(() => tabs.value.find((t) => t.id === activeTabId.value) ?? null)
const selectedFeature = computed(() => activeTab.value?.feature ?? null)
const selectedGeometry = computed(() => activeTab.value?.geometry ?? null)
const isAreaFeature = computed(() => activeTab.value?.isAreaFeature ?? false)
/** Class histograms for a sampled area, one entry per classified raster */
const classBlocks = computed(() => activeTab.value?.classBlocks ?? null)
const pixelCount = computed(() => activeTab.value?.pixelCount ?? null)
const pixelArea = computed(() => activeTab.value?.pixelArea ?? null)
const treeCount = computed(() => activeTab.value?.treeCount ?? null)
/** True when trees could not be counted at the zoom used, as opposed to there being none */
const treeCountUnavailable = computed(() => activeTab.value?.treeCountUnavailable === true)
const treeCountMaxArea = computed(() => activeTab.value?.treeCountMaxArea ?? null)
/**
 * Measured tree heights in metres: { min, max, mean, p95, bins }. `bins` are the
 * 5 m height classes, omitted when the sample is too small.
 */
const treeHeights = computed(() => activeTab.value?.treeHeights ?? null)
/** Total crown area of the counted trees, in m² (can exceed the ground area as crowns overlap) */
const treeCrownArea = computed(() => activeTab.value?.treeCrownArea ?? null)
/** Per-layer raster readings for a single clicked cell; empty for other tab types */
const pixelValues = computed(() => activeTab.value?.pixelValues ?? null)
/** Individual tree tops on the clicked cell */
const trees = computed(() => activeTab.value?.trees ?? null)
/**
 * Ground the trees were counted over, in m². This is the counting layer's coverage,
 * not the drawn area, so densities are not underestimated where it has no data.
 */
const treeArea = computed(() => activeTab.value?.treeArea ?? null)
/** Ground any layer had a prediction for, in m² (the cells outlined in red) */
const capturedArea = computed(() => activeTab.value?.capturedArea ?? null)
/** ID of the selected vector feature, shown for tree tops */
const activeFeatureId = computed(() => activeTab.value?.featureId ?? null)
const pixelGeometry = computed(() => activeTab.value?.pixelGeometry ?? null)
const rasterStats = computed(() => activeTab.value?.rasterStats ?? null)
const ctx = computed(
  () => activeTab.value?.ctx ?? { ggo: '', gge: '', odseki: [], area: null, loading: false },
)

function uniqueValues(features, prop) {
  return [...new Set(features.map((f) => f.properties[prop]).filter(Boolean))]
}

function uniqueNames(features, prop) {
  return uniqueValues(features, prop).join(', ')
}

function captureCtxIntoTab(tab) {
  tab.ctx.ggo = uniqueNames(
    popupFeatures.value.filter((f) => f.layerId === 'ggo'),
    'ggo_naziv',
  )
  tab.ctx.gge = uniqueNames(
    popupFeatures.value.filter((f) => f.layerId === 'gge'),
    'gge_naziv',
  )
  // Kept as a list so the panel can count and clamp the compartments
  tab.ctx.odseki = uniqueValues(
    popupFeatures.value.filter((f) => f.layerId === 'odseki-gozdni'),
    'odsek',
  )
  tab.ctx.area = popupArea.value
  tab.popupFeatures = [...popupFeatures.value]
  tab.popupArea = popupArea.value
}

function generateLabel(tab) {
  return `#${tab.seq}`
}

function computeExtent(geojsonGeometry) {
  if (!geojsonGeometry) return null
  function flattenCoords(coords) {
    if (!Array.isArray(coords)) return []
    if (typeof coords[0] === 'number') return [coords]
    return coords.flatMap(flattenCoords)
  }
  const points = flattenCoords(geojsonGeometry.coordinates)
  if (!points.length) return null
  const xs = points.map((p) => p[0])
  const ys = points.map((p) => p[1])
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}

function zoomToTab(tab) {
  const olMap = map.value
  if (!olMap) return
  const view = olMap.getView()
  if (tab.isAreaFeature && tab.geometry) {
    const extent = computeExtent(tab.geometry)
    if (extent) {
      view.fit(extent, { padding: [80, 80, 80, 80], duration: 500, maxZoom: 16 })
      return
    }
  }
  if (tab.coordinate) {
    view.animate({ center: tab.coordinate, duration: 500 })
  }
}

function restoreTabMapState(tab) {
  selectedFeatureId.value = tab.featureId ?? null
  selectedLayerId.value = tab.layerIdForSelection ?? null
  selectedFeatureGeometry.value = tab.geometry ?? null
  if (tab.coordinate) {
    openPopup(tab.coordinate, tab.popupFeatures, tab.popupArea)
  }
  zoomToTab(tab)
}

export function useResultsPanel() {
  /**
   * Open a new results tab.
   *
   * @param {Object} options
   * @param {Object|null} options.feature       - vector feature properties table
   * @param {string|null} options.geometryType
   * @param {Object|null} options.geometry      - GeoJSON geometry in EPSG:3857
   * @param {Array|null}  options.classBlocks   - per-layer class histograms
   * @param {string|null} options.tabType       - 'vector' | 'sample' | 'pixel'
   * @param {number|null} options.pixelCount
   * @param {number|null} options.pixelArea     - m², already cos(lat)-corrected
   * @param {number|null} options.treeCount
   * @param {boolean} options.treeCountUnavailable
   * @param {number|null} options.treeCountMaxArea - m² limit, set when the area was too large
   * @param {Object|null} options.treeHeights - { min, max, mean, p95, bins }
   * @param {number|null} options.treeCrownArea - m², summed over the trees
   * @param {Object|null} options.pixelGeometry - snapped pixel boundary
   * @param {Array|null}  options.rasterStats   - per-layer continuous statistics
   * @param {Array|null}  options.pixelValues   - per-layer readings on one cell
   * @param {Array|null}  options.trees         - tree tops on that cell, as objects
   * @param {number|null} options.treeArea      - m² the trees were counted over
   * @param {number|null} options.capturedArea  - m² any layer had a prediction for
   */
  function open({
    feature = null,
    geometryType = null,
    geometry = null,
    classBlocks: classBlocksArg = null,
    tabType = null,
    pixelCount: pixelCountArg = null,
    pixelArea: pixelAreaArg = null,
    treeCount: treeCountArg = null,
    treeCountUnavailable: treeCountUnavailableArg = false,
    treeCountMaxArea: treeCountMaxAreaArg = null,
    treeHeights: treeHeightsArg = null,
    treeCrownArea: treeCrownAreaArg = null,
    pixelGeometry: pixelGeometryArg = null,
    rasterStats: rasterStatsArg = null,
    pixelValues: pixelValuesArg = null,
    trees: treesArg = null,
    treeArea: treeAreaArg = null,
    capturedArea: capturedAreaArg = null,
  } = {}) {
    // Derive type if not explicitly provided
    const type =
      tabType ??
      (classBlocksArg != null ? 'sample' : selectedFeatureId.value != null ? 'vector' : 'pixel')

    // Only vector tabs keep feature/layer IDs; pixel/sample tabs are not deduplicated
    const featureId = type === 'vector' ? selectedFeatureId.value : null
    const layerIdForSelection = type === 'vector' ? selectedLayerId.value : null
    const coordinate = popupCoordinate.value ? [...popupCoordinate.value] : null

    // Deduplication: only for explicitly selected vector features
    if (type === 'vector' && featureId != null) {
      const existing = tabs.value.find(
        (t) => t.featureId === featureId && t.layerIdForSelection === layerIdForSelection,
      )
      if (existing) {
        setActiveTab(existing.id)
        return
      }
    }

    stopCtxWatch?.()
    stopCtxWatch = null
    const mySession = ++ctxSession

    const tabId = nextTabId++
    const seq = nextTabSeq++
    const tab = {
      id: tabId,
      seq,
      type,
      label: generateLabel({ seq }),
      feature,
      geometry,
      geometryType,
      isAreaFeature:
        geometryType != null && geometryType !== 'Point' && geometryType !== 'MultiPoint',
      classBlocks: classBlocksArg,
      pixelCount: pixelCountArg,
      pixelArea: pixelAreaArg,
      treeCount: treeCountArg,
      treeCountUnavailable: treeCountUnavailableArg,
      treeCountMaxArea: treeCountMaxAreaArg,
      treeHeights: treeHeightsArg,
      treeCrownArea: treeCrownAreaArg,
      pixelGeometry: pixelGeometryArg,
      rasterStats: rasterStatsArg,
      pixelValues: pixelValuesArg,
      trees: treesArg,
      treeArea: treeAreaArg,
      capturedArea: capturedAreaArg,
      coordinate,
      popupFeatures: [...popupFeatures.value],
      popupArea: popupArea.value,
      featureId,
      layerIdForSelection,
      ctx: { ggo: '', gge: '', odseki: [], area: null, loading: false },
    }

    tabs.value.push(tab)
    activeTabId.value = tab.id
    isOpen.value = true

    // Work through the reactive proxy that Vue created when we pushed
    const reactiveTab = tabs.value[tabs.value.length - 1]

    captureCtxIntoTab(reactiveTab)

    if (isWfsLoading.value) {
      reactiveTab.ctx.loading = true
      stopCtxWatch = watch(isWfsLoading, (loading) => {
        if (!loading) {
          stopCtxWatch?.()
          stopCtxWatch = null
          if (ctxSession === mySession) {
            captureCtxIntoTab(reactiveTab)
            reactiveTab.ctx.loading = false
          }
        }
      })
    }
  }

  function setActiveTab(tabId) {
    activeTabId.value = tabId
    const tab = tabs.value.find((t) => t.id === tabId)
    if (tab) restoreTabMapState(tab)
  }

  function closeTab(tabId) {
    const idx = tabs.value.findIndex((t) => t.id === tabId)
    if (idx === -1) return
    const wasActive = activeTabId.value === tabId
    tabs.value.splice(idx, 1)
    if (!wasActive) return
    if (tabs.value.length === 0) {
      close()
      return
    }
    const nextTab = tabs.value[Math.min(idx, tabs.value.length - 1)]
    activeTabId.value = nextTab.id
    restoreTabMapState(nextTab)
  }

  function close() {
    stopCtxWatch?.()
    stopCtxWatch = null
    tabs.value = []
    activeTabId.value = null
    isOpen.value = false
    nextTabSeq = 1
  }

  return {
    isOpen,
    tabs,
    activeTabId,
    selectedFeature,
    selectedGeometry,
    isAreaFeature,
    classBlocks,
    pixelCount,
    pixelArea,
    treeCount,
    treeCountUnavailable,
    treeCountMaxArea,
    treeHeights,
    treeCrownArea,
    pixelValues,
    trees,
    treeArea,
    capturedArea,
    activeFeatureId,
    pixelGeometry,
    rasterStats,
    ctx,
    activeTabLayerId: computed(() => activeTab.value?.layerIdForSelection ?? null),
    open,
    close,
    setActiveTab,
    closeTab,
  }
}

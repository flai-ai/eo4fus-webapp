import { ref, computed, watch } from 'vue'
import { get as getProjection, transform } from 'ol/proj'
import { useResultsPanel } from './useResultsPanel.js'

/**
 * Point cloud for the current results selection, shown either as a preview in
 * `ResultsPanel` or as a floating window rendered by `MapArea`.
 */

const POINTCLOUD_ID = 'fd8a9e1d-9b52-4ec5-80ea-1445af86b5e9'

const AOI_SOURCE_PROJECTION = 'EPSG:3857'
const AOI_TARGET_PROJECTION = 'EPSG:3794'

/** Half-width, in metres, of the square a clicked point is widened into */
const AOI_POINT_RADIUS = 10
/** Simplification tolerance in EPSG:3857 metres (roughly 3.5 m on the ground in Slovenia) */
const AOI_SIMPLIFY_TOLERANCE = 5

if (!getProjection(AOI_SOURCE_PROJECTION) || !getProjection(AOI_TARGET_PROJECTION)) {
  console.error(
    `[usePointCloud] Missing projection registration: "${AOI_SOURCE_PROJECTION}" or "${AOI_TARGET_PROJECTION}". ` +
      'Add the proj4 definition to src/config/projections.js.',
  )
}

const { activeTabId, selectedGeometry, pixelGeometry } = useResultsPanel()

const isPreviewOpen = ref(false)
const isWindowOpen = ref(false)

function rdpSimplify(points, tolerance) {
  if (points.length <= 2) return points
  let maxDist = 0
  let maxIdx = 0
  const [x1, y1] = points[0]
  const [x2, y2] = points[points.length - 1]
  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.sqrt(dx * dx + dy * dy)
  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = points[i]
    const dist =
      len === 0
        ? Math.sqrt((px - x1) ** 2 + (py - y1) ** 2)
        : Math.abs(dy * px - dx * py + x2 * y1 - y2 * x1) / len
    if (dist > maxDist) {
      maxDist = dist
      maxIdx = i
    }
  }
  if (maxDist > tolerance) {
    const left = rdpSimplify(points.slice(0, maxIdx + 1), tolerance)
    const right = rdpSimplify(points.slice(maxIdx), tolerance)
    return [...left.slice(0, -1), ...right]
  }
  return [points[0], points[points.length - 1]]
}

/** Flat "x,y,x,y,…" ring in EPSG:3794, as the embedded viewer expects it */
const aoi = computed(() => {
  const geom = pixelGeometry.value ?? selectedGeometry.value
  if (!geom) return ''

  const { type, coordinates } = geom
  let points

  if (type === 'Point') {
    const [x, y] = coordinates
    const r = AOI_POINT_RADIUS
    points = [
      [x - r, y - r],
      [x + r, y - r],
      [x + r, y + r],
      [x - r, y + r],
      [x - r, y - r],
    ]
  } else if (type === 'Polygon') {
    points = coordinates[0]
  } else if (type === 'MultiPolygon') {
    points = coordinates[0]?.[0]
  } else {
    // Other geometries use the bounding box of their coordinates
    let flatCoords = []
    if (type === 'LineString' || type === 'MultiPoint') {
      flatCoords = coordinates
    } else if (type === 'MultiLineString') {
      flatCoords = coordinates.flat(1)
    } else {
      return ''
    }
    if (!flatCoords.length) return ''
    const xs = flatCoords.map((p) => p[0])
    const ys = flatCoords.map((p) => p[1])
    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)
    const minY = Math.min(...ys)
    const maxY = Math.max(...ys)
    points = [
      [minX, minY],
      [maxX, minY],
      [maxX, maxY],
      [minX, maxY],
      [minX, minY],
    ]
  }
  if (!points?.length) return ''

  points = rdpSimplify(points, AOI_SIMPLIFY_TOLERANCE)

  return points
    .map((p) => transform(p, AOI_SOURCE_PROJECTION, AOI_TARGET_PROJECTION))
    .flatMap((p) => [p[0], p[1]])
    .join(',')
})

// Close both views when the tab or selected area changes.
watch([activeTabId, aoi], () => {
  isPreviewOpen.value = false
  isWindowOpen.value = false
})

export function usePointCloud() {
  function togglePreview() {
    isPreviewOpen.value = !isPreviewOpen.value
    // Only one view is open at a time
    if (isPreviewOpen.value) isWindowOpen.value = false
  }

  /** Moves the point cloud from the preview to the floating window */
  function expand() {
    isPreviewOpen.value = false
    isWindowOpen.value = true
  }

  function closeWindow() {
    isWindowOpen.value = false
  }

  return {
    pointcloudId: POINTCLOUD_ID,
    aoi,
    isPreviewOpen,
    isWindowOpen,
    togglePreview,
    expand,
    closeWindow,
  }
}

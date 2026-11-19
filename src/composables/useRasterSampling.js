import { getArea } from 'ol/sphere'
import { readWindowIn } from './useRasterPixelReader.js'

/**
 * Samples all raster pixels inside a polygon.
 *
 * Classified rasters return a class histogram, continuous rasters return sum/min/max/mean.
 * Pixels are visited on the layer's own grid (cell centre inside the polygon), yielding to
 * the event loop every CHUNK_SIZE cells. Values are read from the source GeoTIFF; without a
 * source URL the rendered canvas is read, and the result is notSampleable when zoomed out
 * or partly off screen.
 *
 * @param {import('ol/Map').default} olMap
 * @param {import('ol/geom/Polygon').default} polygon - OL Polygon in map CRS
 * @param {import('ol/layer/WebGLTile').default} layer - WebGLTileLayer with getData support
 * @returns {Promise<{ counts?: Object, stats?: Object, coverage?: Object, pixelCount: number } | { tooBig: true } | { notSampleable: true, reason: 'zoomedOut' | 'offScreen' } | null>}
 */
export async function sampleRasterPolygon(olMap, polygon, layer) {
  const viewInfo = layer.get('rasterViewInfo')
  const url = layer.get('rasterUrl')

  // Read the source file when available (independent of zoom and viewport).
  if (url) {
    return _sampleFromSource(polygon, layer, url)
  }

  if (viewInfo) {
    return _sampleByRasterGrid(olMap, polygon, layer, viewInfo)
  }

  // Fallback: screen-space sampling when rasterViewInfo is not yet available.
  return _sampleByScreenPixels(olMap, polygon, layer)
}

/** True when the layer holds continuous values (not class codes) */
function isContinuous(layer) {
  return layer.get('rasterConfig')?.valueType === 'continuous'
}

/** Accumulator for continuous values */
function createStats() {
  return { sum: 0, min: Infinity, max: -Infinity, count: 0 }
}

function addSample(stats, value) {
  stats.sum += value
  if (value < stats.min) stats.min = value
  if (value > stats.max) stats.max = value
  stats.count++
}

function finalizeStats(stats) {
  if (stats.count === 0) return null
  return {
    sum: stats.sum,
    min: stats.min,
    max: stats.max,
    count: stats.count,
    mean: stats.sum / stats.count,
  }
}

// Yield to the event loop every this many bounding-box iterations.
const CHUNK_SIZE = 5_000

/**
 * True when the view is fine enough for getData() to read the raster at native resolution.
 * getData() returns the rendered overview level, so when zoomed out a value can belong to
 * a neighbouring pixel.
 */
export function canReadAtNativeResolution(olMap, layer) {
  const viewInfo = layer?.get('rasterViewInfo')
  const viewResolution = olMap?.getView?.()?.getResolution()
  // Unknown grid or view resolution: allow.
  if (!viewInfo?.resolution || viewResolution == null) return true
  // Tolerance for floating-point error.
  return viewResolution <= viewInfo.resolution * 1.000001
}

// Maximum polygon area to sample (10 000 ha, in m²).
const MAX_SAMPLE_AREA_M2 = 10_000 * 10_000

/**
 * Samples a polygon from the source GeoTIFF: one windowed read over the polygon's bounding
 * box, then a pass over the cells whose centre falls inside the polygon.
 */
async function _sampleFromSource(polygon, layer, url) {
  const polygonAreaM2 = getArea(polygon)
  if (polygonAreaM2 > MAX_SAMPLE_AREA_M2) {
    return { tooBig: true, bboxArea: polygonAreaM2, maxArea: MAX_SAMPLE_AREA_M2 }
  }

  const read = await readWindowIn(url, polygon.getExtent())
  if (!read) return null

  const { values, width, height, originX, originY, resolution } = read
  const nodata = layer.get('rasterConfig')?.nodata
  const continuous = isContinuous(layer)
  const counts = {}
  const stats = createStats()
  const filledCells = new Set()
  let iterations = 0

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      if (++iterations % CHUNK_SIZE === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0))
      }

      const cx = originX + (col + 0.5) * resolution
      const cy = originY - (row + 0.5) * resolution
      if (!polygon.containsXY(cx, cy)) continue

      const value = values[row * width + col]
      if (!Number.isFinite(value)) continue
      if (nodata != null && value === nodata) continue

      if (continuous) {
        addSample(stats, value)
      } else {
        const cls = Math.round(value)
        counts[cls] = (counts[cls] ?? 0) + 1
      }
      filledCells.add(`${col},${row}`)
    }
  }

  const pixelCount = filledCells.size
  if (pixelCount === 0) return null

  // Counted cells as col/row relative to the window's top-left corner. Used to trace the
  // outline and to test whether a point lies in a counted cell (e.g. for the tree count).
  const coverage = { cells: filledCells, origin: [originX, originY], resolution }
  return continuous
    ? { stats: finalizeStats(stats), pixelCount, coverage }
    : { counts, pixelCount, coverage }
}

async function _sampleByRasterGrid(olMap, polygon, layer, viewInfo) {
  const { extent: re, resolution } = viewInfo
  const polyExtent = polygon.getExtent()

  const colMin = Math.floor((polyExtent[0] - re[0]) / resolution)
  const colMax = Math.floor((polyExtent[2] - re[0]) / resolution)
  const rowMin = Math.floor((re[3] - polyExtent[3]) / resolution)
  const rowMax = Math.floor((re[3] - polyExtent[1]) / resolution)

  const polygonAreaM2 = getArea(polygon)
  if (polygonAreaM2 > MAX_SAMPLE_AREA_M2) {
    return { tooBig: true, bboxArea: polygonAreaM2, maxArea: MAX_SAMPLE_AREA_M2 }
  }

  if (!canReadAtNativeResolution(olMap, layer)) {
    return { notSampleable: true, reason: 'zoomedOut' }
  }

  const continuous = isContinuous(layer)
  const counts = {}
  const stats = createStats()
  // Track filled cells as "col,row" strings for the boundary extractor.
  const filledCells = new Set()
  let iterations = 0
  // getData() reads the rendered canvas, so any cell outside the viewport makes the
  // sample incomplete.
  const [mapWidth, mapHeight] = olMap.getSize() ?? [0, 0]
  let offScreenCells = 0

  for (let col = colMin; col <= colMax; col++) {
    for (let row = rowMin; row <= rowMax; row++) {
      if (++iterations % CHUNK_SIZE === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0))
      }

      const cx = re[0] + (col + 0.5) * resolution
      const cy = re[3] - (row + 0.5) * resolution

      if (!polygon.containsXY(cx, cy)) continue

      const screenPx = olMap.getPixelFromCoordinate([cx, cy])
      if (!screenPx) {
        offScreenCells++
        continue
      }
      if (screenPx[0] < 0 || screenPx[1] < 0 || screenPx[0] > mapWidth || screenPx[1] > mapHeight) {
        offScreenCells++
        continue
      }

      const data = layer.getData(screenPx)
      // data[1] is the mask band (0 = nodata); the finite check covers NaN nodata.
      if (!data || data[1] === 0 || !Number.isFinite(data[0])) continue

      if (continuous) {
        addSample(stats, data[0])
      } else {
        const cls = Math.round(data[0])
        counts[cls] = (counts[cls] ?? 0) + 1
      }
      filledCells.add(`${col},${row}`)
    }
  }

  if (offScreenCells > 0) {
    return {
      notSampleable: true,
      reason: 'offScreen',
      sampledCells: filledCells.size,
      missingCells: offScreenCells,
    }
  }

  const pixelCount = filledCells.size
  if (pixelCount === 0) return null

  // Cells are keyed to the raster grid, so the origin is the raster extent's top-left.
  const coverage = { cells: filledCells, origin: [re[0], re[3]], resolution }
  return continuous
    ? { stats: finalizeStats(stats), pixelCount, coverage }
    : { counts, pixelCount, coverage }
}

/**
 * Traces the outline of all counted cells across the sampled layers.
 * Coverages on the same grid (origin and resolution) are merged; each other grid is
 * traced separately.
 */
export function traceCoveredBoundary(coverageGroups) {
  const coverages = coverageGroups.flat().filter(Boolean)
  if (coverages.length === 0) return null

  const byGrid = new Map()
  for (const { cells, origin, resolution } of coverages) {
    const key = `${origin[0]},${origin[1]},${resolution}`
    const group = byGrid.get(key) ?? { cells: new Set(), origin, resolution }
    for (const cell of cells) group.cells.add(cell)
    byGrid.set(key, group)
  }

  const rings = []
  for (const { cells, origin, resolution } of byGrid.values()) {
    const extent = [origin[0], origin[1] - 1, origin[0] + 1, origin[1]]
    rings.push(..._extractOuterBoundary(cells, extent, resolution))
  }
  return ringsToMultiPolygon(rings)
}

/**
 * Assembles traced rings into a MultiPolygon, with holes nested in their containing ring.
 *
 * A ring inside an odd number of other rings is a hole and goes to the smallest ring that
 * contains it. Nesting depth is used because the tracer's winding order is not consistent.
 */
export function ringsToMultiPolygon(rings) {
  if (!rings?.length) return null

  const area = (ring) => {
    let sum = 0
    for (let i = 0, n = ring.length - 1; i < n; i++) {
      sum += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
    }
    return Math.abs(sum / 2)
  }

  // Even-odd ray-casting point-in-ring test.
  const contains = (ring, point) => {
    const [x, y] = point
    let inside = false
    for (let i = 0, n = ring.length - 1; i < n; i++) {
      const [x1, y1] = ring[i]
      const [x2, y2] = ring[i + 1]
      if (y1 > y !== y2 > y && x < ((x2 - x1) * (y - y1)) / (y2 - y1) + x1) inside = !inside
    }
    return inside
  }

  const interiorPoint = (ring) => {
    // Midpoint of the first edge, nudged a tiny step toward the vertex centroid so the
    // test point is not on the ring's boundary.
    const [x1, y1] = ring[0]
    const [x2, y2] = ring[1]
    const mid = [(x1 + x2) / 2, (y1 + y2) / 2]
    let cx = 0
    let cy = 0
    for (let i = 0, n = ring.length - 1; i < n; i++) {
      cx += ring[i][0]
      cy += ring[i][1]
    }
    const n = ring.length - 1
    const towards = [cx / n - mid[0], cy / n - mid[1]]
    const len = Math.hypot(towards[0], towards[1]) || 1
    const step = 1e-6
    return [mid[0] + (towards[0] / len) * step, mid[1] + (towards[1] / len) * step]
  }

  const items = rings
    .map((ring) => ({ ring, area: area(ring), point: interiorPoint(ring) }))
    .sort((a, b) => b.area - a.area)

  const polygons = []
  for (const item of items) {
    // Only larger rings can contain this one
    const containers = items.filter((o) => o !== item && o.area > item.area && contains(o.ring, item.point))
    if (containers.length % 2 === 0) {
      polygons.push({ item, coordinates: [item.ring] })
      continue
    }
    // A hole belongs to its smallest container
    const owner = containers.reduce((best, o) => (best == null || o.area < best.area ? o : best), null)
    const target = polygons.find((p) => p.item === owner)
    if (target) target.coordinates.push(item.ring)
    else polygons.push({ item, coordinates: [item.ring] })
  }

  return { type: 'MultiPolygon', coordinates: polygons.map((p) => p.coordinates) }
}

/**
 * Traces the boundary of a set of filled grid cells with a directed half-edge walk.
 * Each cell edge that borders an empty cell becomes a directed segment, and segments are
 * chained into closed rings (outer boundaries and holes).
 *
 * Returns an array of closed [x, y] rings. Memory is O(perimeter).
 */
function _extractOuterBoundary(filledCells, re, resolution) {
  const has = (col, row) => filledCells.has(`${col},${row}`)

  // Boundary edges directed so the filled cell is on the right, as a list per start corner.
  // A corner where two cells touch diagonally has two outgoing edges.
  const edges = new Map()
  const addEdge = (from, to) => {
    const key = `${from[0]},${from[1]}`
    const list = edges.get(key)
    if (list) list.push(to)
    else edges.set(key, [to])
  }

  for (const cellKey of filledCells) {
    const comma = cellKey.indexOf(',')
    const col = +cellKey.slice(0, comma)
    const row = +cellKey.slice(comma + 1)

    // Top edge  → going right along the top:    (col, row)   → (col+1, row)
    if (!has(col, row - 1)) addEdge([col, row], [col + 1, row])
    // Right edge → going down along the right:  (col+1, row) → (col+1, row+1)
    if (!has(col + 1, row)) addEdge([col + 1, row], [col + 1, row + 1])
    // Bottom edge→ going left along the bottom: (col+1,row+1)→ (col, row+1)
    if (!has(col, row + 1)) addEdge([col + 1, row + 1], [col, row + 1])
    // Left edge  → going up along the left:     (col, row+1) → (col, row)
    if (!has(col - 1, row)) addEdge([col, row + 1], [col, row])
  }

  /**
   * Picks the outgoing edge that turns furthest right (right, straight, left, back).
   * This keeps regions that touch only at a corner in separate rings.
   */
  const pickNext = (corner, incoming, candidates) => {
    if (candidates.length === 1) return candidates[0]
    const rank = (to) => {
      const dx = to[0] - corner[0]
      const dy = to[1] - corner[1]
      if (!incoming) return 0
      const [ix, iy] = incoming
      // Rotating (ix, iy) a quarter turn clockwise on screen, where rows grow
      // downwards, gives (-iy, ix).
      if (dx === -iy && dy === ix) return 0 // right
      if (dx === ix && dy === iy) return 1 // straight
      if (dx === iy && dy === -ix) return 2 // left
      return 3 // back the way we came
    }
    return [...candidates].sort((a, b) => rank(a) - rank(b))[0]
  }

  const rings = []
  // Visited edges. A corner can be passed twice, once per region touching there.
  const used = new Set()

  for (const [startKey, startList] of edges) {
    for (const firstTo of startList) {
      if (used.has(`${startKey}>${firstTo[0]},${firstTo[1]}`)) continue

      const coords = []
      let corner = startKey.split(',').map(Number)
      let to = firstTo
      let incoming = null
      let limit = edges.size * 4 + 4 // safety cap

      while (limit-- > 0) {
        const edgeKey = `${corner[0]},${corner[1]}>${to[0]},${to[1]}`
        if (used.has(edgeKey)) break
        used.add(edgeKey)
        coords.push([re[0] + corner[0] * resolution, re[3] - corner[1] * resolution])

        incoming = [to[0] - corner[0], to[1] - corner[1]]
        corner = to
        const candidates = edges.get(`${corner[0]},${corner[1]}`)
        if (!candidates) break
        const unused = candidates.filter(
          (c) => !used.has(`${corner[0]},${corner[1]}>${c[0]},${c[1]}`),
        )
        if (unused.length === 0) break
        to = pickNext(corner, incoming, unused)
      }

      if (coords.length >= 3) {
        coords.push(coords[0]) // close the ring
        rings.push(coords)
      }
    }
  }

  return rings
}

async function _sampleByScreenPixels(olMap, polygon, layer) {
  const extent = polygon.getExtent()
  const topLeft = olMap.getPixelFromCoordinate([extent[0], extent[3]])
  const bottomRight = olMap.getPixelFromCoordinate([extent[2], extent[1]])
  if (!topLeft || !bottomRight) return null

  const viewResolution = olMap.getView().getResolution()
  const rastersInfo = layer.get('rastersInfo')
  const rasterRes = rastersInfo?.[0]?.resolution_x ? parseFloat(rastersInfo[0].resolution_x) : 1
  const step = Math.max(1, Math.round(rasterRes / viewResolution))

  const minPx = Math.floor(topLeft[0])
  const maxPx = Math.ceil(bottomRight[0])
  const minPy = Math.floor(topLeft[1])
  const maxPy = Math.ceil(bottomRight[1])

  const continuous = isContinuous(layer)
  const counts = {}
  const stats = createStats()
  let pixelCount = 0
  let iterations = 0

  for (let px = minPx; px <= maxPx; px += step) {
    for (let py = minPy; py <= maxPy; py += step) {
      if (++iterations % CHUNK_SIZE === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0))
      }

      const coord = olMap.getCoordinateFromPixel([px + step / 2, py + step / 2])
      if (!polygon.containsXY(coord[0], coord[1])) continue

      const data = layer.getData([px + step / 2, py + step / 2])
      if (!data || data[1] === 0 || !Number.isFinite(data[0])) continue

      if (continuous) {
        addSample(stats, data[0])
      } else {
        const cls = Math.round(data[0])
        counts[cls] = (counts[cls] ?? 0) + 1
      }
      pixelCount++
    }
  }

  if (pixelCount === 0) return null
  return continuous
    ? { stats: finalizeStats(stats), pixelCount }
    : { counts, pixelCount }
}

import MVTFormat from 'ol/format/MVT'
import { get as getProjection } from 'ol/proj'
import { createXYZ } from 'ol/tilegrid'
import { getArea } from 'ol/sphere'
import { layerGroups } from '@/config/layers.js'

const API_BASE = import.meta.env.VITE_API_BASE_URL

/**
 * Counts trees inside a polygon from the tree-top vector tiles.
 *
 * The tile server truncates each tile at TILE_FEATURE_CAP features, so the zoom is
 * chosen from the polygon size and any tile at the cap is replaced by its four children.
 */

/** Per-tile feature limit of the tile server; a tile at the limit is incomplete */
const TILE_FEATURE_CAP = 5000

/** Deepest zoom refinement may reach */
const MAX_ZOOM = 20

/** Maximum number of tiles fetched for a single count */
const MAX_TILES = 150

/** Maximum polygon area for a tree count (1000 ha, in m²) */
export const MAX_TREE_COUNT_AREA_M2 = 1000 * 10_000

/** Maximum number of concurrent tile requests */
const CONCURRENCY = 8

const tileGrid = createXYZ({ tileSize: 256, maxZoom: 22 })
const format = new MVTFormat({ idProperty: 'id' })
const projection = getProjection('EPSG:3857')

const treeConfig = layerGroups.flatMap((g) => g.layers).find((l) => l.id === 'tops')

/** Parsed tile requests, keyed by "z/x/y" */
const tileCache = new Map()

/**
 * Fetches and parses one tree-top tile.
 * Passing the tile extent to the MVT reader returns features in EPSG:3857 map coordinates.
 */
function loadTile(z, x, y) {
  const key = `${z}/${x}/${y}`
  const cached = tileCache.get(key)
  if (cached) return cached

  const request = (async () => {
    const url = `${API_BASE}/public/vectors/${treeConfig.datasetId}/tiles/${z}/${x}/${y}.pbf`
    const response = await fetch(url)
    if (!response.ok) throw new Error(`tree tile ${key}: HTTP ${response.status}`)

    // Tiles outside the dataset come back as 200 with an empty body
    const buffer = await response.arrayBuffer()
    if (buffer.byteLength === 0) return { features: [], truncated: false }

    const features = format.readFeatures(buffer, {
      extent: tileGrid.getTileCoordExtent([z, x, y]),
      featureProjection: projection,
    })
    return { features, truncated: features.length >= TILE_FEATURE_CAP }
  })()

  // Remove failed requests from the cache
  request.catch(() => tileCache.delete(key))
  tileCache.set(key, request)
  return request
}

/** Run `fn` over `items` with at most CONCURRENCY in flight, preserving order */
async function pooled(items, fn) {
  const results = Array.from({ length: items.length })
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
      for (;;) {
        const index = next++
        if (index >= items.length) return
        results[index] = await fn(items[index])
      }
    }),
  )
  return results
}

/**
 * Zoom for areas too small to subdivide, such as a single raster pixel. A z18 tile covers
 * about 106 m of ground and stays well under the feature cap.
 */
const PIXEL_ZOOM = 18

/** Coarsest zoom at which the extent spans at least four tiles, else PIXEL_ZOOM */
function startZoom(extent) {
  for (let z = 8; z < PIXEL_ZOOM; z++) {
    const range = tileGrid.getTileRangeForExtentAndZ(extent, z)
    const tiles = (range.maxX - range.minX + 1) * (range.maxY - range.minY + 1)
    if (tiles >= 4) return z
  }
  return PIXEL_ZOOM
}

/**
 * True when (x, y) falls in a cell counted by raster sampling, so trees are counted over
 * the same cells as the reported area and raster statistics.
 */
function inCoverage(coverages, x, y) {
  for (const { cells, origin, resolution } of coverages) {
    const col = Math.floor((x - origin[0]) / resolution)
    const row = Math.floor((origin[1] - y) / resolution)
    if (cells.has(`${col},${row}`)) return true
  }
  return false
}

/**
 * Counts the tree tops in a polygon, refining tiles the server truncated.
 *
 * @param {import('ol/geom/Polygon').default} polygon - in EPSG:3857
 * @param {Object}  [options]
 * @param {Array}   [options.coverages] - sampled cell sets; when given, only
 *   trees inside a counted cell are included
 * @param {boolean} [options.collect]   - also return the tree objects
 * @returns {Promise<{count: number, trees: Array, heights: number[], crownArea:
 *   number}|{tooBig: true, area: number, maxArea: number}|null>} heights in metres
 *   (one per tree), crownArea total in m²; null when the count is incomplete or a
 *   tile fails to load
 */
export async function measureTreesInPolygon(polygon, { coverages = null, collect = false } = {}) {
  if (!treeConfig?.datasetId) return null

  const area = getArea(polygon)
  if (area > MAX_TREE_COUNT_AREA_M2) {
    return { tooBig: true, area, maxArea: MAX_TREE_COUNT_AREA_M2 }
  }

  const extent = polygon.getExtent()
  let queue = []
  const z0 = startZoom(extent)
  const range = tileGrid.getTileRangeForExtentAndZ(extent, z0)
  for (let x = range.minX; x <= range.maxX; x++) {
    for (let y = range.minY; y <= range.maxY; y++) queue.push([z0, x, y])
  }

  // Tiles include a buffer past their edge, so trees are deduplicated by feature ID.
  const seen = new Set()
  const trees = []
  let count = 0
  let spent = 0

  // Per-tree heights, needed for top height (mean of the 100 tallest trees per hectare).
  const heights = []

  // Total crown area in m²
  let crownArea = 0

  while (queue.length > 0) {
    spent += queue.length
    if (spent > MAX_TILES) return null

    let tiles
    try {
      tiles = await pooled(queue, ([z, x, y]) => loadTile(z, x, y))
    } catch {
      return null
    }

    const refined = []
    for (const [index, tile] of tiles.entries()) {
      const [z, x, y] = queue[index]
      if (tile.truncated) {
        // Still truncated at the deepest zoom, so the count cannot be completed.
        if (z >= MAX_ZOOM) return null
        for (const dx of [0, 1]) {
          for (const dy of [0, 1]) refined.push([z + 1, 2 * x + dx, 2 * y + dy])
        }
        continue
      }

      for (const feature of tile.features) {
        const flat = feature.getFlatCoordinates()
        if (!flat || flat.length < 2) continue

        const [fx, fy] = flat
        if (coverages ? !inCoverage(coverages, fx, fy) : !polygon.containsXY(fx, fy)) continue

        const id = feature.getId()
        if (id !== undefined) {
          if (seen.has(id)) continue
          seen.add(id)
        }
        count++

        const properties = feature.getProperties()
        if (Number.isFinite(properties.height)) heights.push(properties.height)
        if (Number.isFinite(properties.area)) crownArea += properties.area

        // The coordinate is kept so a selected tree can be marked on the map.
        if (collect) trees.push({ id, coordinate: [fx, fy], properties })
      }
    }
    queue = refined
  }

  return { count, trees, heights, crownArea }
}

/** Tree tops inside `polygon` as objects, e.g. to list the trees in a single raster pixel */
export async function collectTreesInPolygon(polygon, options = {}) {
  const result = await measureTreesInPolygon(polygon, { ...options, collect: true })
  return result && !result.tooBig ? result : null
}

/** Tree total inside `polygon`, or null when it cannot be counted exactly */
export async function countTreesInPolygon(polygon, options = {}) {
  const result = await measureTreesInPolygon(polygon, options)
  return result && !result.tooBig ? result.count : null
}

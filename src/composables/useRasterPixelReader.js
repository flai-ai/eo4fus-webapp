import { fromUrl } from 'geotiff'

/**
 * Reads raster values directly from the source GeoTIFF, independent of the rendered layer
 * and zoom level. The files are tiled, so only the needed blocks are fetched, and geotiff.js
 * caches decoded blocks.
 */

/** url → Promise<GeoTIFFImage> for the full-resolution image (directory 0) */
const imageCache = new Map()

function fullResImage(url) {
  let pending = imageCache.get(url)
  if (!pending) {
    pending = fromUrl(url).then((tiff) => tiff.getImage(0))
    imageCache.set(url, pending)
  }
  return pending
}

/**
 * Pixel column/row containing a map coordinate, or null when it falls outside.
 * The rasters are in EPSG:3857 (the map projection), so no reprojection is needed.
 */
function pixelIndex(image, [x, y]) {
  const [minX, , , maxY] = image.getBoundingBox()
  const [resX, resY] = image.getResolution()
  const col = Math.floor((x - minX) / Math.abs(resX))
  const row = Math.floor((maxY - y) / Math.abs(resY))
  if (col < 0 || row < 0 || col >= image.getWidth() || row >= image.getHeight()) return null
  return [col, row]
}

/**
 * Reads every source pixel overlapping `extent` in one request.
 *
 * Returns the values with the grid they sit on, or null when the extent is outside the
 * raster or the read fails.
 *
 * @param {string} url - presigned URL of the GeoTIFF
 * @param {number[]} extent - [minX, minY, maxX, maxY] in EPSG:3857
 * @returns {Promise<{values: ArrayLike<number>, width: number, height: number, originX: number, originY: number, resolution: number}|null>}
 */
export async function readWindowIn(url, extent) {
  try {
    const image = await fullResImage(url)
    const [rMinX, , , rMaxY] = image.getBoundingBox()
    const [resX, resY] = image.getResolution()
    const resolution = Math.abs(resX)

    const clamp = (v, max) => Math.max(0, Math.min(max, v))
    const left = clamp(Math.floor((extent[0] - rMinX) / resolution), image.getWidth())
    const right = clamp(Math.ceil((extent[2] - rMinX) / resolution), image.getWidth())
    const top = clamp(Math.floor((rMaxY - extent[3]) / Math.abs(resY)), image.getHeight())
    const bottom = clamp(Math.ceil((rMaxY - extent[1]) / Math.abs(resY)), image.getHeight())
    if (right <= left || bottom <= top) return null

    const [values] = await image.readRasters({
      window: [left, top, right, bottom],
      samples: [0],
    })

    return {
      values,
      width: right - left,
      height: bottom - top,
      originX: rMinX + left * resolution,
      originY: rMaxY - top * Math.abs(resY),
      resolution,
    }
  } catch (err) {
    console.error('Reading raster window failed', err)
    return null
  }
}

/**
 * Value of the single source pixel containing `coordinate`.
 * Null when the coordinate is outside the raster, the pixel is nodata, or the read fails.
 *
 * @param {string} url - presigned URL of the GeoTIFF, as handed to the layer
 * @param {number[]} coordinate - [x, y] in EPSG:3857
 * @param {number|undefined} nodata - configured nodata value, if any
 * @returns {Promise<number|null>}
 */
export async function readPixelAt(url, coordinate, nodata) {
  try {
    const image = await fullResImage(url)
    const index = pixelIndex(image, coordinate)
    if (!index) return null
    const [col, row] = index

    const [band] = await image.readRasters({
      window: [col, row, col + 1, row + 1],
      samples: [0],
    })
    const value = band?.[0]

    // The finite check covers NaN nodata.
    if (value == null || !Number.isFinite(value)) return null
    if (nodata != null && value === nodata) return null
    return value
  } catch (err) {
    console.error('Reading raster pixel failed', err)
    return null
  }
}

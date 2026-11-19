import { transform } from 'ol/proj'
import { getWfsQueryConfigs } from '@/config/layers.js'

const WFS_QUERY_CONFIGS = getWfsQueryConfigs()

function pointInRing(point, ring) {
  const [px, py] = point
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

function featureIntersectsPoint(feature, point) {
  const geom = feature.geometry
  if (!geom) return true
  const { type, coordinates } = geom
  if (type === 'Polygon') return pointInRing(point, coordinates[0])
  if (type === 'MultiPolygon') return coordinates.some((poly) => pointInRing(point, poly[0]))
  return true
}

function ringsIntersect(ringA, ringB) {
  if (ringA.some((pt) => pointInRing(pt, ringB))) return true
  if (ringB.some((pt) => pointInRing(pt, ringA))) return true
  return false
}

function featureIntersectsRing(feature, ring) {
  const geom = feature.geometry
  if (!geom) return true
  const { type, coordinates } = geom
  if (type === 'Polygon') return ringsIntersect(ring, coordinates[0])
  if (type === 'MultiPolygon') return coordinates.some((poly) => ringsIntersect(ring, poly[0]))
  return true
}

/**
 * Query all WFS layers within the given EPSG:3857 bbox string
 * (format: "minX,minY,maxX,maxY,EPSG:3857").
 * Returns GeoJSON-like feature objects ready for the popup.
 * count: max features per layer (omit for server default)
 * filterGeometry: post-filter results by spatial match (all in EPSG:3857):
 *   [x, y]        point: keep features that contain the point
 *   [[x,y], ...]  polygon ring: keep features that intersect the ring
 */
export async function queryWfsWithBbox(bbox, coordinate, signal, count = null, filterGeometry = null) {
  const results = await Promise.allSettled(
    WFS_QUERY_CONFIGS.map(async (config) => {
      const countParam = count != null ? `&count=${count}` : ''
      const propertyParam = config.wfsQuery.properties?.length
        ? `&propertyName=${config.wfsQuery.properties.join(',')}`
        : ''
      const url =
        `${config.wfsQuery.url}?service=WFS&version=2.0.0&request=GetFeature` +
        `&typeName=${config.wfsQuery.typeName}&outputFormat=application/json${countParam}${propertyParam}&bbox=${bbox}`
      const res = await fetch(url, { signal })
      const json = await res.json()
      return { layerId: config.id, features: json.features ?? [] }
    }),
  )

  let wfsFilter = null
  if (filterGeometry) {
    if (Array.isArray(filterGeometry[0])) {
      wfsFilter = { type: 'ring', ring: filterGeometry.map((pt) => transform(pt, 'EPSG:3857', 'EPSG:3794')) }
    } else {
      wfsFilter = { type: 'point', point: transform(filterGeometry, 'EPSG:3857', 'EPSG:3794') }
    }
  }

  return results
    .filter((r) => r.status === 'fulfilled')
    .flatMap(({ value: { layerId, features } }) =>
      features
        .filter((f) => {
          if (!wfsFilter) return true
          if (wfsFilter.type === 'ring') return featureIntersectsRing(f, wfsFilter.ring)
          return featureIntersectsPoint(f, wfsFilter.point)
        })
        .map((f) => ({
          featureId: f.id ?? f.properties?.id ?? null,
          layerId,
          coordinate,
          properties: f.properties ?? {},
          geometryType: f.geometry?.type ?? null,
          geometry: f.geometry ?? null,
        })),
    )
}

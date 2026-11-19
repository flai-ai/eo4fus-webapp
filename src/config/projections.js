import proj4 from 'proj4'
import { register } from 'ol/proj/proj4'
import { get as getProjection } from 'ol/proj'

proj4.defs(
  'EPSG:3794',
  '+proj=tmerc +lat_0=0 +lon_0=15 +k=0.9999 +x_0=500000 +y_0=-5000000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs',
)

register(proj4)

/**
 * Assert that a projection is registered with OpenLayers.
 * Throws a descriptive error if not found, so misconfigured SRIDs are caught early.
 */
export function assertProjection(srid) {
  const proj = getProjection(srid)
  if (!proj) {
    throw new Error(`Projection "${srid}" is not registered. Add its proj4 definition to src/config/projections.js.`)
  }
  return proj
}

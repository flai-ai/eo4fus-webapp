/**
 * Layer group definitions for the layer panel.
 * Each group has a labelKey and a list of layers; display names are i18n keys.
 *
 * type: 'base' | 'wms' | 'vector-tile' | 'raster'
 * base: true for radio-button base layers (OSM / ortofoto)
 * wms: { url, params, serverType } display config for WMS layers
 * wfsQuery: { url, typeName } queried with a small-bbox GetFeature on map click
 * datasetId: UUID string for vector-tile/raster layers
 * residualSd: model residual standard deviation, in the layer's unit
 * classSet: CLASS_SETS key (config/palette.js) for a classified raster's classes
 * pixelLabelKey: label for a single classified pixel value in the results
 * shortLabelKey: abbreviation shown in the layer list and results tables ('' if none)
 */

/**
 * Relative error of a continuous prediction in percent (100 * residualSd / value),
 * or null if the layer has no residualSd. Returns 0 for a zero prediction and is
 * not capped at 100. Valid for single pixels only, not for polygon aggregates.
 */
export function relativeErrorPct(value, config) {
  const sd = config?.residualSd
  if (sd == null || !Number.isFinite(value)) return null
  if (value <= 0) return 0
  return (100 * sd) / value
}
/** Build a Map<layerId, labelKey> for i18n translation */
export function getLayerLabelKeyMap() {
  const map = new Map()
  for (const group of layerGroups) {
    for (const layer of group.layers) {
      map.set(layer.id, layer.labelKey)
    }
  }
  return map
}

/** Build a Map<layerId, shortLabelKey> for the layers that have an abbreviation */
export function getLayerShortLabelKeyMap() {
  const map = new Map()
  for (const group of layerGroups) {
    for (const layer of group.layers) {
      if (layer.shortLabelKey) map.set(layer.id, layer.shortLabelKey)
    }
  }
  return map
}

/** Set of layer IDs that should never appear in popup results */
export function getPopupIgnoredLayerIds() {
  const ids = new Set()
  for (const group of layerGroups) {
    for (const layer of group.layers) {
      if (layer.popupIgnored) ids.add(layer.id)
    }
  }
  return ids
}

/** Array of raster layer configs (type === 'raster') */
export function getRasterLayerConfigs() {
  return layerGroups.flatMap((g) => g.layers).filter((l) => l.type === 'raster' && l.datasetId)
}

/** Layers that should be queried via WFS GetFeature on map click */
export function getWfsQueryConfigs() {
  return layerGroups.flatMap((g) => g.layers).filter((l) => l.wfsQuery)
}

/** Build a Map<layerId, color> from all layer groups */
export function getLayerColorMap() {
  const map = new Map()
  for (const group of layerGroups) {
    for (const layer of group.layers) {
      if (layer.color) map.set(layer.id, layer.color)
    }
  }
  return map
}

/** Array of raster layer configs whose pixel values are continuous, not classes */
export function getContinuousRasterConfigs() {
  return getRasterLayerConfigs().filter((l) => l.valueType === 'continuous')
}

const WMS_BASE = 'https://prostor.zgs.gov.si/geoserver/wms'
const WFS_BASE = 'https://prostor.zgs.gov.si/geoserver/wfs'

function wmsOverlay(layerName) {
  return {
    url: WMS_BASE,
    params: {
      LAYERS: layerName,
      FORMAT: 'image/png',
      TRANSPARENT: true,
      VERSION: '1.3.0',
      TILED: true,
    },
    serverType: 'geoserver',
  }
}

export const layerGroups = [
  {
    id: 'base',
    labelKey: 'layerGroups.base',
    layers: [
      { id: 'osm', labelKey: 'layers.osm', type: 'base', base: true },
      {
        id: 'ortofoto',
        labelKey: 'layers.ortofoto',
        shortLabelKey: 'layers.short.ortofoto',
        type: 'wms',
        base: true,
        wms: {
          url: WMS_BASE,
          params: {
            LAYERS: 'pregledovalnik:DOF25',
            FORMAT: 'image/jpeg',
            VERSION: '1.3.0',
            TILED: true,
          },
          serverType: 'geoserver',
        },
      },
      {
        id: 'dmr',
        labelKey: 'layers.dmr',
        shortLabelKey: 'layers.short.dmr',
        type: 'wms',
        base: true,
        popupIgnored: true,
        wms: {
          url: WMS_BASE,
          params: {
            LAYERS: 'DMR',
            FORMAT: 'image/png',
            TRANSPARENT: true,
            VERSION: '1.3.0',
            TILED: true,
          },
          serverType: 'geoserver',
        },
      },
      {
        id: 'dof-ir',
        labelKey: 'layers.dofIr',
        shortLabelKey: 'layers.short.dofIr',
        type: 'wms',
        base: true,
        popupIgnored: true,
        wms: {
          url: WMS_BASE,
          params: { LAYERS: 'DOF_IR', FORMAT: 'image/jpeg', VERSION: '1.3.0', TILED: true },
          serverType: 'geoserver',
        },
      },
    ],
  },
  {
    id: 'forest',
    labelKey: 'layerGroups.forest',
    layers: [
      {
        id: 'tops',
        labelKey: 'layers.tops',
        type: 'vector-tile',
        datasetId: 'd9545433-40f6-4c7b-88f9-c36ddee6030c',
        color: '#7cb342',
        alwaysQueryable: true,
      },
      // numClasses is the highest class value (classes 0-6). All rasters in this group share
      // one grid (cell 14.405633 m), so their pixels line up.
      {
        id: 'tree-type',
        labelKey: 'layers.treeType',
        type: 'raster',
        valueType: 'classified',
        datasetId: 'f46dff8a-be30-413e-8ab7-7826d263f8c4',
        color: '#546e7a',
        classSet: 'species',
        pixelLabelKey: 'results.treeSpecies',
        numClasses: 6,
        nodata: 111,
      },
      // Classes 0-3. Overviews also contain -1, 4 and 5 in a few cells, which get the
      // fallback colour.
      {
        id: 'species-mixture',
        labelKey: 'layers.speciesMixture',
        type: 'raster',
        valueType: 'classified',
        datasetId: '2ef070ad-57c8-4f37-8a33-9d8139e86d83',
        color: '#8d6e63',
        classSet: 'mixture',
        pixelLabelKey: 'results.speciesMixture',
        numClasses: 3,
        nodata: 111,
      },
      // Overviews are precomputed (mean of the valid cells below each cell). Do not regenerate
      // them: nodata is NaN, which GDAL cannot skip when resampling.
      {
        id: 'agb',
        labelKey: 'layers.agb',
        shortLabelKey: 'layers.short.agb',
        type: 'raster',
        valueType: 'continuous',
        datasetId: '3f5b826b-010f-4663-904a-89d99c05fb9f',
        color: '#2e7d32',
        unitKey: 'units.tPerHa',
        rampMin: 0,
        rampMax: 300,
        decimals: 1,
        residualSd: 84.643,
      },
      // Same forest mask and precomputed overviews as 'agb'.
      {
        id: 'volume',
        labelKey: 'layers.volume',
        shortLabelKey: 'layers.short.volume',
        type: 'raster',
        valueType: 'continuous',
        datasetId: 'a4a17b51-4268-4af6-959f-59782a8ba438',
        color: '#00695c',
        unitKey: 'units.m3PerHa',
        rampMin: 0,
        rampMax: 550,
        decimals: 1,
        residualSd: 160.651,
      },
    ],
  },
  {
    id: 'divisions',
    labelKey: 'layerGroups.divisions',
    layers: [
      {
        id: 'ggo',
        labelKey: 'layers.ggo',
        shortLabelKey: 'layers.short.ggo',
        type: 'wms',
        color: '#1b5e20',
        wms: wmsOverlay('pregledovalnik:ggo'),
        wfsQuery: { url: WFS_BASE, typeName: 'pregledovalnik:ggo' },
      },
      {
        id: 'gge',
        labelKey: 'layers.gge',
        shortLabelKey: 'layers.short.gge',
        type: 'wms',
        color: '#388e3c',
        wms: wmsOverlay('pregledovalnik:gge'),
        wfsQuery: {
          url: WFS_BASE,
          typeName: 'pregledovalnik:gge',
          properties: ['gge_naziv', 'geom'],
        },
      },
      {
        id: 'odseki-gozdni',
        labelKey: 'layers.forestCompartments',
        type: 'wms',
        color: '#33691e',
        wms: wmsOverlay('pregledovalnik:odseki_gozdni'),
        wfsQuery: {
          url: WFS_BASE,
          typeName: 'pregledovalnik:odseki_gozdni',
          properties: ['odsek', 'geom'],
        },
      },
    ],
  },
  {
    id: 'routes',
    labelKey: 'layerGroups.routes',
    layers: [
      {
        id: 'gozdne-ceste',
        labelKey: 'layers.forestRoads',
        type: 'wms',
        color: '#795548',
        popupIgnored: true,
        wms: wmsOverlay('pregledovalnik:gozdne_ceste'),
      },
      {
        id: 'gji-poti',
        labelKey: 'layers.publicPaths',
        shortLabelKey: 'layers.short.publicPaths',
        type: 'wms',
        color: '#f57f17',
        popupIgnored: true,
        wms: wmsOverlay('pregledovalnik:gji_poti'),
      },
      {
        id: 'gji-ceste',
        labelKey: 'layers.publicRoads',
        shortLabelKey: 'layers.short.publicRoads',
        type: 'wms',
        color: '#e64a19',
        popupIgnored: true,
        wms: wmsOverlay('pregledovalnik:gji_ceste'),
      },
    ],
  },
]

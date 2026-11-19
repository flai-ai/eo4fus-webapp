import { computed, reactive, ref, watch } from 'vue'
import { layerGroups, getRasterLayerConfigs } from '@/config/layers.js'

/** Raster layers are mutually exclusive (they all paint opaquely at the same zIndex) */
const RASTER_IDS = getRasterLayerConfigs().map((l) => l.id)
const RASTER_ID_SET = new Set(RASTER_IDS)

/** True for layers that take part in the mutually exclusive raster selection */
export function isRasterLayer(id) {
  return RASTER_ID_SET.has(id)
}

/** Active base layer ID (radio selection), DOF by default */
export const activeBaseLayer = ref('ortofoto')

/**
 * User-set opacity (0-1) shared by all raster layers. Hidden rasters use OL opacity 0,
 * so the two are combined in useRasterLayers.js.
 */
export const rasterOpacity = ref(1)

/** Build initial visibility state for non-base layers */
function buildInitialState() {
  const state = {}
  for (const group of layerGroups) {
    for (const layer of group.layers) {
      if (!layer.base) {
        state[layer.id] = false
      }
    }
  }
  return state
}

const visibility = reactive(buildInitialState())

// Turning one raster on turns the others off; all of them may be off.
watch(
  () => RASTER_IDS.map((id) => visibility[id]),
  (values, previous) => {
    const turnedOn = values.findIndex((visible, i) => visible && !previous?.[i])
    if (turnedOn === -1) return
    for (const [i, id] of RASTER_IDS.entries()) {
      if (i !== turnedOn) visibility[id] = false
    }
  },
)

/** The single visible raster, or null when none is on. Setting null turns all rasters off. */
export const activeRaster = computed({
  get: () => RASTER_IDS.find((id) => visibility[id]) ?? null,
  set: (id) => {
    for (const rasterId of RASTER_IDS) {
      visibility[rasterId] = rasterId === id
    }
  },
})

export function useLayerVisibility() {
  return { visibility, activeBaseLayer, activeRaster, rasterOpacity }
}

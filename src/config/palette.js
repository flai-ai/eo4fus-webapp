/**
 * Colours that encode data.
 *
 * - `CONTINUOUS_RAMP`: sequential ramp for biomass and growing stock
 * - `SPECIES_PALETTE`: categorical palette for tree species
 * - `MIXTURE_PALETTE`: ordered palette for the broadleaf-to-conifer mixture classes
 * - `CLASS_SETS`: ties each palette to its class labels
 *
 * Layer colours are the `color` fields in `layers.js`; UI colours are in `assets/base.css`.
 */

/** Species classes in raster class order (Okabe-Ito, colour-blind safe) */
export const SPECIES_PALETTE = [
  '#D55E00', // 0 beech        vermillion
  '#0072B2', // 1 spruce       blue
  '#56B4E9', // 2 fir          sky
  '#009E73', // 3 pine         bluish green
  '#E69F00', // 4 oak          orange
  '#F0E442', // 5 mixed broadleaves  yellow
  '#CC79A7', // 6 mixed conifers     reddish purple
]

/**
 * Species-mixture classes 0-3 in raster class order (ColorBrewer BrBG, 4 classes).
 * Other values produced by the overviews use CLASS_FALLBACK.
 */
export const MIXTURE_PALETTE = [
  '#A6611A', // 0 broadleaves            brown
  '#DFC27D', // 1 mixed, mainly broadleaves  tan
  '#80CDC1', // 2 mixed, mainly conifers     pale teal
  '#018571', // 3 conifers               teal
]

/** Classes a raster holds but its palette does not name */
export const CLASS_FALLBACK = '#9e9e9e'

/** Alias of CLASS_FALLBACK for the species layer */
export const SPECIES_FALLBACK = CLASS_FALLBACK

/**
 * Palette and class label keys for each classified layer, keyed by its `classSet`.
 * Used by the legend, the map style and the results panel.
 */
export const CLASS_SETS = {
  species: {
    palette: SPECIES_PALETTE,
    labelKeys: [
      'treeSpecies.beech',
      'treeSpecies.spruce',
      'treeSpecies.fir',
      'treeSpecies.pine',
      'treeSpecies.oak',
      'treeSpecies.mixedBroadleaves',
      'treeSpecies.mixedConifers',
    ],
  },
  mixture: {
    palette: MIXTURE_PALETTE,
    labelKeys: [
      'speciesMixture.class0',
      'speciesMixture.class1',
      'speciesMixture.class2',
      'speciesMixture.class3',
    ],
  },
}

/** Palette for a classSet, falling back to species for a layer without one */
export function classPalette(classSet) {
  return CLASS_SETS[classSet]?.palette ?? SPECIES_PALETTE
}

/**
 * Sequential ramp for the continuous rasters (ColorBrewer YlGn), stretched over each
 * layer's range and clamped at both ends.
 */
export const CONTINUOUS_RAMP = [
  [0, '#ffffcc'],
  [0.25, '#c2e699'],
  [0.5, '#78c679'],
  [0.75, '#31a354'],
  [1, '#006837'],
]

<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { useResizeObserver } from '@vueuse/core'
import { useI18n } from 'vue-i18n'
import Button from 'primevue/button'
import { useResultsPanel } from '@/composables/useResultsPanel.js'
import { useValueFormat } from '@/composables/useValueFormat.js'
import {
  selectedFeatureId,
  selectedLayerId,
  selectedFeatureGeometry,
} from '@/composables/useFeatureInteraction.js'
import { useClassLabels } from '@/composables/useClassLabels.js'
import { classPalette } from '@/config/palette.js'
import {
  getLayerLabelKeyMap,
  getLayerShortLabelKeyMap,
  getRasterLayerConfigs,
} from '@/config/layers.js'
import { usePointCloud } from '@/composables/usePointCloud.js'
import { toLonLat } from 'ol/proj'
import PointCloudViewer from '../PointCloudViewer.vue'

const { t, te } = useI18n()
const {
  tabs,
  activeTabId,
  selectedFeature,
  selectedGeometry,
  classBlocks,
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
  pixelGeometry,
  activeFeatureId,
  rasterStats,
  ctx,
  activeTabLayerId,
  close,
  setActiveTab,
  closeTab,
} = useResultsPanel()
const { pointcloudId, aoi, isPreviewOpen, togglePreview, expand } = usePointCloud()

const { numberLocale, formatQuantity, formatErrorPct, absoluteUnit } = useValueFormat()
const { classLabel } = useClassLabels()
const layerLabelKeys = getLayerLabelKeyMap()
const layerShortLabelKeys = getLayerShortLabelKeyMap()
const RASTER_CONFIGS = getRasterLayerConfigs()

/** Absolute model uncertainties (residual SD) from the layer configs, for the note */
const residualSds = computed(() => {
  const sdFor = (id) => RASTER_CONFIGS.find((c) => c.id === id)?.residualSd
  const agb = sdFor('agb')
  const volume = sdFor('volume')
  if (agb == null || volume == null) return null
  return {
    agb: Math.round(agb).toLocaleString(numberLocale.value),
    volume: Math.round(volume).toLocaleString(numberLocale.value),
  }
})

/** Singular label for a classified value on one cell (pixelLabelKey), else the layer name */
function pixelClassLabel(layerId) {
  const key = RASTER_CONFIGS.find((c) => c.id === layerId)?.pixelLabelKey
  return key ? t(key) : layerLabel(layerId)
}

/** Translated layer name, resolved on render so it follows the language toggle */
function layerLabel(layerId) {
  const key = layerLabelKeys.get(layerId)
  return key ? t(key) : layerId
}

/** Layer abbreviation for a table's first column, falling back to the full name */
function layerShortLabel(layerId) {
  const key = layerShortLabelKeys.get(layerId)
  const short = key ? t(key) : ''
  return short || layerLabel(layerId)
}

/** Format a measured value with the given precision, without a unit suffix */
function formatNumber(value, decimals = 1) {
  return value.toLocaleString(numberLocale.value, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

/** Total with one decimal below 100, whole units from 100 up */
function formatTotal(value) {
  return value >= 100
    ? Math.round(value).toLocaleString(numberLocale.value)
    : formatNumber(value, 1)
}

/** Area in m² as hectares, up to two decimals */
function formatHectares(m2) {
  return `${(m2 / 10_000).toLocaleString(numberLocale.value, { maximumFractionDigits: 2 })} ha`
}

/** Height in metres, one decimal */
function formatHeight(metres) {
  return `${formatNumber(metres, 1)} m`
}

/** Per-hectare units drop their "/ha" when reporting an absolute total */
function totalUnit(unit) {
  return unit.replace(/\/ha$/, '')
}

/** Min-max range of a layer's values, in whole units */
function formatRange(min, max) {
  const round = (v) => Math.round(v).toLocaleString(numberLocale.value)
  return `${round(min)}–${round(max)}`
}

/** Share of the ground area, to whole percent (crown totals can exceed 100 %) */
function formatShareOfGround(pct) {
  return t('results.shareOfGround', { pct: Math.round(pct).toLocaleString(numberLocale.value) })
}

/** Trees per hectare, rounded to whole trees */
function formatDensity(perHectare) {
  return `${Math.round(perHectare).toLocaleString(numberLocale.value)} /ha`
}

/** Crown area in m², one decimal */
function formatCrownArea(m2) {
  return `${formatNumber(m2, 1)} m²`
}

/**
 * Mark a listed tree on the map, or unmark it if already marked. Only sets the
 * selection state (useSelectionMarker draws it); no results tab is opened.
 */
function toggleTreeOnMap(tree) {
  if (selectedFeatureId.value === tree.id) {
    selectedFeatureId.value = null
    selectedLayerId.value = null
    selectedFeatureGeometry.value = null
    return
  }
  selectedFeatureId.value = tree.id
  selectedLayerId.value = 'tops'
  selectedFeatureGeometry.value = tree.coordinate
    ? { type: 'Point', coordinates: tree.coordinate }
    : null
}

/** Compartments covered by the selection, clamped to two lines with a show-all toggle */
const odsekList = computed(() => ctx.value.odseki ?? [])
const odsekNames = computed(() => odsekList.value.join(', '))
const odsekExpanded = ref(false)
const odsekEl = ref(null)
/** True when the two-line clamp hides some names, measured on the rendered element */
const odsekClipped = ref(false)

function measureOdsekRow() {
  const el = odsekEl.value
  // Only measurable while collapsed; when expanded the previous flag is kept.
  if (!el || odsekExpanded.value) return
  odsekClipped.value = el.scrollHeight - el.clientHeight > 1
}

// Re-measure on first render and on resize
useResizeObserver(odsekEl, measureOdsekRow)

// Collapse on a new selection and re-measure once it has rendered
watch([odsekNames, activeTabId], () => {
  odsekExpanded.value = false
  nextTick(measureOdsekRow)
})

const classifiedValues = computed(
  () => pixelValues.value?.filter((v) => v.valueType === 'classified') ?? [],
)
const continuousValues = computed(
  () => pixelValues.value?.filter((v) => v.valueType === 'continuous') ?? [],
)

const pixelCentre = computed(() => {
  // Single-cell clicks only
  if (!pixelValues.value?.length) return null
  // Same geometry precedence as usePointCloud
  const ring = (pixelGeometry.value ?? selectedGeometry.value)?.coordinates?.[0]
  if (!ring?.length) return null
  // Drop the ring's closing duplicate corner before averaging
  const corners = ring.slice(0, 4)
  const cx = corners.reduce((sum, [x]) => sum + x, 0) / corners.length
  const cy = corners.reduce((sum, [, y]) => sum + y, 0) / corners.length
  const [lon, lat] = toLonLat([cx, cy])
  return { lon, lat }
})

/** Lon/lat in degrees to five decimals, in the same format as the map's status bar */
function formatCoordinate({ lon, lat }) {
  const deg = (v) => v.toFixed(5).replace('.', numberLocale.value === 'sl-SI' ? ',' : '.')
  return `${deg(lon)}° E, ${deg(lat)}° N`
}

function formatFeatureKey(key) {
  if (activeTabLayerId.value === 'tops' && key === 'area') return t('results.featureKeys.crownArea')
  const translationKey = `results.featureKeys.${key}`
  return te(translationKey) ? t(translationKey) : key
}

function formatFeatureValue(key, value) {
  if (activeTabLayerId.value === 'tops' && typeof value === 'number') {
    // Locale-aware, so the decimal separator follows the language
    if (key === 'height') return `${formatNumber(value, 3)} m`
    if (key === 'area') return `${formatNumber(value, 2)} m²`
  }
  return value
}

function formatArea(m2) {
  const ha = m2 / 10_000
  return `${Math.round(m2).toLocaleString(numberLocale.value)} m² (${ha.toLocaleString(numberLocale.value, { maximumFractionDigits: 2 })} ha)`
}

/**
 * Feature attributes hidden from the table, per layer. A tree top's `layer` is the
 * MVT layer name ("default"), not a measurement.
 */
const HIDDEN_FEATURE_KEYS = { tops: new Set(['layer']) }

const visibleFeature = computed(() => {
  const feature = selectedFeature.value
  if (!feature) return null
  const hidden = HIDDEN_FEATURE_KEYS[activeTabLayerId.value]
  if (!hidden) return feature
  return Object.fromEntries(Object.entries(feature).filter(([key]) => !hidden.has(key)))
})

/** True for a multi-cell sample (drawn area or compartment), not a single clicked cell */
const isAreaSample = computed(
  () =>
    !pixelValues.value?.length && (rasterStats.value?.length > 0 || classCharts.value.length > 0),
)

/** Trees per hectare of the ground they were counted over */
const treeDensity = computed(() => {
  if (treeCount.value == null || !treeArea.value) return null
  return treeCount.value / (treeArea.value / 10_000)
})

/**
 * Summed crown area as a percentage of the counted ground. Crowns overlap, so this
 * can exceed 100 %.
 */
const crownShare = computed(() => {
  if (treeCrownArea.value == null || !treeArea.value) return null
  return (treeCrownArea.value / treeArea.value) * 100
})

/**
 * Trees per hectare in each 5 m height class, or plain counts when the counted
 * ground is unknown.
 */
const heightBins = computed(() => {
  const bins = treeHeights.value?.bins
  if (!bins?.length) return []
  const total = bins.reduce((sum, bin) => sum + bin.count, 0)
  if (!total) return []
  const hectares = treeArea.value ? treeArea.value / 10_000 : null
  return bins.map((bin) => ({
    label: `${bin.from}–${bin.to}`,
    count: bin.count,
    pct: (bin.count / total) * 100,
    value: hectares ? bin.count / hectares : bin.count,
  }))
})

/** True when the histogram axis is in trees per hectare */
const histogramIsDensity = computed(() => treeArea.value != null && treeArea.value > 0)

/** Round up to 1, 2, 2.5, 5 or 10 times a power of ten */
function niceCeil(value) {
  if (!(value > 0)) return 1
  const magnitude = 10 ** Math.floor(Math.log10(value))
  for (const step of [1, 2, 2.5, 5, 10]) {
    if (value <= step * magnitude) return step * magnitude
  }
  return 10 * magnitude
}

/** Axis maximum: the tallest bar rounded up with niceCeil */
const histogramMax = computed(() => niceCeil(Math.max(0, ...heightBins.value.map((b) => b.value))))

/** Axis ticks at zero, half and maximum */
const histogramTicks = computed(() => {
  const max = histogramMax.value
  return [0, max / 2, max].map((value) => ({
    value,
    label: value.toLocaleString(numberLocale.value, { maximumFractionDigits: max < 10 ? 1 : 0 }),
    pos: max > 0 ? (value / max) * 100 : 0,
  }))
})

/**
 * One chart per classified raster: class shares of the selection, coloured as on the map.
 * Classes without a palette colour get a neutral bar.
 */
const classCharts = computed(() =>
  (classBlocks.value ?? []).map((block) => {
    const total = Object.values(block.counts).reduce((sum, n) => sum + n, 0)
    const palette = classPalette(block.classSet)
    return {
      layerId: block.layerId,
      label: block.label,
      items: Object.entries(block.counts)
        .map(([k, count]) => ({
          label: classLabel(block.classSet, +k),
          color: palette[+k] ?? null,
          count,
          pct: total > 0 ? (count / total) * 100 : 0,
        }))
        .sort((a, b) => b.count - a.count),
    }
  }),
)
</script>

<template>
  <aside class="results-panel">
    <div class="results-panel__header">
      <span class="results-panel__title">{{ t('results.title') }}</span>
      <Button
        icon="pi pi-times"
        text
        rounded
        severity="secondary"
        size="small"
        :aria-label="t('results.close')"
        @click="close"
      />
    </div>

    <p class="results-panel__disclaimer">
      <i class="pi pi-info-circle" />
      {{ t('results.disclaimer') }}
    </p>

    <div
      v-if="tabs.length"
      class="results-panel__tabs"
    >
      <button
        v-for="tab in tabs"
        :key="tab.id"
        class="results-tab"
        :class="{ 'results-tab--active': tab.id === activeTabId }"
        @click="setActiveTab(tab.id)"
      >
        <span class="results-tab__label">{{ tab.label }}</span>
        <span
          class="results-tab__close"
          @click.stop="closeTab(tab.id)"
        >
          <i
            class="pi pi-times"
            style="font-size: 0.6rem"
          />
        </span>
      </button>
    </div>

    <div
      v-if="
        ctx.loading ||
        ctx.ggo ||
        ctx.gge ||
        odsekList.length ||
        ctx.area != null ||
        treeCount != null ||
        treeCountUnavailable
      "
      class="results-panel__context"
    >
      <template v-if="ctx.loading">
        <div class="results-context-row results-context-row--loading">
          <span class="results-loading-dot" />
          <span class="results-context-key">{{ t('results.loading') }}</span>
        </div>
      </template>
      <template v-else>
        <div
          v-if="ctx.ggo"
          class="results-context-row"
        >
          <span class="results-context-key">{{ t('results.ggo') }}</span>
          <span class="results-context-value">{{ ctx.ggo }}</span>
        </div>
        <div
          v-if="ctx.gge"
          class="results-context-row"
        >
          <span class="results-context-key">{{ t('results.gge') }}</span>
          <span class="results-context-value">{{ ctx.gge }}</span>
        </div>
        <!-- Compartments, with the count in the label when there are several -->
        <div
          v-if="odsekList.length"
          class="results-context-row"
        >
          <span class="results-context-key">
            {{ odsekList.length > 1 ? t('results.compartments') : t('results.compartment') }}
            <template v-if="odsekList.length > 1">({{ odsekList.length }})</template>
          </span>
          <span class="results-context-value results-context-value--list">
            <span
              ref="odsekEl"
              class="results-context-list"
              :class="{ 'results-context-list--clamped': !odsekExpanded }"
            >
              {{ odsekNames }}
            </span>
            <button
              v-if="odsekClipped"
              type="button"
              class="results-context-toggle"
              @click="odsekExpanded = !odsekExpanded"
            >
              {{ odsekExpanded ? t('results.showLess') : t('results.showAll') }}
            </button>
          </span>
        </div>
        <!-- Ground area of a single cell; area selections report their areas below -->
        <div
          v-if="pixelValues?.length && pixelArea != null"
          class="results-context-row"
        >
          <span class="results-context-key">{{ t('results.pixel') }}</span>
          <span class="results-context-value">{{ formatArea(pixelArea) }}</span>
        </div>
        <!-- Cell centre, for cross-checking against the source raster -->
        <div
          v-if="pixelCentre"
          class="results-context-row"
        >
          <span class="results-context-key">{{ t('results.coordinates') }}</span>
          <span class="results-context-value">{{ formatCoordinate(pixelCentre) }}</span>
        </div>
        <div
          v-if="treeCount != null && !pixelValues?.length && !isAreaSample"
          class="results-context-row"
        >
          <span class="results-context-key">{{ t('results.trees') }}</span>
          <span class="results-context-value">{{ treeCount.toLocaleString(numberLocale) }}</span>
        </div>
        <!-- Not the same as zero trees: nothing was available to count from -->
        <div
          v-else-if="treeCountUnavailable"
          class="results-context-row"
        >
          <span class="results-context-key">{{ t('results.trees') }}</span>
          <span class="results-context-value results-context-value--muted">
            {{
              treeCountMaxArea != null
                ? t('results.treesAreaTooLarge', { max: formatHectares(treeCountMaxArea) })
                : t('results.treesNotCountable')
            }}
          </span>
        </div>
        <!-- Captured area (what the figures describe), with the drawn area beside it -->
        <div
          v-if="capturedArea != null && !pixelValues?.length"
          class="results-context-row"
        >
          <span class="results-context-key">{{ t('results.captured') }}</span>
          <span class="results-context-value">
            {{ formatArea(capturedArea) }}
            <span
              v-if="ctx.area != null"
              class="results-context-aside"
            >
              {{ t('results.requestedShort', { area: formatHectares(ctx.area) }) }}
            </span>
          </span>
        </div>
        <div
          v-else-if="ctx.area != null && !pixelValues?.length"
          class="results-context-row"
        >
          <span class="results-context-key">{{ t('results.area') }}</span>
          <span class="results-context-value">{{ formatArea(ctx.area) }}</span>
        </div>
      </template>
    </div>

    <!-- Point cloud preview, replacing the per-layer figures below the header -->
    <div
      v-if="isPreviewOpen"
      class="results-panel__pointcloud"
    >
      <div class="results-panel__pointcloud-bar">
        <span class="results-panel__pointcloud-title">{{ t('pointcloud.title') }}</span>
        <Button
          :label="t('pointcloud.expand')"
          icon="pi pi-window-maximize"
          text
          size="small"
          @click="expand"
        />
        <Button
          icon="pi pi-times"
          text
          rounded
          severity="secondary"
          size="small"
          :aria-label="t('results.hidePointCloud')"
          @click="togglePreview"
        />
      </div>
      <div class="results-panel__pointcloud-frame">
        <PointCloudViewer
          :pointcloud-id="pointcloudId"
          :aoi="aoi"
        />
      </div>
    </div>

    <div
      v-if="!isPreviewOpen"
      class="results-panel__content"
    >
      <template
        v-if="selectedFeature || classCharts.length || rasterStats?.length || pixelValues?.length"
      >
        <!-- Pixel tab: laser measurements first, then model predictions -->
        <template v-if="pixelValues?.length">
          <section class="pixel-section">
            <h3 class="pixel-section__title">{{ t('results.measuredTitle') }}</h3>
            <table class="pixel-table">
              <colgroup>
                <col class="pixel-col--label" />
                <col class="pixel-col--wide" />
                <col class="pixel-col--narrow" />
                <col class="pixel-col--last" />
              </colgroup>
              <tbody>
                <tr>
                  <th
                    class="pixel-table__label"
                    colspan="3"
                  >
                    {{ t('results.trees') }}
                  </th>
                  <td class="pixel-table__num">
                    {{ (treeCount ?? 0).toLocaleString(numberLocale) }}
                  </td>
                </tr>
              </tbody>
            </table>

            <!-- Trees on the cell, listed individually. A separate table because a
                 thead always renders at the top of its table. -->
            <table
              v-if="trees?.length"
              class="pixel-table"
            >
              <colgroup>
                <col class="pixel-col--label" />
                <col class="pixel-col--wide" />
                <col class="pixel-col--narrow" />
                <col class="pixel-col--last" />
              </colgroup>
              <thead>
                <tr>
                  <th
                    class="pixel-table__label"
                    colspan="2"
                  >
                    {{ t('results.featureKeys.treeId') }}
                  </th>
                  <th class="pixel-table__num">{{ t('results.featureKeys.height') }}</th>
                  <th class="pixel-table__num">{{ t('results.crown') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="tree in trees"
                  :key="tree.id"
                >
                  <th
                    class="pixel-table__label pixel-table__label--id"
                    colspan="2"
                  >
                    <button
                      type="button"
                      class="tree-id"
                      :class="{ 'tree-id--selected': selectedFeatureId === tree.id }"
                      :title="t('results.showOnMap')"
                      @click="toggleTreeOnMap(tree)"
                    >
                      {{ tree.id }}
                    </button>
                  </th>
                  <td class="pixel-table__num">
                    {{
                      tree.properties.height != null ? formatHeight(tree.properties.height) : '—'
                    }}
                  </td>
                  <td class="pixel-table__num">
                    {{ tree.properties.area != null ? formatCrownArea(tree.properties.area) : '—' }}
                  </td>
                </tr>
              </tbody>
            </table>
          </section>

          <section class="pixel-section">
            <h3 class="pixel-section__title">{{ t('results.modelledTitle') }}</h3>

            <!-- Classified values, kept out of the quantities table -->
            <div class="pixel-species">
              <div
                v-for="value in classifiedValues"
                :key="value.layerId"
                class="pixel-species__row"
              >
                <span class="pixel-species__label">{{ pixelClassLabel(value.layerId) }}</span>
                <span
                  v-if="value.missing"
                  class="pixel-species__value pixel-species__value--missing"
                >
                  {{ t('results.noPrediction') }}
                </span>
                <span
                  v-else
                  class="pixel-species__value"
                >
                  <span
                    class="pixel-value__swatch"
                    :style="{ background: value.color }"
                  />
                  {{ classLabel(value.classSet, value.classValue) }}
                </span>
              </div>
            </div>

            <!-- Continuous values: per-hectare density, uncertainty and amount on this cell -->
            <table
              v-if="continuousValues.length"
              class="pixel-table"
            >
              <colgroup>
                <col class="pixel-col--label" />
                <col class="pixel-col--wide" />
                <col class="pixel-col--narrow" />
                <col class="pixel-col--last" />
              </colgroup>
              <thead>
                <tr>
                  <th class="pixel-table__label"></th>
                  <th class="pixel-table__num">{{ t('results.perHectare') }}</th>
                  <th class="pixel-table__num">{{ t('results.uncertainty') }}</th>
                  <th class="pixel-table__num">{{ t('results.perPixel') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="value in continuousValues"
                  :key="value.layerId"
                >
                  <th
                    class="pixel-table__label"
                    :title="layerLabel(value.layerId)"
                  >
                    {{ layerShortLabel(value.layerId) }}
                  </th>
                  <td
                    v-if="value.missing"
                    class="pixel-table__num pixel-table__num--muted"
                    colspan="3"
                  >
                    {{ t('results.noPrediction') }}
                  </td>
                  <td
                    v-if="!value.missing"
                    class="pixel-table__num"
                  >
                    {{ formatQuantity(value.density) }} {{ value.unit }}
                  </td>
                  <td
                    v-if="!value.missing"
                    class="pixel-table__num pixel-table__num--muted"
                  >
                    {{ value.errorPct != null ? formatErrorPct(value.errorPct) : '—' }}
                  </td>
                  <td
                    v-if="!value.missing"
                    class="pixel-table__num"
                  >
                    <template v-if="value.absolute != null">
                      {{ formatQuantity(value.absolute) }} {{ absoluteUnit(value.unit) }}
                    </template>
                    <template v-else>—</template>
                  </td>
                </tr>
              </tbody>
            </table>

            <!-- The absolute uncertainty is constant, so the percentage drops as the
                 prediction rises -->
            <p
              v-if="residualSds && continuousValues.some((v) => v.errorPct != null)"
              class="pixel-note"
            >
              {{ t('results.uncertaintyNote', residualSds) }}
            </p>
          </section>
        </template>

        <!-- Area selection: laser measurements first, then model estimates -->
        <template v-if="isAreaSample">
          <section
            v-if="treeCount != null || treeHeights"
            class="pixel-section"
          >
            <h3 class="pixel-section__title">{{ t('results.measuredTitle') }}</h3>
            <!-- Count, density, crown area and heights in one table. The height
                 headings are a tbody row, since a thead renders at the top. -->
            <table class="poly-table">
              <colgroup>
                <col class="poly-col--measured-label" />
                <col class="poly-col--quarter" />
                <col class="poly-col--quarter" />
                <col class="poly-col--quarter" />
                <col class="poly-col--quarter" />
              </colgroup>
              <tbody>
                <tr v-if="treeCount != null">
                  <th
                    class="poly-table__label"
                    colspan="4"
                  >
                    {{ t('results.trees') }}
                  </th>
                  <td class="poly-table__num">{{ treeCount.toLocaleString(numberLocale) }}</td>
                </tr>
                <!-- Divided by the counted ground (covered area), not the drawn area -->
                <tr v-if="treeDensity != null">
                  <th
                    class="poly-table__label"
                    colspan="4"
                  >
                    {{ t('results.density') }}
                  </th>
                  <td class="poly-table__num">{{ formatDensity(treeDensity) }}</td>
                </tr>
                <!-- Summed crown area over the ground; not canopy cover, as crowns overlap -->
                <tr v-if="crownShare != null">
                  <th
                    class="poly-table__label"
                    colspan="4"
                  >
                    {{ t('results.crownArea') }}
                  </th>
                  <td class="poly-table__num">{{ formatShareOfGround(crownShare) }}</td>
                </tr>
                <template v-if="treeHeights">
                  <tr class="poly-table__subhead">
                    <th class="poly-table__label"></th>
                    <th class="poly-table__num">{{ t('results.colLowest') }}</th>
                    <th class="poly-table__num">{{ t('results.colTallest') }}</th>
                    <th class="poly-table__num">{{ t('results.colP95') }}</th>
                    <th class="poly-table__num">{{ t('results.colMean') }}</th>
                  </tr>
                  <tr>
                    <th class="poly-table__label">{{ t('results.heightRow') }}</th>
                    <td class="poly-table__num">{{ formatHeight(treeHeights.min) }}</td>
                    <td class="poly-table__num">{{ formatHeight(treeHeights.max) }}</td>
                    <!-- P95 is withheld on very small samples -->
                    <td class="poly-table__num">
                      {{ treeHeights.p95 != null ? formatHeight(treeHeights.p95) : '—' }}
                    </td>
                    <td class="poly-table__num">{{ formatHeight(treeHeights.mean) }}</td>
                  </tr>
                </template>
              </tbody>
            </table>

            <!-- Height histogram: trees per hectare by 5 m class, contiguous bars -->
            <div
              v-if="heightBins.length"
              class="histogram-block"
            >
              <h4 class="species-chart__title">{{ t('results.heightClasses') }}</h4>
              <div class="histogram">
                <span class="histogram__unit">
                  {{ histogramIsDensity ? t('results.treesPerHa') : t('results.treesUnit') }}
                </span>
                <div class="histogram__yaxis">
                  <span
                    v-for="tick in histogramTicks"
                    :key="tick.value"
                    class="histogram__ytick"
                    :style="{ bottom: tick.pos + '%' }"
                  >
                    {{ tick.label }}
                  </span>
                </div>
                <div class="histogram__plot">
                  <div
                    v-for="tick in histogramTicks"
                    :key="tick.value"
                    class="histogram__gridline"
                    :class="{ 'histogram__gridline--base': tick.value === 0 }"
                    :style="{ bottom: tick.pos + '%' }"
                  />
                  <div class="histogram__bars">
                    <div
                      v-for="bin in heightBins"
                      :key="bin.label"
                      class="histogram__bar"
                      :style="{ height: (bin.value / histogramMax) * 100 + '%' }"
                      :title="
                        t('results.heightBinTitle', {
                          range: bin.label,
                          count: bin.count.toLocaleString(numberLocale),
                          pct: bin.pct.toFixed(1),
                        })
                      "
                    />
                  </div>
                </div>
                <div class="histogram__xaxis">
                  <span
                    v-for="bin in heightBins"
                    :key="bin.label"
                    class="histogram__xtick"
                  >
                    {{ bin.label }}
                  </span>
                </div>
                <span class="histogram__caption">{{ t('results.heightAxis') }}</span>
              </div>
            </div>
          </section>

          <section
            v-if="rasterStats?.length || classCharts.length"
            class="pixel-section"
          >
            <h3 class="pixel-section__title">{{ t('results.modelledTitle') }}</h3>
            <table
              v-if="rasterStats?.length"
              class="poly-table"
            >
              <colgroup>
                <col class="poly-col--label" />
                <col class="poly-col--a" />
                <col class="poly-col--b" />
                <col class="poly-col--c" />
                <col class="poly-col--d" />
              </colgroup>
              <thead>
                <tr>
                  <th class="poly-table__label"></th>
                  <th class="poly-table__num">{{ t('results.perHectare') }}</th>
                  <th class="poly-table__num">{{ t('results.range') }}</th>
                  <th class="poly-table__num">{{ t('results.total') }}</th>
                  <th class="poly-table__num">{{ t('results.covered') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="stat in rasterStats"
                  :key="stat.layerId"
                >
                  <th
                    class="poly-table__label"
                    :title="layerLabel(stat.layerId)"
                  >
                    {{ layerShortLabel(stat.layerId) }}
                  </th>
                  <td class="poly-table__num">{{ formatQuantity(stat.mean) }} {{ stat.unit }}</td>
                  <!-- Same unit as the mean, so none shown -->
                  <td class="poly-table__num poly-table__num--muted">
                    {{ formatRange(stat.min, stat.max) }}
                  </td>
                  <td class="poly-table__num">
                    <template v-if="stat.total != null">
                      {{ formatTotal(stat.total) }} {{ totalUnit(stat.unit) }}
                    </template>
                    <template v-else>—</template>
                  </td>
                  <!-- Area this layer has predictions for -->
                  <td class="poly-table__num">
                    {{ stat.coveredArea != null ? formatHectares(stat.coveredArea) : '—' }}
                  </td>
                </tr>
              </tbody>
            </table>

            <!-- Class composition per classified layer. The heading stays outside the
                 grid, since its display:contents rows would put it in the first cell. -->
            <div
              v-for="chart in classCharts"
              :key="chart.layerId"
              class="species-chart-block"
            >
              <h4 class="species-chart__title">{{ chart.label }}</h4>
              <div class="species-chart">
                <div
                  v-for="item in chart.items"
                  :key="item.label"
                  class="chart-row"
                >
                  <span class="chart-label">{{ item.label }}</span>
                  <div class="chart-track">
                    <div
                      class="chart-fill"
                      :style="{ width: item.pct + '%', background: item.color || undefined }"
                    />
                  </div>
                  <span class="chart-pct">{{ item.pct.toFixed(1) }}%</span>
                </div>
              </div>
            </div>
          </section>
        </template>

        <table
          v-if="visibleFeature"
          class="results-panel__table"
        >
          <!-- Tree ID first, matching the ID shown in the popup -->
          <tr v-if="activeTabLayerId === 'tops' && activeFeatureId != null">
            <th>{{ t('results.featureKeys.treeId') }}</th>
            <td>{{ activeFeatureId }}</td>
          </tr>
          <tr
            v-for="(value, key) in visibleFeature"
            :key="key"
          >
            <th>{{ formatFeatureKey(key) }}</th>
            <td>{{ formatFeatureValue(key, value) }}</td>
          </tr>
        </table>
      </template>
      <template v-else>
        <p class="results-panel__empty">
          {{ t('results.empty') }}
        </p>
      </template>
    </div>

    <div
      v-if="!isPreviewOpen"
      class="results-panel__footer"
    >
      <Button
        v-if="pointcloudId"
        :label="t('results.viewPointCloud')"
        icon="pi pi-box"
        size="small"
        @click="togglePreview"
      />
    </div>
  </aside>
</template>

<style scoped>
.results-panel {
  background: var(--color-panel-bg);
  border-left: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
}

.results-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--color-border);
}

.results-panel__title {
  font-weight: 700;
  font-size: 0.9rem;
}

/* Two-column grid; the label column sizes to the widest label */
.results-panel__context {
  padding: 0.5rem 1rem;
  border-bottom: 1px solid var(--color-border);
  display: grid;
  grid-template-columns: max-content 1fr;
  column-gap: 0.75rem;
  row-gap: 3px;
  align-items: baseline;
  background: var(--color-background-soft);
}

/* Rows are template wrappers only; their children are the grid items */
.results-context-row {
  display: contents;
}

/* Set on the children, since a display:contents row has no box */
.results-context-row--loading > * {
  opacity: 0.6;
}

.results-loading-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-text-muted);
  flex-shrink: 0;
  animation: results-pulse 1s ease-in-out infinite;
}

@keyframes results-pulse {
  0%,
  100% {
    opacity: 0.3;
  }

  50% {
    opacity: 1;
  }
}

.results-context-key,
/* Drawn area, shown beside the captured area */
.results-context-aside {
  margin-left: 0.4rem;
  font-size: 0.72rem;
  color: var(--color-text-muted);
}

.results-context-value {
  font-size: 0.8rem;
}

.results-context-key {
  font-weight: 600;
  color: var(--color-text-muted);
}

.results-context-value {
  color: var(--color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Compartment list wraps instead of clipping to one line */
.results-context-value--list {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  overflow: visible;
  white-space: normal;
}

.results-context-list {
  white-space: normal;
  overflow-wrap: anywhere;
}

/* Clamp to two lines to keep the header compact */
.results-context-list--clamped {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  overflow: hidden;
}

.results-context-toggle {
  margin-top: 1px;
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  font-size: 0.72rem;
  color: var(--color-text-muted);
  text-decoration: underline;
  cursor: pointer;
}

.results-context-toggle:hover {
  color: var(--color-text);
}

/* Explanatory text, wraps instead of truncating */
.results-context-value--muted {
  color: var(--color-text-muted);
  white-space: normal;
  text-align: right;
}

.results-panel__pointcloud {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.results-panel__pointcloud-bar {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.25rem 0.25rem 0.25rem 1rem;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-background-soft);
}

.results-panel__pointcloud-frame {
  flex: 1;
  min-height: 0;
}

.results-panel__pointcloud-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-text-muted);
}

.results-panel__content {
  flex: 1;
  padding: 1rem;
  overflow-y: auto;
}

.results-panel__table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;
}

.results-panel__table th,
.results-panel__table td {
  padding: 0.35rem 0.5rem;
  border-bottom: 1px solid var(--color-border);
}

/* Labels left, values right-aligned with tabular figures */
.results-panel__table th {
  text-align: left;
}

.results-panel__table td {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.results-panel__table th {
  font-weight: 600;
  color: var(--color-text-muted);
  width: 40%;
}

/* Area tab tables share a fixed five-column layout so the figures line up */
.poly-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  font-size: 0.82rem;
}

/* Modelled table columns; figures do not wrap, so they get most of the width */
.poly-col--label {
  width: 28%;
}

.poly-col--a {
  width: 20%;
}

.poly-col--b {
  width: 15%;
}

.poly-col--c {
  width: 19%;
}

.poly-col--d {
  width: 18%;
}

/* Measured table columns: a label and four equal height columns */
.poly-col--measured-label {
  width: 28%;
}

.poly-col--quarter {
  width: 18%;
}

.poly-table th,
.poly-table td {
  padding: 0.3rem 0 0.3rem 0.4rem;
  border-bottom: 1px solid var(--color-border);
}

.poly-table thead th {
  padding-top: 0.5rem;
  border-bottom-color: var(--color-text-muted);
  font-size: 0.68rem;
  font-weight: 600;
  line-height: 1.25;
  color: var(--color-text-muted);
  vertical-align: bottom;
}

.poly-table__label {
  text-align: left;
  font-weight: 600;
  color: var(--color-text-muted);
  padding-left: 0;
}

/* Height column headings, a tbody row with no rule below it */
.poly-table__subhead th {
  padding-top: 0.6rem;
  border-bottom: none;
  font-size: 0.68rem;
  font-weight: 600;
  line-height: 1.25;
  color: var(--color-text-muted);
  vertical-align: bottom;
}

.poly-table__num {
  text-align: right;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  vertical-align: baseline;
}

/* A supporting figure, not one of the measurements */
.poly-table__num--muted {
  color: var(--color-text-muted);
  font-size: 0.76rem;
}

.results-panel__empty {
  color: var(--color-text-muted);
  font-size: 0.85rem;
  text-align: center;
  padding: 2rem 1rem;
}

.results-panel__footer {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0.5rem 1rem;
  border-top: 1px solid var(--color-border);
}

.pixel-section {
  padding: 0.75rem 1rem 0.5rem;
}

/* Small uppercase section heading */
.pixel-section__title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--color-heading);
  margin-bottom: 0.15rem;
}

/* Rule from the title to the panel edge */
.pixel-section__title::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--color-border);
}

/* Pixel tab tables share a fixed four-column layout so the columns line up */
.pixel-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  font-size: 0.82rem;
}

.pixel-col--label {
  width: 47%;
}

/* Widest figures, e.g. "443,2 m³/ha" */
.pixel-col--wide {
  width: 21%;
}

.pixel-col--narrow {
  width: 14%;
}

.pixel-col--last {
  width: 18%;
}

.pixel-table th,
.pixel-table td {
  padding: 0.3rem 0 0.3rem 0.5rem;
  border-bottom: 1px solid var(--color-border);
}

/* Headings may wrap; the figures below them do not */
.pixel-table thead th {
  padding-top: 0.5rem;
  border-bottom-color: var(--color-text-muted);
  font-size: 0.68rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  line-height: 1.25;
  color: var(--color-text-muted);
  vertical-align: bottom;
}

.pixel-table__label {
  text-align: left;
  font-weight: 600;
  color: var(--color-text-muted);
  padding-left: 0;
}

/* Tree ID, de-emphasised next to the figures */
.pixel-table__label--id {
  font-weight: 400;
  font-variant-numeric: tabular-nums;
  padding-top: 0;
  padding-bottom: 0;
}

/* Tree ID styled as a link; toggles the tree's marker on the map */
.tree-id {
  padding: 0.3rem 0;
  border: 0;
  background: none;
  font: inherit;
  color: var(--color-text-muted);
  text-decoration: underline dotted;
  text-underline-offset: 2px;
  cursor: pointer;
}

.tree-id:hover {
  color: var(--color-text);
}

/* Same red as the map marker */
.tree-id--selected {
  color: rgb(220, 40, 40);
  font-weight: 600;
  text-decoration-style: solid;
}

.pixel-table__num {
  text-align: right;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  /* Keeps figures level with their neighbours when a row grows taller */
  vertical-align: baseline;
}

/* Classified values as a grid, so their values share one column */
.pixel-species {
  display: grid;
  grid-template-columns: max-content 1fr;
  column-gap: 1.25rem;
  row-gap: 2px;
  align-items: baseline;
  padding: 0.3rem 0 0;
  margin-bottom: 0.9rem;
  font-size: 0.82rem;
}

.pixel-species__row {
  display: contents;
}

.pixel-species__label {
  font-weight: 600;
  color: var(--color-text-muted);
}

/* Secondary figure, such as the uncertainty */
.pixel-table__num--muted {
  color: var(--color-text-muted);
  font-size: 0.76rem;
}

/* Class colour swatch, as on the map */
.pixel-value__swatch {
  display: inline-block;
  width: 9px;
  height: 9px;
  border-radius: 2px;
  margin-right: 0.35rem;
}

.pixel-note {
  margin-top: 0.6rem;
  font-size: 0.72rem;
  line-height: 1.35;
  color: var(--color-text-muted);
}

.species-chart-block {
  margin-top: 0.85rem;
}

/* Chart caption, styled like the table row labels */
.species-chart__title {
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--color-text-muted);
  margin-bottom: 0.35rem;
}

.species-chart {
  display: grid;
  grid-template-columns: max-content 1fr auto;
  align-items: center;
  column-gap: 8px;
  row-gap: 6px;
  margin-bottom: 0.75rem;
  font-size: 0.8rem;
}

.chart-row {
  display: contents;
}

.chart-label {
  color: var(--color-text);
  white-space: nowrap;
}

.chart-track {
  background: var(--color-border);
  border-radius: 3px;
  height: 10px;
  overflow: hidden;
}

/* Class colour is set inline; this background is the fallback for unmapped classes */
.chart-fill {
  height: 100%;
  background: var(--color-text-muted);
  border-radius: 3px;
  transition: width 0.3s ease;
}

.histogram-block {
  margin-top: 0.85rem;
  margin-bottom: 0.75rem;
}

/* Height histogram: trees per hectare by height class, in a single colour */
.histogram {
  display: grid;
  grid-template-columns: max-content 1fr;
  grid-template-areas:
    'unit  .'
    'yaxis plot'
    '.     xaxis'
    '.     caption';
  align-items: end;
}

/* Y-axis unit, above the axis */
.histogram__unit {
  grid-area: unit;
  padding-right: 0.4rem;
  padding-bottom: 2px;
  font-size: 0.6rem;
  color: var(--color-text-muted);
  text-align: right;
  white-space: nowrap;
}

/* Same height as the plot, so each tick label sits on its gridline */
.histogram__yaxis {
  grid-area: yaxis;
  position: relative;
  height: 96px;
  padding-right: 0.4rem;
}

.histogram__ytick {
  position: absolute;
  right: 0.4rem;
  transform: translateY(50%);
  font-size: 0.62rem;
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
}

.histogram__plot {
  grid-area: plot;
  position: relative;
  height: 96px;
}

.histogram__gridline {
  position: absolute;
  left: 0;
  right: 0;
  border-top: 1px dashed var(--color-border);
}

/* Solid baseline under the bars */
.histogram__gridline--base {
  border-top-style: solid;
  border-top-color: var(--color-text-muted);
}

/* Stacked above the gridlines */
.histogram__bars {
  position: relative;
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: 1fr;
  align-items: end;
  height: 100%;
}

/* Contiguous bars separated by a hairline */
.histogram__bar {
  min-height: 1px;
  background: var(--color-accent);
  opacity: 0.75;
  border-right: 1px solid var(--color-background);
  transition: height 0.3s ease;
}

.histogram__bar:last-child {
  border-right: 0;
}

.histogram__xaxis {
  grid-area: xaxis;
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: 1fr;
  padding-top: 3px;
}

.histogram__xtick {
  font-size: 0.62rem;
  color: var(--color-text-muted);
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.histogram__caption {
  grid-area: caption;
  padding-top: 2px;
  font-size: 0.6rem;
  color: var(--color-text-muted);
  text-align: center;
}

.chart-pct {
  color: var(--color-text-muted);
  font-size: 0.75rem;
  white-space: nowrap;
  min-width: 3.5ch;
  text-align: right;
}

.results-panel__disclaimer {
  font-size: 0.75rem;
  color: var(--color-text-muted);
  padding: 0.5rem 1rem;
  border-bottom: 1px solid var(--color-border);
  margin: 0;
  line-height: 1.4;
}

.results-panel__tabs {
  display: flex;
  overflow-x: auto;
  gap: 4px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-background-soft);
  scrollbar-width: thin;
}

.results-tab {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px 3px 10px;
  border-radius: 4px;
  border: 1px solid var(--color-border);
  background: var(--color-background);
  color: var(--color-text-muted);
  font-size: 0.75rem;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
  width: 72px;
}

.results-tab:hover {
  background: var(--color-background-mute);
}

.results-tab--active {
  background: var(--color-accent);
  border-color: var(--color-accent);
  color: white;
}

.results-tab__label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.results-tab__close {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  opacity: 0.6;
}

.results-tab__close:hover {
  opacity: 1;
  background: rgba(0, 0, 0, 0.1);
}

.results-tab--active .results-tab__close:hover {
  background: rgba(255, 255, 255, 0.2);
}
</style>

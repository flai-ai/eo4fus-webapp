<script setup>
import { useI18n } from 'vue-i18n'
import Panel from 'primevue/panel'
import Checkbox from 'primevue/checkbox'
import RadioButton from 'primevue/radiobutton'
import { layerGroups } from '@/config/layers.js'
import { useLayerVisibility, isRasterLayer } from '@/composables/useLayerVisibility.js'

const { t } = useI18n()
const { visibility, activeBaseLayer, activeRaster } = useLayerVisibility()

function isBaseGroup(group) {
  return group.id === 'base'
}

function isGroupAllChecked(group) {
  return group.layers.every((l) => visibility[l.id])
}

function isGroupSomeChecked(group) {
  return group.layers.some((l) => visibility[l.id])
}

function toggleGroup(group, val) {
  for (const layer of group.layers) {
    visibility[layer.id] = val
  }
}

/**
 * A layer's abbreviation, or '' where this language does not show one
 * (see shortLabelKey in config/layers.js).
 */
function shortLabel(layer) {
  return layer.shortLabelKey ? t(layer.shortLabelKey) : ''
}

/** Clicking the selected raster clears it, so "no raster" stays reachable */
function toggleRaster(layerId) {
  activeRaster.value = activeRaster.value === layerId ? null : layerId
}
</script>

<template>
  <aside class="layer-panel">
    <div class="layer-panel__header">{{ t('layerPanel.title') }}</div>
    <Panel
      v-for="group in layerGroups"
      :key="group.id"
      toggleable
      class="layer-panel__group"
    >
      <template #header>
        <div
          class="group-header"
          @click.stop
        >
          <Checkbox
            v-if="!isBaseGroup(group)"
            :model-value="isGroupAllChecked(group)"
            :binary="true"
            :indeterminate="isGroupSomeChecked(group) && !isGroupAllChecked(group)"
            @update:model-value="(val) => toggleGroup(group, val)"
          />
          <span class="group-header__label">{{ t(group.labelKey) }}</span>
        </div>
      </template>
      <div
        v-for="layer in group.layers"
        :key="layer.id"
        class="layer-panel__item"
      >
        <RadioButton
          v-if="isBaseGroup(group)"
          v-model="activeBaseLayer"
          :input-id="layer.id"
          :value="layer.id"
        />
        <RadioButton
          v-else-if="isRasterLayer(layer.id)"
          :model-value="activeRaster"
          :input-id="layer.id"
          :value="layer.id"
          :name="`raster-${group.id}`"
          @click="toggleRaster(layer.id)"
        />
        <Checkbox
          v-else
          v-model="visibility[layer.id]"
          :input-id="layer.id"
          :binary="true"
        />
        <label
          :for="layer.id"
          class="layer-panel__label"
        >
          {{ t(layer.labelKey) }}
          <span
            v-if="shortLabel(layer)"
            class="layer-panel__short"
          >
            ({{ shortLabel(layer) }})
          </span>
        </label>
      </div>
    </Panel>
  </aside>
</template>

<style scoped>
.layer-panel {
  background: var(--color-panel-bg);
  border-right: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
}

.layer-panel__header {
  padding: 0.75rem 1rem;
  font-weight: 700;
  font-size: 0.9rem;
  border-bottom: 1px solid var(--color-border);
}

.layer-panel__group {
  border-radius: 0;
  border: none;
  border-bottom: 1px solid var(--color-border);
}

.group-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.group-header__label {
  font-size: 0.875rem;
  font-weight: 600;
}

/* Top-aligned so the control sits beside the first line of a wrapped name */
.layer-panel__item {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  padding: 0.35rem 0;
}

.layer-panel__label {
  font-size: 0.85rem;
  cursor: pointer;
  user-select: none;
}

/* Abbreviation after the layer name, muted */
.layer-panel__short {
  color: var(--color-text-muted);
  white-space: nowrap;
}
</style>

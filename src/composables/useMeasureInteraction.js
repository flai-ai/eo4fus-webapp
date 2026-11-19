import { ref } from 'vue'
import Draw from 'ol/interaction/Draw'
import VectorLayer from 'ol/layer/Vector'
import VectorSource from 'ol/source/Vector'
import Overlay from 'ol/Overlay'
import { Style, Fill, Stroke } from 'ol/style'
import { getArea, getLength } from 'ol/sphere'
import { useMap } from './useMap.js'

export const activeMeasureTool = ref(null) // null | 'distance' | 'area'

function formatLength(meters) {
  return meters >= 1000
    ? `${(meters / 1000).toFixed(2)} km`
    : `${Math.round(meters)} m`
}

function formatArea(m2) {
  const ha = m2 / 10_000
  return `${Math.round(m2).toLocaleString('sl-SI')} m² (${ha.toLocaleString('sl-SI', { maximumFractionDigits: 2 })} ha)`
}

const MEASURE_STYLE = new Style({
  fill: new Fill({ color: 'rgba(255, 140, 0, 0.08)' }),
  stroke: new Stroke({ color: '#ff8c00', width: 2, lineDash: [6, 4] }),
})

export function useMeasureInteraction() {
  const { map } = useMap()

  let drawInteraction = null
  let measureSource = null
  let measureLayer = null
  let tooltipOverlay = null
  let tooltipEl = null
  let sketch = null

  function ensureLayer(olMap) {
    if (measureLayer) return

    measureSource = new VectorSource()
    measureLayer = new VectorLayer({ source: measureSource, zIndex: 99, style: MEASURE_STYLE })
    olMap.addLayer(measureLayer)

    tooltipEl = document.createElement('div')
    Object.assign(tooltipEl.style, {
      background: 'rgba(0,0,0,0.72)',
      color: '#fff',
      font: '600 12px/1.4 sans-serif',
      padding: '3px 8px',
      borderRadius: '4px',
      whiteSpace: 'nowrap',
      pointerEvents: 'none',
      display: 'none',
    })
    tooltipOverlay = new Overlay({ element: tooltipEl, offset: [12, -8], positioning: 'bottom-left' })
    olMap.addOverlay(tooltipOverlay)
  }

  function showTooltip(coord, text) {
    tooltipEl.textContent = text
    tooltipEl.style.display = 'block'
    tooltipOverlay.setPosition(coord)
  }

  function onPointerMove(evt) {
    if (evt.dragging || !sketch) return
    const geom = sketch.getGeometry()
    if (!geom) return
    const text = activeMeasureTool.value === 'distance'
      ? formatLength(getLength(geom))
      : formatArea(getArea(geom))
    showTooltip(geom.getLastCoordinate(), text)
  }

  function onDrawStart(evt) {
    sketch = evt.feature
  }

  function onDrawEnd(evt) {
    const geom = evt.feature.getGeometry()
    const text = activeMeasureTool.value === 'distance'
      ? formatLength(getLength(geom))
      : formatArea(getArea(geom))
    const coord = activeMeasureTool.value === 'distance'
      ? geom.getLastCoordinate()
      : geom.getInteriorPoint().getCoordinates()
    showTooltip(coord, text)

    sketch = null
    map.value?.un('pointermove', onPointerMove)
    if (drawInteraction) {
      map.value?.removeInteraction(drawInteraction)
      drawInteraction = null
    }
    document.removeEventListener('keydown', onKeyDown)
    activeMeasureTool.value = null
  }

  function onKeyDown(evt) {
    if (evt.key === 'Escape') deactivateMeasure()
  }

  function deactivateMeasure() {
    if (drawInteraction) {
      map.value?.removeInteraction(drawInteraction)
      drawInteraction = null
    }
    map.value?.un('pointermove', onPointerMove)
    document.removeEventListener('keydown', onKeyDown)
    activeMeasureTool.value = null
    sketch = null
  }

  function clearMeasure() {
    measureSource?.clear()
    if (tooltipEl) tooltipEl.style.display = 'none'
    tooltipOverlay?.setPosition(undefined)
  }

  function toggleMeasure(type) {
    if (activeMeasureTool.value === type) {
      deactivateMeasure()
      clearMeasure()
      return
    }

    deactivateMeasure()

    const olMap = map.value
    if (!olMap) return

    ensureLayer(olMap)
    measureSource.clear()
    if (tooltipEl) tooltipEl.style.display = 'none'

    drawInteraction = new Draw({
      source: measureSource,
      type: type === 'distance' ? 'LineString' : 'Polygon',
      stopClick: true,
    })
    drawInteraction.on('drawstart', onDrawStart)
    drawInteraction.on('drawend', onDrawEnd)
    olMap.addInteraction(drawInteraction)
    olMap.on('pointermove', onPointerMove)
    document.addEventListener('keydown', onKeyDown)
    activeMeasureTool.value = type
  }

  return { activeMeasureTool, toggleMeasure, clearMeasure, deactivateMeasure }
}

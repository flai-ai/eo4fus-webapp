/**
 * Flat style for WebGL vector tile layers; returns a new object per call.
 * Selection is drawn by useSelectionMarker because OL stores feature IDs as Float32,
 * which is not exact for tree-top IDs above 2^24.
 */
function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [50, 120, 200]
}

export function createFlatStyle(color = '#3278c8') {
  const [r, g, b] = hexToRgb(color)
  return {
    // Points
    'circle-radius': 4,
    'circle-fill-color': `rgba(${r}, ${g}, ${b}, 0.7)`,
    'circle-stroke-color': `rgba(${r}, ${g}, ${b}, 0.9)`,
    'circle-stroke-width': 1,
    // Polygons / Lines
    'fill-color': `rgba(${r}, ${g}, ${b}, 0.15)`,
    'stroke-color': `rgba(${r}, ${g}, ${b}, 0.7)`,
    'stroke-width': 1.5,
  }
}

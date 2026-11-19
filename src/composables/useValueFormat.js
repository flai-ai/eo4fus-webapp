import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

/** Number formatting shared by the popup and the results panel */
export function useValueFormat() {
  const { locale } = useI18n()
  const numberLocale = computed(() => (locale.value === 'sl' ? 'sl-SI' : 'en-GB'))

  /**
   * Formats a quantity with decimals by magnitude: none from 1000, one from 1, two below 1
   * (so small per-cell amounts do not round to 0).
   */
  function formatQuantity(value) {
    const magnitude = Math.abs(value)
    const decimals = magnitude >= 1000 ? 0 : magnitude >= 1 ? 1 : 2
    return value.toLocaleString(numberLocale.value, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })
  }

  /** Relative error in whole percent ("± 48 %"), or "> ± 100 %" above 100 */
  function formatErrorPct(pct) {
    if (pct > 100) return '> ± 100 %'
    return `± ${Math.round(pct).toLocaleString(numberLocale.value)} %`
  }

  /** Strips a trailing "/ha" to get the absolute unit */
  function absoluteUnit(unit) {
    return unit.replace(/\/ha$/, '')
  }

  return { numberLocale, formatQuantity, formatErrorPct, absoluteUnit }
}

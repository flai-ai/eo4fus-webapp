import { computed } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { datasetKeys } from '@/api/queryKeys'
import { DatasetService } from '@/api/services/DatasetService'

export function useDataset(id, options = {}) {
  const queryKey = computed(() => datasetKeys.detail(id.value ?? id))

  return useQuery({
    queryKey,
    queryFn: () => DatasetService.getById(id.value ?? id),
    enabled: computed(() => !!(id.value ?? id)),
    ...options,
  })
}

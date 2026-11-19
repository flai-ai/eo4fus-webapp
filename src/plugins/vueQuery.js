import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes
      gcTime: 10 * 60 * 1000, // 10 minutes
      refetchOnWindowFocus: false,
      retry: 1,
    },
    mutations: {
      retry: false,
    },
  },
})

export function setupVueQuery(app) {
  app.use(VueQueryPlugin, { queryClient })
}

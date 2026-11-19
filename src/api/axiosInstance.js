import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL,
})

// Request interceptor: attach auth token
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// Response interceptor: global error handling
api.interceptors.response.use(
  (response) => response,
  (error) => {
    // Handle 401 globally if needed
    if (error.response?.status === 401) {
      // TODO: redirect to login or refresh token
    }
    return Promise.reject(error)
  },
)

export default api

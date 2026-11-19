import api from '@/api/axiosInstance'

export class DatasetService {
  static async getById(id) {
    const { data } = await api.get('/public/datasets/shared/', {
      params: { 'filter[id]': `i=${id}`, decorators: 'rasterDataset' },
    })
    return data.items[0] ?? null
  }
}

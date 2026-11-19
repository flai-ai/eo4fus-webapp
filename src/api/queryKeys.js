export const datasetKeys = {
  all: ['datasets'],
  details: () => [...datasetKeys.all, 'detail'],
  detail: (id) => [...datasetKeys.details(), id],
}

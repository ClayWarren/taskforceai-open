import { type StorageSummary, storageSummarySchema } from '../contracts';
import { createHelpers, type RequestContext } from './helpers';

export const createStorageClient = (context: RequestContext) => {
  const { get } = createHelpers(context);

  return {
    getStorageSummary: (): Promise<StorageSummary> =>
      get('/api/v1/developer/storage', storageSummarySchema),
  };
};

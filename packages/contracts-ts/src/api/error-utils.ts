import { readStatusCode } from '@taskforceai/shared/utils/api';

export type ApiErrorKind = 'unauthorized' | 'not_found' | 'server' | 'network';

export type ClassifiedApiError = {
  kind: ApiErrorKind;
  status?: number;
};

export const classifyApiError = (error: unknown): ClassifiedApiError => {
  const status = readStatusCode(error);
  if (status === 401) {
    return { kind: 'unauthorized', status };
  }
  if (status === 404) {
    return { kind: 'not_found', status };
  }
  if (typeof status === 'number') {
    return { kind: 'server', status };
  }
  return { kind: 'network' };
};

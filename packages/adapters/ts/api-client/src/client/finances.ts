import { z } from 'zod';
import {
  type CreateFinanceLinkTokenResponse,
  type CreateFinanceMemoryRequest,
  type ExchangeFinancePublicTokenRequest,
  type FinanceDashboardResponse,
  createFinanceLinkTokenResponseSchema,
  createFinanceMemoryRequestSchema,
  exchangeFinancePublicTokenRequestSchema,
  financeDashboardResponseSchema,
} from '@taskforceai/contracts/contracts';
import { createHelpers, positiveIntegerPathSegment, type RequestContext } from './helpers';

export const createFinancesClient = (context: RequestContext) => {
  const { get, post, request } = createHelpers(context);

  return {
    getFinanceDashboard: (): Promise<FinanceDashboardResponse> =>
      get('/api/v1/finances', financeDashboardResponseSchema),

    createFinanceMemory: (body: CreateFinanceMemoryRequest): Promise<unknown> =>
      post(
        '/api/v1/finances/memories',
        createFinanceMemoryRequestSchema.parse(body),
        zUnknownResponse
      ),

    createFinanceLinkToken: (): Promise<CreateFinanceLinkTokenResponse> =>
      post('/api/v1/finances/link-token', undefined, createFinanceLinkTokenResponseSchema),

    exchangeFinancePublicToken: (body: ExchangeFinancePublicTokenRequest): Promise<unknown> =>
      post(
        '/api/v1/finances/exchange-public-token',
        exchangeFinancePublicTokenRequestSchema.parse(body),
        zUnknownResponse
      ),

    syncFinanceData: (): Promise<unknown> =>
      post('/api/v1/finances/sync', undefined, zUnknownResponse),

    disconnectFinanceConnection: async (id: number): Promise<void> => {
      const connectionId = positiveIntegerPathSegment(id, 'finance connection id');
      await request(`/api/v1/finances/connections/${connectionId}`, {
        method: 'DELETE',
      });
    },

    deleteFinanceMemory: async (id: number): Promise<void> => {
      const memoryId = positiveIntegerPathSegment(id, 'finance memory id');
      await request(`/api/v1/finances/memories/${memoryId}`, {
        method: 'DELETE',
      });
    },
  };
};

const zUnknownResponse = z.unknown();

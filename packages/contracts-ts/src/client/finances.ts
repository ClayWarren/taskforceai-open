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
} from '../contracts';
import { createHelpers, type RequestContext } from './helpers';

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
      await request(`/api/v1/finances/connections/${encodeURIComponent(String(id))}`, {
        method: 'DELETE',
      });
    },

    deleteFinanceMemory: async (id: number): Promise<void> => {
      await request(`/api/v1/finances/memories/${encodeURIComponent(String(id))}`, {
        method: 'DELETE',
      });
    },
  };
};

const zUnknownResponse = z.unknown();

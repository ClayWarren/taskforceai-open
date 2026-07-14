import {
  type CreateSubscriptionResponse,
  type MessageResponse,
  type ProductsResponse,
  type SubscriptionResponse,
  createSubscriptionResponseSchema,
  messageResponseSchema,
  mobileSubscriptionSyncResponseSchema,
  productsResponseSchema,
  subscriptionResponseSchema,
} from '@taskforceai/contracts/contracts';
import { createHelpers, type RequestContext } from './helpers';
import { type Result } from '../utils/result';

export const createPaymentsClient = (context: RequestContext) => {
  const { get, post, request, result } = createHelpers(context);

  return {
    getSubscription: (): Promise<SubscriptionResponse> =>
      get('/api/v1/payments', subscriptionResponseSchema),
    getProducts: (): Promise<ProductsResponse> =>
      get('/api/v1/payments/products', productsResponseSchema),
    createSubscription: (id: string): Promise<CreateSubscriptionResponse> =>
      post(
        '/api/v1/payments/create-subscription',
        { price_id: id },
        createSubscriptionResponseSchema
      ),
    cancelSubscription: (): Promise<Result<MessageResponse>> =>
      result(messageResponseSchema, () =>
        request('/api/v1/payments/cancel-subscription', { method: 'POST' })
      ),
    reactivateSubscription: (): Promise<Result<MessageResponse>> =>
      result(messageResponseSchema, () =>
        request('/api/v1/payments/reactivate-subscription', { method: 'POST' })
      ),
    syncMobileSubscription: () =>
      post('/api/v1/payments/mobile/sync', {}, mobileSubscriptionSyncResponseSchema),
  };
};

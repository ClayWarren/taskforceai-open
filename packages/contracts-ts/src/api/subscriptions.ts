import { getBrowserClient } from '@taskforceai/contracts/browserClient';
import type {
  CreateSubscriptionResponse,
  ProductsResponse,
  SubscriptionResponse,
} from '@taskforceai/contracts/contracts';

import { getCsrfToken } from '../auth/csrf';
import { getAuthLogger } from '../auth/logger';
import { type Result } from '../utils/result';
import {
  type ApiStatusError,
  mapStatusError,
  runApiOperation,
  unwrapResult,
} from './result-helpers';

export type SubscriptionError = ApiStatusError;

const logger = getAuthLogger();

const runSubscriptionOperation = <T>(
  message: string,
  operation: () => Promise<T>,
  details?: Record<string, unknown>
): Promise<Result<T, SubscriptionError>> =>
  runApiOperation(message, mapStatusError, (...args) => logger.error(...args), operation, details);

export const fetchSubscription = async (): Promise<
  Result<SubscriptionResponse, SubscriptionError>
> =>
  runSubscriptionOperation('Failed to fetch subscription', () =>
    getBrowserClient({ getCsrfToken }).getSubscription()
  );

export const fetchProducts = async (): Promise<Result<ProductsResponse, SubscriptionError>> =>
  runSubscriptionOperation('Failed to fetch products', () =>
    getBrowserClient({ getCsrfToken }).getProducts()
  );

export const createSubscription = async (
  priceId: string
): Promise<Result<CreateSubscriptionResponse, SubscriptionError>> =>
  runSubscriptionOperation(
    'Failed to create subscription',
    () => getBrowserClient({ getCsrfToken }).createSubscription(priceId),
    { priceId }
  );

export const cancelSubscription = async (): Promise<
  Result<{ message?: string }, SubscriptionError>
> =>
  runSubscriptionOperation('Failed to cancel subscription', async () =>
    unwrapResult(await getBrowserClient({ getCsrfToken }).cancelSubscription())
  );

export const reactivateSubscription = async (): Promise<
  Result<{ message?: string }, SubscriptionError>
> =>
  runSubscriptionOperation('Failed to reactivate subscription', async () =>
    unwrapResult(await getBrowserClient({ getCsrfToken }).reactivateSubscription())
  );

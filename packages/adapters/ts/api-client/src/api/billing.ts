import { getBrowserClient } from '@taskforceai/api-client/browserClient';
import type {
  AutoRechargeRequest,
  BalanceResponse,
  InvoiceResponse,
  PaymentMethodResponse,
  PortalResponse,
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

export type BillingError = ApiStatusError;

const logger = getAuthLogger();

const runBillingOperation = <T>(
  message: string,
  operation: () => Promise<T>,
  details?: Record<string, unknown>
): Promise<Result<T, BillingError>> =>
  runApiOperation(message, mapStatusError, (...args) => logger.error(...args), operation, details);

export const fetchBalance = async (): Promise<Result<BalanceResponse, BillingError>> =>
  runBillingOperation('Failed to fetch balance', () => getBrowserClient().getBalance());

export const fetchPaymentMethods = async (): Promise<
  Result<PaymentMethodResponse[], BillingError>
> =>
  runBillingOperation('Failed to fetch payment methods', () =>
    getBrowserClient().getPaymentMethods()
  );

export const fetchInvoices = async (): Promise<Result<InvoiceResponse[], BillingError>> =>
  runBillingOperation('Failed to fetch invoices', () => getBrowserClient().getInvoices());

export const updateAutoRecharge = async (
  data: AutoRechargeRequest
): Promise<Result<BalanceResponse, BillingError>> =>
  runBillingOperation(
    'Failed to update auto-recharge',
    async () => unwrapResult(await getBrowserClient({ getCsrfToken }).updateAutoRecharge(data)),
    { data }
  );

export const createPortalSession = async (): Promise<Result<PortalResponse, BillingError>> =>
  runBillingOperation('Failed to create portal session', async () =>
    unwrapResult(await getBrowserClient({ getCsrfToken }).createPortalSession())
  );

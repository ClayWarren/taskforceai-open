import {
  type AutoRechargeRequest,
  type BalanceResponse,
  type InvoiceResponse,
  type PaymentMethodResponse,
  type PortalResponse,
  autoRechargeRequestSchema,
  balanceResponseSchema,
  invoiceResponseSchema,
  paymentMethodResponseSchema,
  portalResponseSchema,
} from '@taskforceai/contracts/contracts';
import { createHelpers, type RequestContext } from './helpers';
import { type Result } from '../utils/result';

export const createBillingClient = (context: RequestContext) => {
  const { get, request, result, buildJsonHeaders } = createHelpers(context);

  return {
    getBalance: (): Promise<BalanceResponse> =>
      get('/api/v1/billing/balance', balanceResponseSchema),

    getPaymentMethods: (): Promise<PaymentMethodResponse[]> =>
      get('/api/v1/billing/payment-methods', paymentMethodResponseSchema.array()),

    getInvoices: (): Promise<InvoiceResponse[]> =>
      get('/api/v1/billing/invoices', invoiceResponseSchema.array()),

    updateAutoRecharge: (data: AutoRechargeRequest): Promise<Result<BalanceResponse>> =>
      result(balanceResponseSchema, () =>
        request('/api/v1/billing/auto-recharge', {
          method: 'POST',
          headers: buildJsonHeaders(),
          body: JSON.stringify(autoRechargeRequestSchema.parse(data)),
        })
      ),

    createPortalSession: (): Promise<Result<PortalResponse>> =>
      result(portalResponseSchema, () => request('/api/v1/billing/portal', { method: 'POST' })),
  };
};

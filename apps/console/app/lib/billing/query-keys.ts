export const billingQueryKeys = {
  scope: (userScope: string) => ['billing', userScope] as const,
  balance: (userScope: string) => ['billing', userScope, 'balance'] as const,
  invoices: (userScope: string) => ['billing', userScope, 'invoices'] as const,
  paymentMethods: (userScope: string) => ['billing', userScope, 'payment-methods'] as const,
};

import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Plus, CreditCard, Loader2 } from 'lucide-react';
import { Button } from '@taskforceai/ui-kit/button';
import { BillingErrorState, BillingLoadingState } from '../components/billing/BillingQueryState';
import { fetchPaymentMethods } from '../lib/api/billing';
import { useBillingPortalMutation } from '../lib/billing/use-billing-portal-mutation';

export const Route = createFileRoute('/billing/payment-methods')({
  component: PaymentMethodsPage,
});

function getCardBrandDisplayName(brand: string): string {
  const brands: Record<string, string> = {
    visa: 'Visa',
    mastercard: 'Mastercard',
    amex: 'Amex',
    discover: 'Discover',
    diners: 'Diners',
    jcb: 'JCB',
    unionpay: 'UnionPay',
  };
  return brands[brand.toLowerCase()] || brand;
}

function PaymentMethodsPage() {
  const {
    data: paymentMethods,
    isLoading,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ['billing', 'payment-methods'],
    queryFn: () => fetchPaymentMethods(),
  });

  const portalMutation = useBillingPortalMutation();

  const handleAddPaymentMethod = () => {
    portalMutation.mutate();
  };

  if (isLoading) {
    return <BillingLoadingState />;
  }

  if (!paymentMethods || !paymentMethods.ok) {
    const errorMessage =
      paymentMethods && !paymentMethods.ok
        ? paymentMethods.error.message
        : 'Payment methods are currently unavailable.';

    return (
      <BillingErrorState
        title="Unable to load payment methods"
        message={errorMessage}
        isRetrying={isFetching}
        onRetry={() => void refetch()}
      />
    );
  }

  const methods = paymentMethods.value;
  const hasPaymentMethods = methods.length > 0;

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">Payment methods</h2>
          <p className="text-sm text-slate-400">Manage how you pay for your API usage.</p>
        </div>
        <Button
          className="gap-2 bg-white text-black hover:bg-slate-200"
          onClick={handleAddPaymentMethod}
          disabled={portalMutation.isPending}
        >
          {portalMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
          Add payment method
        </Button>
      </div>

      <div className="overflow-hidden rounded-xl border border-white/10 bg-white/[0.02]">
        {!hasPaymentMethods ? (
          <div className="p-8 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-white/5">
              <CreditCard className="h-6 w-6 text-slate-500" />
            </div>
            <h3 className="text-lg font-bold text-white">No payment methods found</h3>
            <p className="mt-1 text-slate-400">You haven't added any payment methods yet.</p>
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {methods.map((method) => (
              <div key={method.id} className="flex items-center justify-between p-6">
                <div className="flex items-center gap-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/5">
                    <CreditCard className="h-5 w-5 text-slate-400" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-white">
                        {getCardBrandDisplayName(method.brand)}
                      </span>
                      <span className="text-slate-400">•••• {method.last4}</span>
                      {method.isDefault && (
                        <span className="rounded-full bg-blue-600/10 px-2 py-0.5 text-xs font-medium text-blue-400">
                          Default
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-slate-500">
                      Expires {method.expMonth}/{method.expYear}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

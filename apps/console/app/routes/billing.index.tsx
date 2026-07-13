import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { Info, History, Wallet, DollarSign, Loader2 } from 'lucide-react';
import { Button } from '@taskforceai/ui-kit/button';
import { logger } from '../lib/logger';
import {
  cancelSubscription,
  fetchBalance,
  reactivateSubscription,
  updateAutoRecharge,
} from '../lib/api/billing';
import { useBillingPortalMutation } from '../lib/billing/use-billing-portal-mutation';
import { BillingErrorState, BillingLoadingState } from '../components/billing/BillingQueryState';
import { confirmAction, showAlert } from '@taskforceai/browser-runtime/browser-actions';

export const Route = createFileRoute('/billing/')({
  component: BillingOverviewPage,
});

const DEFAULT_AUTO_RECHARGE_AMOUNT = 10;
const DEFAULT_AUTO_RECHARGE_THRESHOLD = 5;
const defaultNumber = (value: number | null | undefined, fallback: number): number =>
  value ?? fallback;

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
}

function BillingOverviewPage() {
  const queryClient = useQueryClient();

  const {
    data: balanceResult,
    isLoading,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ['billing', 'balance'],
    queryFn: () => fetchBalance(),
  });

  const notify = (message: string) => {
    const result = showAlert(message);
    if (!result.ok) {
      logger.warn('Failed to show billing alert', { error: result.error });
    }
  };

  const autoRechargeMutation = useMutation({
    mutationFn: (settings: { enabled: boolean; amount: number | null; threshold: number | null }) =>
      updateAutoRecharge(settings),
    onSuccess: (result) => {
      if (!result.ok) {
        logger.warn('Failed to update auto-recharge', { error: result.error });
        notify(`Failed to update auto recharge: ${result.error.message}`);
        return;
      }
      void queryClient.invalidateQueries({ queryKey: ['billing', 'balance'] });
    },
    onError: (error) => {
      logger.error('Failed to update auto-recharge', { error });
      notify('Failed to update auto recharge. Please try again.');
    },
  });

  const portalMutation = useBillingPortalMutation();

  const cancelMutation = useMutation({
    mutationFn: () => cancelSubscription(),
    onSuccess: (result) => {
      if (result.ok) {
        void queryClient.invalidateQueries({ queryKey: ['billing', 'balance'] });
        return;
      }
      notify(`Failed to cancel plan: ${result.error.message}`);
    },
    onError: (error) => {
      logger.error('Failed to cancel subscription', { error });
      notify('Failed to cancel plan. Please try again.');
    },
  });

  const reactivateMutation = useMutation({
    mutationFn: () => reactivateSubscription(),
    onSuccess: (result) => {
      if (result.ok) {
        void queryClient.invalidateQueries({ queryKey: ['billing', 'balance'] });
        return;
      }
      notify(`Failed to reactivate plan: ${result.error.message}`);
    },
    onError: (error) => {
      logger.error('Failed to reactivate subscription', { error });
      notify('Failed to reactivate plan. Please try again.');
    },
  });

  const handleAddBalance = () => {
    portalMutation.mutate();
  };

  const handleToggleAutoRecharge = () => {
    if (balanceResult?.ok) {
      const nextEnabled = !balanceResult.value.autoRechargeEnabled;
      autoRechargeMutation.mutate({
        enabled: nextEnabled,
        amount: nextEnabled
          ? (balanceResult.value.autoRechargeAmount ?? DEFAULT_AUTO_RECHARGE_AMOUNT)
          : null,
        threshold: nextEnabled
          ? (balanceResult.value.autoRechargeThreshold ?? DEFAULT_AUTO_RECHARGE_THRESHOLD)
          : null,
      });
    }
  };

  const handleCancelSubscription = () => {
    const confirmResult = confirmAction(
      'Cancel your plan at the end of the current billing period?'
    );
    if (!confirmResult.ok) {
      logger.warn('Failed to show cancel subscription confirmation', {
        error: confirmResult.error,
      });
      notify('Unable to confirm cancellation. Please try again.');
      return;
    }
    if (!confirmResult.value) return;

    cancelMutation.mutate();
  };

  const handleReactivateSubscription = () => {
    reactivateMutation.mutate();
  };

  if (isLoading) {
    return <BillingLoadingState />;
  }

  if (!balanceResult || !balanceResult.ok) {
    const errorMessage =
      balanceResult && !balanceResult.ok
        ? balanceResult.error.message
        : 'Billing balance is currently unavailable.';

    return (
      <BillingErrorState
        title="Unable to load billing overview"
        message={errorMessage}
        isRetrying={isFetching}
        onRetry={() => void refetch()}
      />
    );
  }

  const {
    creditBalance,
    autoRechargeEnabled,
    autoRechargeAmount,
    autoRechargeThreshold,
    subscriptionId,
    cancelAtPeriodEnd,
  } = balanceResult.value;
  const hasSubscription = Boolean(subscriptionId);
  const configuredRechargeAmount = defaultNumber(autoRechargeAmount, DEFAULT_AUTO_RECHARGE_AMOUNT);
  const configuredRechargeThreshold = defaultNumber(
    autoRechargeThreshold,
    DEFAULT_AUTO_RECHARGE_THRESHOLD
  );

  return (
    <div className="space-y-12">
      <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-2xl space-y-6">
          <div>
            <h2 className="text-xl font-bold text-white">Pay as you go</h2>
            <p className="mt-1 text-sm text-slate-400">
              Credit balance <Info className="inline h-3 w-3 align-text-top" />
            </p>
            <p className="mt-2 text-5xl font-bold text-white">{formatCurrency(creditBalance)}</p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button
              className="bg-white text-black hover:bg-slate-200"
              onClick={handleAddBalance}
              disabled={portalMutation.isPending}
            >
              {portalMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Add to credit balance
            </Button>
            {hasSubscription && cancelAtPeriodEnd && (
              <Button
                variant="outline"
                className="border-blue-500/50 text-blue-400 hover:bg-blue-500/10"
                onClick={handleReactivateSubscription}
                disabled={reactivateMutation.isPending}
              >
                {reactivateMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                Reactivate plan
              </Button>
            )}
            {hasSubscription && !cancelAtPeriodEnd && (
              <Button
                variant="outline"
                className="border-white/10 text-white hover:bg-white/5"
                onClick={handleCancelSubscription}
                disabled={cancelMutation.isPending}
              >
                {cancelMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                Cancel plan
              </Button>
            )}
          </div>

          {cancelAtPeriodEnd && hasSubscription && (
            <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/5 p-4">
              <p className="text-sm text-yellow-200/80">
                Your subscription will be canceled at the end of the current billing period.
              </p>
            </div>
          )}

          <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.02] p-6">
            <div className="flex items-start gap-4">
              <div className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-600/10">
                <Info className="h-5 w-5 text-blue-500" />
              </div>
              <div>
                <h4 className="font-bold text-white">
                  Auto recharge is {autoRechargeEnabled ? 'on' : 'off'}
                </h4>
                <p className="mt-1 text-sm text-slate-400">
                  {autoRechargeEnabled
                    ? `Your credit balance will be automatically topped up by ${formatCurrency(configuredRechargeAmount)} when it drops below ${formatCurrency(configuredRechargeThreshold)}.`
                    : `When your credit balance reaches $0, your API requests will stop working. Enable automatic recharge to top up ${formatCurrency(configuredRechargeAmount)} when the balance drops below ${formatCurrency(configuredRechargeThreshold)}.`}
                </p>
              </div>
            </div>
            <Button
              className="shrink-0 bg-white text-black hover:bg-slate-200"
              onClick={handleToggleAutoRecharge}
              disabled={autoRechargeMutation.isPending}
            >
              {autoRechargeMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              {autoRechargeEnabled ? 'Disable' : 'Enable'} auto recharge
            </Button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <BillingActionCard
          icon={Wallet}
          title="Payment methods"
          description="Add or change payment method"
          to="/billing/payment-methods"
        />
        <BillingActionCard
          icon={History}
          title="Billing history"
          description="View past and current invoices"
          to="/billing/history"
        />
        <BillingActionCard
          icon={Info}
          title="Preferences"
          description="Manage billing information"
          to="/billing/preferences"
        />
        <BillingActionCard
          icon={DollarSign}
          title="Pricing"
          description="View pricing and FAQs"
          href="https://taskforceai.chat/pricing"
        />
      </div>
    </div>
  );
}

type BillingActionCardProps = {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
} & (
  | {
      to: '/billing/payment-methods' | '/billing/history' | '/billing/preferences';
      href?: never;
    }
  | {
      href: string;
      to?: never;
    }
);

function BillingActionCard(props: BillingActionCardProps) {
  const { icon: Icon, title, description } = props;
  const className =
    'group flex items-center gap-4 rounded-xl border border-white/10 bg-white/[0.02] p-6 transition-colors hover:bg-white/5';

  const content = (
    <>
      <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-white/5 transition-colors group-hover:bg-white/10">
        <Icon className="h-6 w-6 text-slate-400" />
      </div>
      <div>
        <h3 className="font-bold text-white">{title}</h3>
        <p className="text-sm text-slate-500">{description}</p>
      </div>
    </>
  );

  if ('href' in props) {
    return (
      <a href={props.href} target="_blank" rel="noopener noreferrer" className={className}>
        {content}
      </a>
    );
  }

  return (
    <Link to={props.to} className={className}>
      {content}
    </Link>
  );
}

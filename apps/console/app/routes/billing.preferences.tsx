import { createFileRoute } from '@tanstack/react-router';
import { Loader2, ExternalLink } from 'lucide-react';
import { Button } from '@taskforceai/ui-kit/button';
import { useBillingPortalMutation } from '../lib/billing/use-billing-portal-mutation';

export const Route = createFileRoute('/billing/preferences')({
  component: BillingPreferencesPage,
});

function BillingPreferencesPage() {
  const portalMutation = useBillingPortalMutation();

  const handleManageBilling = () => {
    portalMutation.mutate();
  };

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-bold text-white">Preferences</h2>
        <p className="text-sm text-slate-400">Manage your billing information and preferences.</p>
      </div>

      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-8">
        <div className="mx-auto max-w-md text-center">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-blue-600/10">
            <ExternalLink className="h-8 w-8 text-blue-500" />
          </div>
          <h3 className="text-lg font-bold text-white">Manage billing via Stripe</h3>
          <p className="mt-2 text-sm text-slate-400">
            Update your email, business information, and payment preferences through our secure
            billing portal.
          </p>
          <Button
            className="mt-6 gap-2 bg-white text-black hover:bg-slate-200"
            onClick={handleManageBilling}
            disabled={portalMutation.isPending}
          >
            {portalMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ExternalLink className="h-4 w-4" />
            )}
            Open billing portal
          </Button>
        </div>
      </div>
    </div>
  );
}

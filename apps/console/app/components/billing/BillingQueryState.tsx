import { AlertCircle, Loader2 } from 'lucide-react';

import { Button } from '@taskforceai/ui-kit/button';

export function BillingLoadingState() {
  return (
    <div className="flex items-center justify-center py-12">
      <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
    </div>
  );
}

interface BillingErrorStateProps {
  isRetrying: boolean;
  message: string;
  onRetry: () => void;
  title: string;
}

export function BillingErrorState({ isRetrying, message, onRetry, title }: BillingErrorStateProps) {
  return (
    <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-6">
      <div className="flex items-start gap-3">
        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
        <div className="space-y-3">
          <div>
            <h2 className="text-lg font-bold text-white">{title}</h2>
            <p className="text-sm text-red-200/90">{message}</p>
          </div>
          <Button
            onClick={onRetry}
            disabled={isRetrying}
            className="bg-white text-black hover:bg-slate-200"
          >
            {isRetrying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Retry
          </Button>
        </div>
      </div>
    </div>
  );
}

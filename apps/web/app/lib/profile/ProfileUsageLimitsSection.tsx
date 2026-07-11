'use client';

import {
  buildProfileModelUsageRows,
  buildProfileUsageLimitViewModel,
  formatProfilePlanLabel,
  type PaidProfilePlan,
  type ProfilePlan,
  type ProfileUpgradeOption,
} from '@taskforceai/presenters';
import { formatUsageMultiple, PUBLIC_MODEL_SELECTOR_CATALOG } from '@taskforceai/client-core';
import clsx from 'clsx';

import { Button } from '@taskforceai/ui-kit/button';

export function UsageLimitsSection(props: {
  plan: ProfilePlan;
  messageCount?: number | null;
  resetAt?: number | string | null;
  upgradeOptions: ProfileUpgradeOption[];
  pendingUpgradePlan: PaidProfilePlan | null;
  formatPriceLabel: (_plan: PaidProfilePlan, _amount?: number | null) => string;
  onUpgrade: (_plan: PaidProfilePlan, _priceId?: string | null) => void;
}) {
  const usage = buildProfileUsageLimitViewModel({
    plan: props.plan,
    messageCount: props.messageCount,
    currentPeriodEnd: props.resetAt,
  });
  const modelRows = buildProfileModelUsageRows(
    PUBLIC_MODEL_SELECTOR_CATALOG.options,
    formatUsageMultiple
  );
  const progressPercent = usage.ratio === null ? null : Math.round(usage.ratio * 100);
  const progressWidth =
    usage.ratio === null ? 0 : Math.max(usage.ratio * 100, usage.ratio > 0 ? 2 : 0);
  const nextUpgrade = props.upgradeOptions[0] ?? null;

  return (
    <div className="space-y-7">
      <section aria-labelledby="usage-limits-title" className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h4 id="usage-limits-title" className="text-2xl font-semibold">
            Plan usage limits
          </h4>
          <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground uppercase">
            {formatProfilePlanLabel(props.plan)}
          </span>
        </div>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
          Your plan determines how much TaskForceAI can run over time. Advanced models and
          generation tools can consume more usage.
        </p>
        <p className="text-xs text-muted-foreground">
          Usage reflects the latest loaded profile data.
        </p>
      </section>

      <section className="overflow-hidden rounded-lg border border-border bg-muted/30">
        <div className="space-y-4 p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h5 className="text-base font-semibold">{usage.label}</h5>
              <p className="mt-1 text-sm text-muted-foreground">{usage.description}</p>
            </div>
            <span
              className={clsx(
                'shrink-0 text-sm font-semibold',
                usage.tone === 'danger' ? 'text-red-500 dark:text-red-300' : 'text-foreground'
              )}
            >
              {usage.percentLabel}
            </span>
          </div>

          {progressPercent !== null ? (
            <div
              aria-label={usage.label}
              aria-valuemax={100}
              aria-valuemin={0}
              aria-valuenow={progressPercent}
              className="h-2.5 overflow-hidden rounded-full bg-background"
              role="progressbar"
            >
              <div
                className={clsx(
                  'h-full rounded-full transition-[width]',
                  usage.tone === 'danger' ? 'bg-red-500' : 'bg-blue-500'
                )}
                style={{ width: `${progressWidth}%` }}
              />
            </div>
          ) : (
            <div className="rounded-md border border-border bg-background/70 px-3 py-2 text-sm text-muted-foreground">
              No fixed weekly cap is shown for this plan.
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
            <span>{usage.usedLabel}</span>
            {usage.resetLabel ? <span>{usage.resetLabel}</span> : null}
          </div>
        </div>

        {nextUpgrade ? (
          <div className="border-t border-border bg-background/50 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold">
                  Get more usage with {formatProfilePlanLabel(nextUpgrade.plan)}
                </p>
                <p className="mt-1 text-sm text-emerald-600 dark:text-emerald-300">
                  {props.formatPriceLabel(nextUpgrade.plan, nextUpgrade.price_amount)}
                </p>
              </div>
              <Button
                type="button"
                onClick={() => props.onUpgrade(nextUpgrade.plan, nextUpgrade.price_id)}
                disabled={props.pendingUpgradePlan !== null || !nextUpgrade.price_id}
              >
                {props.pendingUpgradePlan === nextUpgrade.plan ? 'Preparing...' : 'Upgrade'}
              </Button>
            </div>
            {!nextUpgrade.price_id ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Checkout link unavailable. Please try again shortly.
              </p>
            ) : null}
          </div>
        ) : null}
      </section>

      <section aria-labelledby="model-usage-rates-title" className="space-y-3">
        <div>
          <h5 id="model-usage-rates-title" className="text-base font-semibold">
            Model usage rates
          </h5>
          <p className="mt-1 text-sm text-muted-foreground">
            Multipliers show how each model draws from plan usage compared with standard capacity.
          </p>
        </div>
        <div className="max-h-72 divide-y divide-border overflow-y-auto rounded-lg border border-border">
          {modelRows.map((model) => (
            <div
              key={model.id}
              className="flex items-start justify-between gap-4 bg-background/50 px-4 py-3"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{model.label}</span>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                    {model.badge}
                  </span>
                </div>
                {model.description ? (
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {model.description}
                  </p>
                ) : null}
              </div>
              <span className="shrink-0 rounded-full border border-border px-2 py-1 text-xs font-semibold">
                {model.usageLabel}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

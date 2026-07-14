'use client';

import { formatStorageBytes, formatStorageItemCount } from '@taskforceai/presenters/storage/format';
import { ChevronRight } from 'lucide-react';

import { Button } from '@taskforceai/ui-kit/button';
import type { StorageSummary } from '../../api/storage';

export function StorageSection(props: {
  summary: StorageSummary | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onManageCategory: (_categoryId: string) => void;
}) {
  if (props.loading && !props.summary) {
    return <p className="text-sm text-muted-foreground">Loading storage...</p>;
  }

  if (props.error && !props.summary) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800/60 dark:bg-red-900/30 dark:text-red-100">
        <p>{props.error}</p>
        <Button className="mt-3" size="sm" variant="outline" onClick={props.onRetry}>
          Retry
        </Button>
      </div>
    );
  }

  const summary = props.summary ?? {
    usedBytes: 0,
    quotaBytes: 0,
    categories: [],
  };
  const quotaBytes = Math.max(0, summary.quotaBytes);
  const usedBytes = Math.max(0, summary.usedBytes);
  const usageRatio = quotaBytes > 0 ? Math.min(1, usedBytes / quotaBytes) : 0;
  const visibleCategories = summary.categories.filter(
    (category) => category.bytes > 0 || category.count > 0 || category.id !== 'pending_uploads'
  );

  return (
    <div className="space-y-8">
      <section aria-labelledby="storage-usage-title" className="space-y-5">
        <div className="border-b border-border pb-6">
          <h4 id="storage-usage-title" className="text-2xl font-semibold">
            {formatStorageBytes(usedBytes)} of {formatStorageBytes(quotaBytes)} used
          </h4>
          <div
            aria-label="Storage used"
            aria-valuemax={quotaBytes}
            aria-valuemin={0}
            aria-valuenow={usedBytes}
            className="mt-6 h-3 overflow-hidden rounded-full border border-border bg-muted"
            role="progressbar"
          >
            <div
              className="h-full rounded-full bg-foreground transition-[width]"
              style={{
                width: `${Math.max(usageRatio * 100, usedBytes > 0 ? 2 : 0)}%`,
              }}
            />
          </div>
          {props.error ? (
            <p className="mt-3 text-xs text-red-600 dark:text-red-300">{props.error}</p>
          ) : null}
        </div>
      </section>

      <section aria-labelledby="storage-manage-title" className="space-y-4">
        <div>
          <h4 id="storage-manage-title" className="text-xl font-semibold">
            Manage storage
          </h4>
          <p className="mt-2 text-sm text-muted-foreground">
            Manage your library to free up storage.
          </p>
        </div>

        <div className="divide-y divide-border border-y border-border">
          {visibleCategories.map((category) => (
            <button
              key={category.id}
              type="button"
              className="flex w-full items-center justify-between gap-4 py-5 text-left transition-colors hover:text-foreground"
              onClick={() => props.onManageCategory(category.id)}
            >
              <span className="min-w-0">
                <span className="block text-base font-medium">{category.label}</span>
                <span className="mt-1 block text-sm text-muted-foreground">
                  {formatStorageBytes(category.bytes)} ·{' '}
                  {formatStorageItemCount(category.id, category.count, {
                    pendingUploadLabel: 'reserved',
                  })}
                </span>
              </span>
              <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

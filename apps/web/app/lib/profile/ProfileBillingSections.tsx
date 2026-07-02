import { Archive, ArchiveRestore, Download, MessageSquare, Trash2, XCircle } from 'lucide-react';

import { Badge } from '@taskforceai/ui-kit/badge';
import { Button } from '@taskforceai/ui-kit/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@taskforceai/ui-kit/dialog';

type PlanKey = 'free' | 'pro' | 'super';

export function UpgradeSection(props: {
  upgradeOptions: Array<{
    plan: Exclude<PlanKey, 'free'>;
    price_id: string | null;
    price_amount: number | null;
  }>;
  planMeta: Record<Exclude<PlanKey, 'free'>, { label: string; throughput: string }>;
  formatPriceLabel: (_plan: Exclude<PlanKey, 'free'>, _amount?: number | null) => string;
  pendingUpgradePlan: Exclude<PlanKey, 'free'> | null;
  onUpgrade: (_plan: Exclude<PlanKey, 'free'>, _priceId?: string | null) => void;
}) {
  if (props.upgradeOptions.length === 0) {
    return null;
  }
  return (
    <div id="subscription-section" className="space-y-3">
      <h3 className="text-sm font-semibold">Upgrade for more throughput</h3>
      <p className="text-sm text-muted-foreground">
        Unlock higher hourly limits and premium support.
      </p>
      <div className="space-y-3">
        {props.upgradeOptions.map((option) => {
          const meta = props.planMeta[option.plan];
          const priceLabel = props.formatPriceLabel(option.plan, option.price_amount);
          return (
            <div
              key={option.plan}
              className="rounded-lg border border-amber-200 p-3 dark:border-amber-900/40"
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-semibold">
                    {meta.label} · {priceLabel}
                  </p>
                  <p className="text-xs text-muted-foreground">{meta.throughput}</p>
                </div>
                <Button
                  id={`upgrade-${option.plan}-btn`}
                  onClick={() => props.onUpgrade(option.plan, option.price_id)}
                  disabled={props.pendingUpgradePlan !== null || !option.price_id}
                  className="w-full sm:w-auto"
                >
                  {props.pendingUpgradePlan === option.plan
                    ? 'Preparing checkout...'
                    : `Upgrade to ${meta.label}`}
                </Button>
              </div>
              {!option.price_id && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Checkout link unavailable. Please try again shortly.
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function SubscriptionSection(props: {
  creditBalanceLabel?: string | null;
  plan: PlanKey;
  messageUsageLabel: string;
  resetLabel?: string | null;
  subscription: {
    status: string;
    current_period_start?: number | null;
    current_period_end?: number | null;
    cancel_at_period_end?: boolean | null;
  } | null;
  loading: boolean;
  onOpenCancelConfirm: () => void;
  onReactivate: () => void;
}) {
  return (
    <div id="subscription-section" className="space-y-6">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Current Plan:</span>
          <Badge id="profile-plan" variant={props.plan === 'free' ? 'secondary' : 'default'}>
            {props.plan}
          </Badge>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Messages:</span>
          <span id="profile-messages" className="text-sm text-muted-foreground">
            {props.messageUsageLabel}
          </span>
        </div>
        {props.creditBalanceLabel ? (
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Credits:</span>
            <span id="profile-credits" className="text-sm text-muted-foreground">
              {props.creditBalanceLabel}
            </span>
          </div>
        ) : null}
        {props.resetLabel ? (
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Usage Window:</span>
            <span id="profile-usage-window" className="text-sm text-muted-foreground">
              {props.resetLabel}
            </span>
          </div>
        ) : null}
      </div>

      {props.subscription ? (
        <div className="space-y-4 border-t border-border pt-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Status:</span>
            <Badge variant="outline">{props.subscription.status}</Badge>
          </div>
          {props.subscription.current_period_start && props.subscription.current_period_end && (
            <div className="text-xs text-muted-foreground">
              Current period:{' '}
              {new Date(props.subscription.current_period_start * 1000).toLocaleDateString()} -{' '}
              {new Date(props.subscription.current_period_end * 1000).toLocaleDateString()}
            </div>
          )}

          {props.subscription.cancel_at_period_end ? (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Subscription will be canceled at the end of the current period.
              </p>
              <Button
                id="reactivate-btn"
                onClick={props.onReactivate}
                disabled={props.loading}
                variant="outline"
                size="sm"
                className="w-full"
              >
                {props.loading ? 'Processing...' : 'Reactivate Subscription'}
              </Button>
            </div>
          ) : (
            <Button
              id="cancel-btn"
              onClick={props.onOpenCancelConfirm}
              disabled={props.loading}
              variant="ghost"
              size="sm"
              className="w-full text-muted-foreground hover:text-destructive"
            >
              {props.loading ? 'Processing...' : 'Cancel Subscription'}
            </Button>
          )}
        </div>
      ) : null}
    </div>
  );
}

export type ArchivedConversationItem = {
  conversationId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  lastMessagePreview?: string | null;
};

const formatArchivedConversationDate = (timestamp: number): string => {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return 'Unknown';
  }
  return new Intl.DateTimeFormat(undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(timestamp));
};

export function DataControlsSection(props: {
  loading: boolean;
  archiveManagementSupported?: boolean;
  archivedManagerOpen?: boolean;
  archivedConversations?: ArchivedConversationItem[];
  archivedConversationsLoading?: boolean;
  archiveActionId?: string | null;
  archiveControlsError?: string | null;
  onExport: () => void;
  onOpenArchivedManager?: () => void;
  onArchivedManagerOpenChange?: (_open: boolean) => void;
  onRestoreConversation?: (_conversationId: string) => void;
  onDeleteConversation?: (_conversationId: string) => void;
  onArchiveAllConversations?: () => void;
  onDeleteAllConversations?: () => void;
  onOpenDeleteConfirm: () => void;
}) {
  const archivedConversations = props.archivedConversations ?? [];
  const archivedManagerOpen = props.archivedManagerOpen ?? false;
  const archiveManagementSupported = props.archiveManagementSupported ?? false;
  const archivedLoading = props.archivedConversationsLoading ?? false;
  const disabled = props.loading || archivedLoading;

  return (
    <div className="space-y-6">
      <div className="divide-y divide-border border-y border-border">
        <div className="flex items-center justify-between gap-4 py-4">
          <div className="min-w-0">
            <h4 className="text-sm font-medium">Archived chats</h4>
            <p className="mt-1 text-xs text-muted-foreground">
              Review, restore, or permanently delete archived conversations.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={props.onOpenArchivedManager}
            disabled={!archiveManagementSupported || disabled}
            title={
              archiveManagementSupported
                ? 'Manage archived chats'
                : 'Archive management is unavailable in this runtime'
            }
          >
            <Archive className="h-4 w-4" aria-hidden="true" />
            Manage
          </Button>
        </div>

        <div className="flex items-center justify-between gap-4 py-4">
          <div className="min-w-0">
            <h4 className="text-sm font-medium">Archive all chats</h4>
            <p className="mt-1 text-xs text-muted-foreground">
              Move every visible conversation out of the sidebar.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={props.onArchiveAllConversations}
            disabled={!props.onArchiveAllConversations || disabled}
          >
            <Archive className="h-4 w-4" aria-hidden="true" />
            Archive all
          </Button>
        </div>

        <div className="flex items-center justify-between gap-4 py-4">
          <div className="min-w-0">
            <h4 className="text-sm font-medium text-destructive">Delete all chats</h4>
            <p className="mt-1 text-xs text-muted-foreground">
              Permanently remove all local conversations and messages.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={props.onDeleteAllConversations}
            disabled={!props.onDeleteAllConversations || disabled}
            className="hover:text-destructive-foreground border-destructive text-destructive hover:bg-destructive"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            Delete all
          </Button>
        </div>

        <div className="flex items-center justify-between gap-4 py-4">
          <div className="min-w-0">
            <h4 className="text-sm font-medium">Export data</h4>
            <p className="mt-1 text-xs text-muted-foreground">
              Download a copy of your personal data in JSON format.
            </p>
          </div>
          <Button
            id="export-data-btn"
            onClick={props.onExport}
            disabled={props.loading}
            variant="outline"
            size="sm"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            {props.loading ? 'Exporting...' : 'Export'}
          </Button>
        </div>

        <div className="flex items-center justify-between gap-4 py-4">
          <div className="min-w-0">
            <h4 className="text-sm font-medium text-destructive">Delete account</h4>
            <p className="mt-1 text-xs text-muted-foreground">
              Permanently remove your account and all associated data. This action cannot be undone.
            </p>
          </div>
          <Button
            id="delete-account-btn"
            onClick={props.onOpenDeleteConfirm}
            disabled={props.loading}
            variant="destructive"
            size="sm"
          >
            <XCircle className="h-4 w-4" aria-hidden="true" />
            {props.loading ? 'Processing...' : 'Delete Account'}
          </Button>
        </div>
      </div>

      {props.archiveControlsError ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {props.archiveControlsError}
        </p>
      ) : null}

      <Dialog open={archivedManagerOpen} onOpenChange={props.onArchivedManagerOpenChange}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Archived chats</DialogTitle>
            <DialogDescription>
              Restore conversations to the sidebar or delete them permanently.
            </DialogDescription>
          </DialogHeader>

          <div className="overflow-hidden border border-border">
            <div className="grid grid-cols-[minmax(0,1fr)_11rem_6rem] gap-4 border-b border-border bg-muted px-3 py-2 text-sm font-semibold">
              <span>Name</span>
              <span>Date created</span>
              <span className="text-right">Actions</span>
            </div>
            <div className="max-h-[min(420px,55vh)] overflow-y-auto">
              {archivedLoading ? (
                <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                  Loading archived chats...
                </div>
              ) : archivedConversations.length === 0 ? (
                <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                  No archived chats.
                </div>
              ) : (
                archivedConversations.map((conversation) => {
                  const restoreBusy =
                    props.archiveActionId === `restore:${conversation.conversationId}`;
                  const deleteBusy =
                    props.archiveActionId === `delete:${conversation.conversationId}`;
                  return (
                    <div
                      key={conversation.conversationId}
                      className="grid grid-cols-[minmax(0,1fr)_11rem_6rem] items-center gap-4 border-b border-border px-3 py-3 last:border-b-0"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <MessageSquare
                          className="h-4 w-4 shrink-0 text-primary"
                          aria-hidden="true"
                        />
                        <span className="truncate text-sm font-medium" title={conversation.title}>
                          {conversation.title || 'Untitled conversation'}
                        </span>
                      </div>
                      <span className="text-sm text-muted-foreground">
                        {formatArchivedConversationDate(conversation.createdAt)}
                      </span>
                      <div className="flex justify-end gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`Restore ${conversation.title || 'conversation'}`}
                          onClick={() => props.onRestoreConversation?.(conversation.conversationId)}
                          disabled={Boolean(props.archiveActionId)}
                          title="Restore"
                        >
                          <ArchiveRestore className="h-4 w-4" aria-hidden="true" />
                          {restoreBusy ? <span className="sr-only">Restoring</span> : null}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`Delete ${conversation.title || 'conversation'}`}
                          onClick={() => props.onDeleteConversation?.(conversation.conversationId)}
                          disabled={Boolean(props.archiveActionId)}
                          title="Delete"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                          {deleteBusy ? <span className="sr-only">Deleting</span> : null}
                        </Button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

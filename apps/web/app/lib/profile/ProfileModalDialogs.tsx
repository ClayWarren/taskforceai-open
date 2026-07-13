'use client';

import * as AlertDialog from '@radix-ui/react-alert-dialog';

import { Button } from '@taskforceai/ui-kit/button';
import { Input } from '@taskforceai/ui-kit/input';

export function CancelSubscriptionDialog(props: {
  open: boolean;
  onOpenChange: (_open: boolean) => void;
  onConfirm: () => void;
  loading: boolean;
}) {
  return (
    <AlertDialog.Root open={props.open} onOpenChange={props.onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=open]:animate-in" />
        <AlertDialog.Content className="fixed top-1/2 left-1/2 z-50 w-[90vw] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-background p-6 shadow-xl data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=open]:animate-in data-[state=open]:fade-in">
          <AlertDialog.Title className="text-lg font-semibold">
            Cancel subscription?
          </AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-sm text-muted-foreground">
            Your plan will stay active until the current period ends. You can reactivate anytime.
          </AlertDialog.Description>
          <div className="mt-6 flex justify-end gap-2">
            <AlertDialog.Cancel asChild>
              <Button variant="ghost">Keep subscription</Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <Button variant="destructive" onClick={props.onConfirm} disabled={props.loading}>
                {props.loading ? 'Processing...' : 'Cancel subscription'}
              </Button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

export function DeleteAccountDialog(props: {
  open: boolean;
  onOpenChange: (_open: boolean) => void;
  onConfirm: () => void;
  loading: boolean;
  deleteInput: string;
  onDeleteInputChange: (_value: string) => void;
  expectedEmail: string;
}) {
  return (
    <AlertDialog.Root open={props.open} onOpenChange={props.onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=open]:animate-in" />
        <AlertDialog.Content className="fixed top-1/2 left-1/2 z-50 w-[90vw] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-background p-6 shadow-xl data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=open]:animate-in data-[state=open]:fade-in">
          <AlertDialog.Title className="text-lg font-semibold">Delete account?</AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-sm text-muted-foreground">
            This permanently removes your data. Type your email to confirm.
          </AlertDialog.Description>
          <div className="mt-4">
            <Input
              value={props.deleteInput}
              onChange={(event) => props.onDeleteInputChange(event.target.value)}
              placeholder={`Type "${props.expectedEmail}" to confirm`}
              aria-label="Confirm email"
            />
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <AlertDialog.Cancel asChild>
              <Button variant="ghost" onClick={() => props.onDeleteInputChange('')}>
                Keep my account
              </Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <Button
                variant="destructive"
                onClick={props.onConfirm}
                disabled={props.deleteInput !== props.expectedEmail || props.loading}
              >
                {props.loading ? 'Deleting...' : 'Delete account'}
              </Button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

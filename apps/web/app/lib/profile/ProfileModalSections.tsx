'use client';

import { getRuntimeEnv } from '@taskforceai/shared/config/app-env';
import { formatStorageBytes, formatStorageItemCount } from '@taskforceai/shared/storage/format';
import type { Memory } from '@taskforceai/contracts/contracts';
import { getBrowserClient } from '@taskforceai/contracts/browserClient';
import clsx from 'clsx';
import QRCode from 'qrcode';
import { ArrowUp, ChevronDown, ChevronRight, X } from 'lucide-react';
import React from 'react';

import ThemeToggle from '../../components/shell/ThemeToggle';
import { Button } from '@taskforceai/ui-kit/button';
import { Switch } from '@taskforceai/ui-kit/switch';
import type { StorageSummary } from '../api/storage';
import { type ThemePreference } from '../platform/theme-preference';

export type ProfileTab =
  | 'general'
  | 'security'
  | 'keyboard'
  | 'notifications'
  | 'personalization'
  | 'subscription'
  | 'storage'
  | 'data'
  | 'finance'
  | 'apps';

export {
  AppsIcon,
  DataIcon,
  FinanceIcon,
  GeneralIcon,
  KeyboardIcon,
  NotificationsIcon,
  PersonalizationIcon,
  SecurityIcon,
  StorageIcon,
  SubscriptionIcon,
} from './ProfileModalIcons';
export { CancelSubscriptionDialog, DeleteAccountDialog } from './ProfileModalDialogs';
export { ConnectedAppsSection } from './ProfileConnectedApps';
export { ProfileFinanceSection } from './ProfileFinanceSection';
export { McpServersSection, type McpServerItem } from './ProfileMcpServers';
export { DataControlsSection, SubscriptionSection, UpgradeSection } from './ProfileBillingSections';

export function FeedbackBanner(props: { message: string | null; kind: 'success' | 'error' }) {
  if (!props.message) {
    return null;
  }
  return (
    <div
      className={clsx(
        'mb-4 rounded-md border px-3 py-2 text-sm',
        props.kind === 'success'
          ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-900/30 dark:text-emerald-100'
          : 'border-red-200 bg-red-50 text-red-700 dark:border-red-800/60 dark:bg-red-900/30 dark:text-red-100'
      )}
      role="status"
    >
      {props.message}
    </div>
  );
}

export function ProfileDetailsSection(props: { fullName: string; email: string }) {
  return (
    <div className="space-y-4">
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground uppercase">
          Name
        </label>
        <div id="profile-fullname" className="text-sm font-medium">
          {props.fullName || 'Not set'}
        </div>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground uppercase">
          Email
        </label>
        <div id="profile-email" className="text-sm font-medium">
          {props.email}
        </div>
      </div>
    </div>
  );
}

export function SettingsSection(props: {
  theme: ThemePreference;
  onThemeChange: (_theme: ThemePreference) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium">Theme</label>
        <ThemeToggle theme={props.theme} onChange={props.onThemeChange} />
      </div>
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium">Version</label>
        <span aria-label="application-version" className="text-sm text-muted-foreground">
          {getRuntimeEnv('VITE_APP_VERSION')}
        </span>
      </div>
    </div>
  );
}

export function SecuritySection(props: {
  initialAuthenticatorEnabled: boolean;
  onAuthenticatorStatusChange?: (_enabled: boolean) => void;
}) {
  const [enabled, setEnabled] = React.useState(props.initialAuthenticatorEnabled);
  const [setupSecret, setSetupSecret] = React.useState<string | null>(null);
  const [setupURI, setSetupURI] = React.useState<string | null>(null);
  const [qrCodeURL, setQRCodeURL] = React.useState<string | null>(null);
  const [setupCode, setSetupCode] = React.useState('');
  const [disableCode, setDisableCode] = React.useState('');
  const [disableOpen, setDisableOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);

  React.useEffect(() => {
    setEnabled(props.initialAuthenticatorEnabled);
  }, [props.initialAuthenticatorEnabled]);

  const resetSetup = () => {
    setSetupSecret(null);
    setSetupURI(null);
    setQRCodeURL(null);
    setSetupCode('');
  };

  const setAuthenticatorEnabled = (nextEnabled: boolean) => {
    setEnabled(nextEnabled);
    props.onAuthenticatorStatusChange?.(nextEnabled);
  };

  const beginSetup = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await getBrowserClient().setupAuthenticatorMFA();
      const qrCode = await QRCode.toDataURL(response.otpauth_uri, {
        errorCorrectionLevel: 'M',
        margin: 1,
        scale: 6,
      });
      setSetupSecret(response.secret);
      setSetupURI(response.otpauth_uri);
      setQRCodeURL(qrCode);
      setDisableOpen(false);
    } catch {
      setError('Failed to start authenticator setup.');
      resetSetup();
    } finally {
      setBusy(false);
    }
  };

  const verifySetup = async () => {
    const code = setupCode.trim();
    if (code.length < 6) {
      setError('Enter the 6-digit code from your authenticator app.');
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await getBrowserClient().verifyAuthenticatorMFA(code);
      setAuthenticatorEnabled(true);
      resetSetup();
      setMessage('Authenticator app enabled.');
    } catch {
      setError('Invalid authenticator code.');
    } finally {
      setBusy(false);
    }
  };

  const disableAuthenticator = async () => {
    const code = disableCode.trim();
    if (code.length < 6) {
      setError('Enter the 6-digit code from your authenticator app.');
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await getBrowserClient().disableAuthenticatorMFA(code);
      setAuthenticatorEnabled(false);
      setDisableCode('');
      setDisableOpen(false);
      setMessage('Authenticator app disabled.');
    } catch {
      setError('Invalid authenticator code.');
    } finally {
      setBusy(false);
    }
  };

  const onToggle = (nextEnabled: boolean) => {
    setError(null);
    setMessage(null);
    if (nextEnabled) {
      void beginSetup();
      return;
    }
    resetSetup();
    setDisableOpen(true);
  };

  return (
    <div className="space-y-6">
      <div>
        <h4 className="text-2xl font-semibold">Multi-factor authentication (MFA)</h4>
      </div>

      {message ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-900/30 dark:text-emerald-100">
          {message}
        </div>
      ) : null}
      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800/60 dark:bg-red-900/30 dark:text-red-100">
          {error}
        </div>
      ) : null}

      <div className="divide-y divide-border border-y border-border">
        <div className="flex items-center justify-between gap-4 py-5">
          <div className="min-w-0 text-left">
            <label className="block text-base font-medium">Authenticator app</label>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Use one-time codes from an authenticator app.
            </p>
          </div>
          <Switch checked={enabled} disabled={busy} onCheckedChange={onToggle} />
        </div>
      </div>

      {setupSecret ? (
        <section className="space-y-4 rounded-md border border-border p-4">
          <div className="flex flex-col gap-4 sm:flex-row">
            {qrCodeURL ? (
              <img
                alt="Authenticator setup QR code"
                className="size-40 shrink-0 rounded-md border border-border bg-white p-2"
                src={qrCodeURL}
              />
            ) : null}
            <div className="min-w-0 flex-1 space-y-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase">
                  Setup key
                </label>
                <code className="mt-1 block rounded-md border border-border bg-muted px-3 py-2 text-sm break-all">
                  {setupSecret}
                </code>
              </div>
              {setupURI ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void navigator.clipboard?.writeText(setupSecret)}
                >
                  Copy setup key
                </Button>
              ) : null}
            </div>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="flex-1 text-sm font-medium">
              Verification code
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-base outline-none focus:border-ring"
                value={setupCode}
                onChange={(event) => setSetupCode(event.currentTarget.value.replace(/\D/g, ''))}
              />
            </label>
            <div className="flex gap-2">
              <Button type="button" onClick={() => void verifySetup()} disabled={busy}>
                {busy ? 'Verifying...' : 'Verify'}
              </Button>
              <Button type="button" variant="ghost" onClick={resetSetup} disabled={busy}>
                Cancel
              </Button>
            </div>
          </div>
        </section>
      ) : null}

      {disableOpen ? (
        <section className="space-y-3 rounded-md border border-border p-4">
          <label className="block text-sm font-medium">
            Current authenticator code
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-base outline-none focus:border-ring"
              value={disableCode}
              onChange={(event) => setDisableCode(event.currentTarget.value.replace(/\D/g, ''))}
            />
          </label>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => void disableAuthenticator()}
              disabled={busy}
            >
              {busy ? 'Disabling...' : 'Disable authenticator'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setDisableCode('');
                setDisableOpen(false);
              }}
              disabled={busy}
            >
              Cancel
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}

const keyboardShortcutGroups = [
  {
    title: 'Composer',
    shortcuts: [
      { action: 'Send message', keys: ['Enter'] },
      { action: 'Add a new line', keys: ['Shift', 'Enter'] },
      { action: 'Start dictation in the web app', keys: ['Ctrl', 'Shift', 'D'] },
      { action: 'Start realtime voice in the web app', keys: ['Ctrl', 'Shift', 'V'] },
      { action: 'Select model in the web app', keys: ['Ctrl', 'Shift', 'M'] },
      { action: 'Start dictation in the desktop app', keys: ['Ctrl', 'M'] },
    ],
  },
  {
    title: 'Slash commands',
    shortcuts: [
      { action: 'Accept suggestion', keys: ['Tab'] },
      { action: 'Accept suggestion', keys: ['Enter'] },
      { action: 'Move through suggestions', keys: ['Up/Down'] },
    ],
  },
  {
    title: 'Overlays',
    shortcuts: [{ action: 'Close the active overlay', keys: ['Esc'] }],
  },
] as const;

export function KeyboardShortcutsSection() {
  return (
    <div className="space-y-6">
      <p className="max-w-xl text-sm leading-6 text-muted-foreground">
        Current keyboard shortcuts. Custom keybindings can be added once shortcuts are centralized.
      </p>

      <div className="divide-y divide-border border-y border-border">
        {keyboardShortcutGroups.map((group) => (
          <section key={group.title} aria-labelledby={`keyboard-${group.title.toLowerCase()}`}>
            <h4
              id={`keyboard-${group.title.toLowerCase()}`}
              className="pt-5 pb-3 text-sm font-semibold text-foreground"
            >
              {group.title}
            </h4>
            <div className="space-y-1 pb-5">
              {group.shortcuts.map((shortcut) => (
                <div
                  key={`${group.title}-${shortcut.action}-${shortcut.keys.join('-')}`}
                  className="flex items-center justify-between gap-4 rounded-md px-1 py-2"
                >
                  <span className="text-sm text-muted-foreground">{shortcut.action}</span>
                  <span
                    className="flex shrink-0 items-center gap-1.5"
                    aria-label={shortcut.keys.join(' ')}
                  >
                    {shortcut.keys.map((key) => (
                      <kbd
                        key={key}
                        className="rounded border border-border bg-muted px-2 py-1 font-mono text-xs font-medium text-foreground shadow-sm"
                      >
                        {key}
                      </kbd>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

export function NotificationsSection(props: {
  enabled: boolean;
  onToggle: (_enabled: boolean) => void;
}) {
  const notificationRows = [
    {
      id: 'taskforceai',
      title: 'TaskForceAI',
      description: 'Get notified about TaskForceAI task activity.',
    },
    {
      id: 'responses',
      title: 'Responses',
      description: 'Get notified when TaskForceAI responds to requests.',
    },
    {
      id: 'tasks',
      title: 'Tasks',
      description: "Get notified when tasks you've created have updates.",
    },
    {
      id: 'projects',
      title: 'Projects',
      description: 'Get notified when you receive an invitation to a shared project.',
    },
    {
      id: 'usage',
      title: 'Usage',
      description: "We'll notify you when request or credit limits reset.",
    },
  ] as const;

  return (
    <div className="divide-y divide-border border-y border-border">
      {notificationRows.map((row) => (
        <div key={row.id} className="flex items-start justify-between gap-4 py-5">
          <div className="min-w-0 flex-1 text-left">
            <label
              className="block text-base font-medium text-foreground"
              htmlFor={`notification-${row.id}`}
            >
              {row.title}
            </label>
            <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
              {row.description}
            </p>
          </div>
          <div className="relative shrink-0">
            <select
              id={`notification-${row.id}`}
              aria-label={`${row.title} notification delivery`}
              className="appearance-none bg-transparent py-0.5 pr-7 pl-1 text-right text-base font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={props.enabled ? 'push' : 'off'}
              onChange={(event) => props.onToggle(event.currentTarget.value === 'push')}
            >
              <option value="push">Push</option>
              <option value="off">Off</option>
            </select>
            <ChevronDown
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 right-0 size-4 -translate-y-1/2 text-foreground"
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export function PersonalizationSection(props: {
  memoryEnabled: boolean;
  onMemoryToggle: (_enabled: boolean) => void;
  onManageMemories: () => void;
  memoryCount?: number;
  webSearchEnabled: boolean;
  onWebSearchToggle: (_enabled: boolean) => void;
  codeExecutionEnabled: boolean;
  onCodeExecutionToggle: (_enabled: boolean) => void;
  trustLayerEnabled: boolean;
  onTrustLayerToggle: (_enabled: boolean) => void;
}) {
  return (
    <div className="space-y-6">
      <section aria-labelledby="memory-settings-title" className="space-y-5">
        <div className="flex items-center gap-2">
          <h4 id="memory-settings-title" className="text-lg font-semibold">
            Memory
          </h4>
          <span
            className="flex size-5 items-center justify-center rounded-full border border-border text-xs text-muted-foreground"
            title="Memory stores user-approved facts and preferences for personalization."
          >
            ?
          </span>
        </div>

        <div className="flex items-center justify-between border-t border-border pt-5">
          <div className="flex flex-col gap-1 text-left">
            <label className="text-sm font-medium">Enable memory</label>
            <p className="max-w-md text-sm leading-6 text-muted-foreground">
              Let TaskForceAI personalize your experience based on remembered facts and preferences.
            </p>
          </div>
          <Switch checked={props.memoryEnabled} onCheckedChange={props.onMemoryToggle} />
        </div>

        <div className="flex items-center justify-between border-t border-border pt-5">
          <div className="flex flex-col gap-1 text-left">
            <label className="text-sm font-medium">Memory summary</label>
            <p className="max-w-md text-sm leading-6 text-muted-foreground">
              View and manage what TaskForceAI has remembered about you.
            </p>
            {props.memoryCount !== undefined ? (
              <p className="text-xs text-muted-foreground">
                {props.memoryCount === 1 ? '1 saved memory' : `${props.memoryCount} saved memories`}
              </p>
            ) : null}
          </div>
          <Button variant="outline" size="sm" onClick={props.onManageMemories}>
            Manage
          </Button>
        </div>
      </section>

      <div className="flex items-center justify-between border-t border-border pt-6">
        <div className="flex flex-col gap-0.5 text-left">
          <label className="text-sm font-medium">Web Search</label>
          <p className="text-xs text-muted-foreground">
            Allow AI to search the web for real-time info
          </p>
        </div>
        <Switch checked={props.webSearchEnabled} onCheckedChange={props.onWebSearchToggle} />
      </div>

      <div className="flex items-center justify-between border-t border-border pt-6">
        <div className="flex flex-col gap-0.5 text-left">
          <label className="text-sm font-medium">Code Execution</label>
          <p className="text-xs text-muted-foreground">Allow AI to run code for complex tasks</p>
        </div>
        <Switch
          checked={props.codeExecutionEnabled}
          onCheckedChange={props.onCodeExecutionToggle}
        />
      </div>

      <div className="flex items-center justify-between border-t border-border pt-6">
        <div className="flex flex-col gap-0.5 text-left">
          <label className="text-sm font-medium">Trust Layer</label>
          <p className="text-xs text-muted-foreground">
            Enable execution reports, rubrics, and approval gates
          </p>
        </div>
        <Switch checked={props.trustLayerEnabled} onCheckedChange={props.onTrustLayerToggle} />
      </div>
    </div>
  );
}

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

const formatMemoryUpdatedLabel = (memories: Memory[]) => {
  const latest = memories
    .map((memory) => Date.parse(memory.updated_at))
    .filter(Number.isFinite)
    .toSorted((a, b) => b - a)[0];
  if (!latest) {
    return 'No saved memories';
  }

  const ageMs = Date.now() - latest;
  if (ageMs < 60_000) {
    return 'Updated just now';
  }
  if (ageMs < 3_600_000) {
    const minutes = Math.max(1, Math.floor(ageMs / 60_000));
    return `Updated ${minutes}m ago`;
  }
  return `Updated ${new Date(latest).toLocaleDateString()}`;
};

export function MemorySummaryDialog(props: {
  open: boolean;
  memories: Memory[];
  loading: boolean;
  error: string | null;
  actionId: number | 'new' | null;
  onOpenChange: (_open: boolean) => void;
  onRefresh: () => void;
  onCreate: (_content: string, _type: string) => Promise<boolean>;
  onUpdate: (_id: number, _content: string, _type: string) => Promise<boolean>;
  onDelete: (_id: number) => Promise<boolean>;
}) {
  const [draft, setDraft] = React.useState('');
  const [draftType, setDraftType] = React.useState('preference');
  const [editingId, setEditingId] = React.useState<number | null>(null);
  const [editingContent, setEditingContent] = React.useState('');
  const [editingType, setEditingType] = React.useState('preference');

  React.useEffect(() => {
    if (!props.open) {
      setDraft('');
      setDraftType('preference');
      setEditingId(null);
      setEditingContent('');
      setEditingType('preference');
    }
  }, [props.open]);

  if (!props.open) {
    return null;
  }

  const submitDraft = async () => {
    const content = draft.trim();
    if (!content) {
      return;
    }
    const saved = await props.onCreate(content, draftType);
    if (saved) {
      setDraft('');
      setDraftType('preference');
    }
  };

  const startEditing = (memory: Memory) => {
    setEditingId(memory.id);
    setEditingContent(memory.content);
    setEditingType(memory.type);
  };

  const submitEdit = async (id: number) => {
    const content = editingContent.trim();
    if (!content) {
      return;
    }
    const saved = await props.onUpdate(id, content, editingType);
    if (saved) {
      setEditingId(null);
    }
  };

  const updatedLabel = formatMemoryUpdatedLabel(props.memories);

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/65 p-4">
      <section
        aria-modal="true"
        aria-labelledby="memory-summary-title"
        role="dialog"
        className="flex max-h-[min(780px,92vh)] w-[min(780px,96vw)] flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl"
      >
        <header className="flex items-center justify-between border-b border-border px-6 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <h3 id="memory-summary-title" className="truncate text-2xl font-semibold">
              Memory summary
            </h3>
            <span className="shrink-0 text-sm text-muted-foreground">{updatedLabel}</span>
          </div>
          <button
            type="button"
            aria-label="Close memory summary"
            className="flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={() => props.onOpenChange(false)}
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {props.loading ? (
            <p className="text-sm text-muted-foreground">Loading memories...</p>
          ) : props.error ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800/60 dark:bg-red-900/30 dark:text-red-100">
              <p>{props.error}</p>
              <Button className="mt-3" size="sm" variant="outline" onClick={props.onRefresh}>
                Retry
              </Button>
            </div>
          ) : props.memories.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No saved memories yet. Add a fact or preference below.
            </p>
          ) : (
            <ul className="space-y-3">
              {props.memories.map((memory) => (
                <li key={memory.id} className="rounded-lg border border-border p-4">
                  {editingId === memory.id ? (
                    <div className="space-y-3">
                      <textarea
                        aria-label={`Edit memory ${memory.id}`}
                        className="min-h-24 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-ring"
                        value={editingContent}
                        onInput={(event) => setEditingContent(event.currentTarget.value)}
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          aria-label={`Memory ${memory.id} type`}
                          className="rounded-md border border-border bg-background px-2 py-1 text-sm"
                          value={editingType}
                          onChange={(event) => setEditingType(event.target.value)}
                        >
                          <option value="preference">Preference</option>
                          <option value="fact">Fact</option>
                          <option value="finance">Finance</option>
                        </select>
                        <Button
                          size="sm"
                          onClick={() => void submitEdit(memory.id)}
                          disabled={props.actionId === memory.id}
                        >
                          {props.actionId === memory.id ? 'Saving...' : 'Save'}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-sm leading-6 whitespace-pre-wrap">{memory.content}</p>
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span className="rounded-full border border-border px-2 py-0.5 capitalize">
                            {memory.type}
                          </span>
                          <span>{new Date(memory.updated_at).toLocaleDateString()}</span>
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" onClick={() => startEditing(memory)}>
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => void props.onDelete(memory.id)}
                            disabled={props.actionId === memory.id}
                          >
                            {props.actionId === memory.id ? 'Deleting...' : 'Delete'}
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-t border-border p-5">
          <div className="flex items-end gap-3 rounded-full bg-black p-2 dark:bg-black">
            <textarea
              aria-label="Add or update memory"
              placeholder="Add or update"
              className="min-h-12 flex-1 resize-none rounded-full bg-transparent px-4 py-3 text-sm text-white outline-none placeholder:text-white/60"
              value={draft}
              onInput={(event) => setDraft(event.currentTarget.value)}
            />
            <select
              aria-label="New memory type"
              className="mb-1 hidden rounded-full border border-white/20 bg-black px-3 py-2 text-xs text-white sm:block"
              value={draftType}
              onChange={(event) => setDraftType(event.target.value)}
            >
              <option value="preference">Preference</option>
              <option value="fact">Fact</option>
              <option value="finance">Finance</option>
            </select>
            <button
              type="button"
              aria-label="Save memory"
              className="mb-0.5 flex size-11 shrink-0 items-center justify-center rounded-full bg-white text-xl leading-none text-black disabled:opacity-50"
              disabled={!draft.trim() || props.actionId === 'new'}
              onClick={() => void submitDraft()}
            >
              <ArrowUp className="size-5" aria-hidden="true" />
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

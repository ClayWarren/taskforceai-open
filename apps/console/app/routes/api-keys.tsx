import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { KeyRound, Plus, Trash2, Copy, Check, RefreshCw, AlertCircle } from 'lucide-react';

import { createDeveloperApiKey, revokeDeveloperApiKey } from '../lib/developer/developer-dashboard';
import { useDeveloperUsageStats } from '../lib/developer/useDeveloperUsageStats';
import { logger } from '../lib/logger';
import {
  confirmAction,
  showAlert,
  writeClipboardText,
} from '@taskforceai/browser-runtime/browser-actions';
import { useAuth } from '@taskforceai/ui-kit/auth/AuthProvider';
import { Button } from '@taskforceai/ui-kit/button';
import { Badge } from '@taskforceai/ui-kit/badge';
import { Card } from '@taskforceai/ui-kit/card';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@taskforceai/ui-kit/dialog';
import { AuthLoadingState } from '../components/auth/AuthLoadingState';
import { AuthSignInGate } from '../components/auth/AuthSignInGate';
import { resolveConsoleUserScope } from '../lib/auth/user-scope';

export const Route = createFileRoute('/api-keys')({
  component: APIKeysPage,
});

function APIKeysPage() {
  const { isAuthenticated, isLoading: isAuthLoading, user } = useAuth();
  const userScope = resolveConsoleUserScope(user);
  const authSessionRef = useRef({ isAuthenticated, userScope });
  authSessionRef.current = { isAuthenticated, userScope };
  const {
    stats,
    loading,
    refresh: refreshUsageStats,
  } = useDeveloperUsageStats({
    isAuthenticated,
    isAuthLoading,
    userScope,
  });
  const [creatingKey, setCreatingKey] = useState(false);
  const [revokingKeyId, setRevokingKeyId] = useState<number | null>(null);
  const [newApiKey, setNewApiKey] = useState<string | null>(null);
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const notify = (message: string) => {
    const result = showAlert(message);
    if (!result.ok) {
      logger.warn('Failed to show alert', { error: result.error });
    }
  };

  const closeNewKeyModal = () => {
    setShowKeyModal(false);
    setNewApiKey(null);
    setCopiedKey(null);
  };

  useEffect(() => {
    setNewApiKey(null);
    setShowKeyModal(false);
    setCopiedKey(null);
  }, [isAuthenticated, userScope]);

  const createAPIKey = async () => {
    if (creatingKey) return;
    const requestUserScope = userScope;
    setCreatingKey(true);
    try {
      const result = await createDeveloperApiKey();
      const currentSession = authSessionRef.current;
      if (!currentSession.isAuthenticated || currentSession.userScope !== requestUserScope) return;

      if (result.ok) {
        setNewApiKey(result.value.apiKey);
        setShowKeyModal(true);
        const refreshResult = await refreshUsageStats();
        if (
          !refreshResult.ok &&
          authSessionRef.current.isAuthenticated &&
          authSessionRef.current.userScope === requestUserScope
        ) {
          notify('Key created, but failed to fetch updated usage stats.');
        }
      } else {
        notify(`Failed to create API key: ${result.error.message}`);
      }
    } catch (error) {
      logger.error('Failed to create API key', error);
      if (
        authSessionRef.current.isAuthenticated &&
        authSessionRef.current.userScope === requestUserScope
      ) {
        notify('Failed to create API key. Please try again.');
      }
    } finally {
      setCreatingKey(false);
    }
  };

  const revokeAPIKey = async (keyId: number, displayKey: string) => {
    const confirmResult = confirmAction(`Are you sure you want to revoke API key ${displayKey}?`);
    if (!confirmResult.ok) {
      logger.warn('Failed to show revoke API key confirmation', {
        error: confirmResult.error,
      });
      notify('Unable to confirm revocation. Please try again.');
      return;
    }
    if (!confirmResult.value) return;

    const requestUserScope = userScope;
    setRevokingKeyId(keyId);
    try {
      const result = await revokeDeveloperApiKey(keyId);
      const currentSession = authSessionRef.current;
      if (!currentSession.isAuthenticated || currentSession.userScope !== requestUserScope) return;

      if (result.ok) {
        const refreshResult = await refreshUsageStats();
        if (
          !refreshResult.ok &&
          authSessionRef.current.isAuthenticated &&
          authSessionRef.current.userScope === requestUserScope
        ) {
          notify('Key revoked, but failed to fetch updated usage stats.');
        }
      } else {
        notify(`Failed to revoke API key: ${result.error.message}`);
      }
    } catch (error) {
      logger.error('Failed to revoke API key', error);
      if (
        authSessionRef.current.isAuthenticated &&
        authSessionRef.current.userScope === requestUserScope
      ) {
        notify('Failed to revoke API key. Please try again.');
      }
    } finally {
      setRevokingKeyId(null);
    }
  };

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>;
    if (copiedKey) {
      timeoutId = setTimeout(() => setCopiedKey(null), 2000);
    }
    return () => clearTimeout(timeoutId);
  }, [copiedKey]);

  const copyToClipboard = async (text: string) => {
    const requestUserScope = userScope;
    const result = await writeClipboardText(text);
    if (
      authSessionRef.current.isAuthenticated &&
      authSessionRef.current.userScope === requestUserScope &&
      result.ok
    ) {
      setCopiedKey(text);
    } else if (!result.ok && authSessionRef.current.userScope === requestUserScope) {
      notify(result.error.message);
    }
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'Never';
    return new Date(dateString).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const formatDateTime = (dateString: string | null) => {
    if (!dateString) return 'Never';
    return new Date(dateString).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (isAuthLoading) {
    return <AuthLoadingState label="Loading API keys" />;
  }

  if (loading && !stats && isAuthenticated) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <RefreshCw className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <AuthSignInGate
        icon={KeyRound}
        title="API Keys"
        description="You need to be signed in to manage your API keys and access the TaskForceAI platform."
      />
    );
  }

  return (
    <div className="space-y-12 duration-500 animate-in fade-in">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-4xl font-bold tracking-tight text-white">API Keys</h1>
          <p className="mt-2 text-slate-400">Manage your credentials for TaskForceAI API access</p>
        </div>
        <Button onClick={() => void createAPIKey()} disabled={creatingKey} className="gap-2">
          {creatingKey ? (
            <RefreshCw className="h-4 w-4 animate-spin" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
          Create New Key
        </Button>
      </div>

      {/* Keys Table */}
      <Card className="overflow-hidden border-white/10 bg-white/[0.02]">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-white/5 bg-white/[0.02] text-[10px] font-bold tracking-widest text-slate-500 uppercase">
                <th className="px-6 py-4">Key</th>
                <th className="px-6 py-4">Tier</th>
                <th className="px-6 py-4">Requests This Month</th>
                <th className="px-6 py-4">Created</th>
                <th className="px-6 py-4">Last Used</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {!stats?.apiKeys || stats.apiKeys.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-slate-500">
                    No API keys found. Create one to get started.
                  </td>
                </tr>
              ) : (
                stats.apiKeys.map((key) => (
                  <tr key={key.keyId} className="transition-colors hover:bg-white/[0.02]">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <code className="rounded bg-white/5 px-2 py-1 font-mono text-sm text-blue-400">
                          {key.displayKey}
                        </code>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <Badge variant="outline" className="border-white/10 text-[10px] uppercase">
                        {key.tier}
                      </Badge>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-sm font-bold text-white">
                        {key.monthlyUsage.toLocaleString()}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-400">
                      {formatDate(key.createdAt)}
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-400">
                      {formatDateTime(key.lastUsedAt)}
                    </td>
                    <td className="px-6 py-4">
                      {key.revokedAt ? (
                        <Badge
                          variant="destructive"
                          className="bg-red-500/10 text-[10px] text-red-400 uppercase"
                        >
                          Revoked
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="border-green-500/20 bg-green-500/10 text-[10px] text-green-400 uppercase"
                        >
                          Active
                        </Badge>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      {!key.revokedAt && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-red-400 hover:bg-red-500/10 hover:text-red-300"
                          onClick={() => void revokeAPIKey(key.keyId, key.displayKey)}
                          disabled={revokingKeyId === key.keyId}
                          aria-label={`Revoke API key ${key.displayKey}`}
                        >
                          {revokingKeyId === key.keyId ? (
                            <RefreshCw className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Security Tip */}
      <div className="flex items-start gap-4 rounded-xl border border-blue-500/10 bg-blue-600/5 p-6 text-sm">
        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-blue-500" />
        <div className="space-y-1">
          <p className="font-bold text-blue-100">Security Warning</p>
          <p className="text-blue-200/70 italic">
            Never share your API keys or expose them in client-side code. If a key is compromised,
            revoke it immediately and generate a new one.
          </p>
        </div>
      </div>

      <Dialog
        open={showKeyModal && Boolean(newApiKey)}
        onOpenChange={(open) => {
          if (!open) closeNewKeyModal();
        }}
      >
        {newApiKey && (
          <DialogContent className="border-white/10 bg-slate-900 text-white sm:max-w-lg">
            <DialogHeader>
              <DialogTitle className="text-2xl text-white">Save your API Key</DialogTitle>
              <DialogDescription className="text-slate-400">
                For security, we only show this key once. Copy it now.
              </DialogDescription>
            </DialogHeader>

            <div className="flex items-center gap-3 rounded-xl bg-white/5 p-4 font-mono text-sm break-all text-blue-400">
              <KeyRound className="h-4 w-4 shrink-0 text-slate-500" />
              {newApiKey}
            </div>

            <DialogFooter className="gap-3 sm:space-x-0">
              <Button
                className="flex-1"
                onClick={() => {
                  copyToClipboard(newApiKey).catch((error) => {
                    logger.error('Failed to copy key', error);
                  });
                }}
              >
                {copiedKey === newApiKey ? (
                  <Check className="mr-2 h-4 w-4" />
                ) : (
                  <Copy className="mr-2 h-4 w-4" />
                )}
                {copiedKey === newApiKey ? 'Copied' : 'Copy Key'}
              </Button>
              <DialogClose asChild>
                <Button variant="outline" className="flex-1 border-white/10 hover:bg-white/5">
                  Done
                </Button>
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}

import { createFileRoute } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { KeyRound, Plus, Trash2, Copy, Check, RefreshCw, AlertCircle } from 'lucide-react';

import { authClient } from '../lib/auth/auth-client';
import {
  type UsageStats,
  createDeveloperApiKey,
  readCachedUsageStats,
  refreshUsageStats as refreshUsageStatsRequest,
  revokeDeveloperApiKey,
} from '../lib/developer/developer-dashboard';
import { logger } from '../lib/logger';
import { confirmAction, showAlert, writeClipboardText } from '../lib/platform/browser-actions';
import { useAuth } from '../lib/providers/AuthProvider';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Card } from '../components/ui/card';
import { LogIn } from 'lucide-react';

export const Route = createFileRoute('/api-keys')({
  component: APIKeysPage,
});

function APIKeysPage() {
  const { isAuthenticated } = useAuth();
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [creatingKey, setCreatingKey] = useState(false);
  const [revokingKeyId, setRevokingKeyId] = useState<number | null>(null);
  const [newApiKey, setNewApiKey] = useState<string | null>(null);
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const statsRefreshIdRef = useRef(0);

  const notify = (message: string) => {
    const result = showAlert(message);
    if (!result.ok) {
      logger.warn('Failed to show alert', { error: result.error });
    }
  };

  useEffect(
    () => () => {
      mountedRef.current = false;
      statsRefreshIdRef.current += 1;
    },
    []
  );

  const refreshUsageStats = useCallback(async () => {
    const requestId = statsRefreshIdRef.current + 1;
    statsRefreshIdRef.current = requestId;
    const result = await refreshUsageStatsRequest();
    if (!mountedRef.current || requestId !== statsRefreshIdRef.current) return result;

    if (result.ok) {
      setStats(result.value);
    } else {
      logger.error('Failed to fetch usage stats', {
        message: result.error.message,
        status: result.error.status,
      });
    }
    setLoading(false);
    return result;
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      setLoading(false);
      return;
    }

    const cached = readCachedUsageStats();
    if (cached.ok) {
      setStats(cached.value);
      setLoading(false);
    }
    void refreshUsageStats();
  }, [isAuthenticated, refreshUsageStats]);

  const createAPIKey = async () => {
    if (creatingKey) return;
    setCreatingKey(true);
    try {
      const result = await createDeveloperApiKey();
      if (result.ok) {
        setNewApiKey(result.value.apiKey);
        setShowKeyModal(true);
        const refreshResult = await refreshUsageStats();
        if (!refreshResult.ok) {
          notify('Key created, but failed to fetch updated usage stats.');
        }
      } else {
        notify(`Failed to create API key: ${result.error.message}`);
      }
    } catch (error) {
      logger.error('Failed to create API key', error);
      notify('Failed to create API key. Please try again.');
    } finally {
      setCreatingKey(false);
    }
  };

  const revokeAPIKey = async (keyId: number, displayKey: string) => {
    const confirmResult = confirmAction(`Are you sure you want to revoke API key ${displayKey}?`);
    if (!confirmResult.ok || !confirmResult.value) return;

    setRevokingKeyId(keyId);
    try {
      const result = await revokeDeveloperApiKey(keyId);
      if (result.ok) {
        const refreshResult = await refreshUsageStats();
        if (!refreshResult.ok) {
          notify('Key revoked, but failed to fetch updated usage stats.');
        }
      } else {
        notify(`Failed to revoke API key: ${result.error.message}`);
      }
    } catch (error) {
      logger.error('Failed to revoke API key', error);
      notify('Failed to revoke API key. Please try again.');
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
    const result = await writeClipboardText(text);
    if (result.ok) {
      setCopiedKey(text);
    } else {
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

  if (loading && !stats && isAuthenticated) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <RefreshCw className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center space-y-6 text-center duration-500 animate-in fade-in slide-in-from-bottom-4">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-blue-600/10">
          <KeyRound className="h-10 w-10 text-blue-500" />
        </div>
        <div className="max-w-md space-y-2">
          <h1 className="text-3xl font-bold text-white">API Keys</h1>
          <p className="text-slate-400">
            You need to be signed in to manage your API keys and access the TaskForceAI platform.
          </p>
        </div>
        <Button
          size="lg"
          onClick={() =>
            (window.location.href = authClient.getSignInUrl({ callbackUrl: window.location.href }))
          }
          className="gap-2 bg-blue-600 hover:bg-blue-500"
        >
          <LogIn className="h-4 w-4" />
          Sign in to continue
        </Button>
      </div>
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
                <th className="px-6 py-4">Monthly Usage</th>
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
                      <div className="flex flex-col">
                        <span className="text-sm font-bold text-white">
                          {key.monthlyUsage.toLocaleString()}
                        </span>
                        <span className="text-[10px] text-slate-500">
                          of {key.monthlyQuota.toLocaleString()}
                        </span>
                      </div>
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

      {/* New Key Modal */}
      {showKeyModal && newApiKey && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-lg rounded-2xl border border-white/10 bg-slate-900 p-8 shadow-2xl">
            <h3 className="text-2xl font-bold text-white">Save your API Key</h3>
            <p className="mt-2 text-slate-400">
              For security, we only show this key once. Copy it now.
            </p>

            <div className="mt-6 flex items-center gap-3 rounded-xl bg-white/5 p-4 font-mono text-sm break-all text-blue-400">
              <KeyRound className="h-4 w-4 shrink-0 text-slate-500" />
              {newApiKey}
            </div>

            <div className="mt-8 flex gap-3">
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
              <Button
                variant="outline"
                className="flex-1 border-white/10 hover:bg-white/5"
                onClick={() => {
                  setShowKeyModal(false);
                  setNewApiKey(null);
                }}
              >
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

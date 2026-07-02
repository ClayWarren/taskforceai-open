'use client';

import clsx from 'clsx';
import QRCode from 'qrcode';
import { useCallback, useEffect, useState } from 'react';

import { definedProps } from '@taskforceai/shared/utils/object';
import { Switch } from '@taskforceai/ui-kit/switch';

import {
  captureDesktopScreenMemoryNow,
  connectDesktopAppServerSshTarget,
  disconnectRemoteDesktopAppServerEnvironment,
  getDesktopAppServerEnvironmentStatus,
  getDesktopAppServerHybridMode,
  getDesktopAppServerPet,
  getDesktopScreenMemoryStatus,
  listDesktopAppServerPlugins,
  probeDesktopAppServerSshTarget,
  setDesktopAppServerHybridMode,
  setDesktopAppServerPet,
  setDesktopAppServerPluginEnabled,
  setDesktopScreenMemoryEnabled,
  setDesktopScreenMemoryPaused,
  type AppServerEnvironmentStatus,
  type AppServerHybridModeResult,
  type AppServerPetState,
  type AppServerPluginListResult,
  type AppServerSshConnectResult,
  type AppServerSshProbeResult,
  type DesktopScreenMemoryStatus,
} from '../platform/desktop/app-server';
import {
  createDesktopHttpPairingDeepLink,
  mintDesktopHttpPairingInfo,
} from '../platform/desktop/http-app-server';
import { useDesktopHttpAppServerPairing } from '../platform/desktop/useDesktopHttpAppServerPairing';

const PET_MOODS = ['focus', 'idle', 'celebrate', 'alert'] as const;
type MobilePairingLinkStatus = 'idle' | 'generating' | 'ready' | 'copied' | 'error';
type SshProbeStatus = 'idle' | 'probing' | 'ready' | 'error';
type SshConnectStatus = 'idle' | 'connecting' | 'connected' | 'error';
type ScreenMemoryActionStatus = 'idle' | 'saving' | 'capturing' | 'error';
type SavedRemoteEnvironment = {
  id: string;
  target: string;
  appServerPath?: string | null;
  lastLocalBaseUrl?: string | null;
};

const REMOTE_ENVIRONMENTS_STORAGE_KEY = '@taskforceai:desktop-remote-environments';

const loadSavedRemoteEnvironments = (): SavedRemoteEnvironment[] => {
  if (typeof window === 'undefined') {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(REMOTE_ENVIRONMENTS_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(
      (item): item is SavedRemoteEnvironment =>
        item &&
        typeof item === 'object' &&
        typeof item.id === 'string' &&
        typeof item.target === 'string'
    );
  } catch {
    return [];
  }
};

const saveRemoteEnvironments = (environments: SavedRemoteEnvironment[]) => {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(REMOTE_ENVIRONMENTS_STORAGE_KEY, JSON.stringify(environments));
};

const formatEnvironmentStatus = (status: AppServerEnvironmentStatus | null) => {
  if (!status || status.active === 'local') {
    return 'Local app-server';
  }
  const target = status.target ?? 'Remote';
  if (!status.remoteConnected) {
    return `${target} disconnected`;
  }
  if (status.localPort && status.remotePort) {
    return `${target} tunnel ${status.localPort} -> ${status.remotePort}`;
  }
  return `${target} at ${status.localBaseUrl ?? 'SSH tunnel'}`;
};

const formatEnvironmentDetail = (status: AppServerEnvironmentStatus | null) => {
  if (!status?.remoteConnected) {
    return null;
  }
  if (status.localBaseUrl && status.remoteBaseUrl) {
    return `${status.localBaseUrl} to ${status.remoteBaseUrl}`;
  }
  return status.localBaseUrl ?? status.remoteBaseUrl ?? null;
};

const formatScreenMemoryTime = (value?: number | null) => {
  if (!value) {
    return 'No captures yet';
  }
  return new Date(value).toLocaleString();
};

export function DesktopLocalSection() {
  const [hybrid, setHybrid] = useState<AppServerHybridModeResult | null>(null);
  const [pet, setPet] = useState<AppServerPetState | null>(null);
  const [plugins, setPlugins] = useState<AppServerPluginListResult['plugins']>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mobilePairingLink, setMobilePairingLink] = useState<string | null>(null);
  const [mobilePairingQrCode, setMobilePairingQrCode] = useState<string | null>(null);
  const [mobilePairingStatus, setMobilePairingStatus] = useState<MobilePairingLinkStatus>('idle');
  const [mobilePairingError, setMobilePairingError] = useState<string | null>(null);
  const [sshTarget, setSshTarget] = useState('');
  const [sshProbeStatus, setSshProbeStatus] = useState<SshProbeStatus>('idle');
  const [sshProbeResult, setSshProbeResult] = useState<AppServerSshProbeResult | null>(null);
  const [sshProbeError, setSshProbeError] = useState<string | null>(null);
  const [sshConnectStatus, setSshConnectStatus] = useState<SshConnectStatus>('idle');
  const [sshConnectResult, setSshConnectResult] = useState<AppServerSshConnectResult | null>(null);
  const [sshConnectError, setSshConnectError] = useState<string | null>(null);
  const [environmentStatus, setEnvironmentStatus] = useState<AppServerEnvironmentStatus | null>(
    null
  );
  const [screenMemory, setScreenMemory] = useState<DesktopScreenMemoryStatus | null>(null);
  const [screenMemoryActionStatus, setScreenMemoryActionStatus] =
    useState<ScreenMemoryActionStatus>('idle');
  const [screenMemoryError, setScreenMemoryError] = useState<string | null>(null);
  const [savedRemoteEnvironments, setSavedRemoteEnvironments] = useState<SavedRemoteEnvironment[]>(
    () => loadSavedRemoteEnvironments()
  );
  const pairing = useDesktopHttpAppServerPairing();

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [hybridResult, petResult, pluginResult, screenMemoryResult] = await Promise.all([
        getDesktopAppServerHybridMode(),
        getDesktopAppServerPet(),
        listDesktopAppServerPlugins(),
        getDesktopScreenMemoryStatus(),
      ]);
      setHybrid(hybridResult);
      setPet(petResult.pet);
      setPlugins(pluginResult.plugins);
      setScreenMemory(screenMemoryResult);
    } catch {
      setError('Local capabilities are unavailable.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    void getDesktopAppServerEnvironmentStatus()
      .then(setEnvironmentStatus)
      .catch(() => undefined);
  }, [refresh]);

  const updateHybrid = async (enabled: boolean) => {
    const modelId = enabled ? (hybrid?.modelId ?? hybrid?.recommendedModelId) : null;
    const next = await setDesktopAppServerHybridMode({
      enabled,
      ...definedProps({ modelId }),
      ...definedProps({ role: hybrid?.role }),
    });
    setHybrid(next);
  };

  const updatePet = async (patch: Partial<Pick<AppServerPetState, 'mood' | 'visible'>>) => {
    const next = await setDesktopAppServerPet(patch);
    setPet(next.pet);
  };

  const updatePlugin = async (pluginId: string, enabled: boolean) => {
    const next = await setDesktopAppServerPluginEnabled(pluginId, enabled);
    setPlugins(next.plugins);
  };

  const copyMobilePairingLink = async () => {
    if (!pairing.session) {
      setMobilePairingError('Pairing transport is not connected.');
      setMobilePairingStatus('error');
      return;
    }

    setMobilePairingStatus('generating');
    setMobilePairingError(null);
    try {
      const info = await mintDesktopHttpPairingInfo(pairing.session);
      const link = createDesktopHttpPairingDeepLink(info);
      const qrCode = await QRCode.toDataURL(link, {
        errorCorrectionLevel: 'M',
        margin: 1,
        scale: 6,
      });
      setMobilePairingLink(link);
      setMobilePairingQrCode(qrCode);
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(link);
        setMobilePairingStatus('copied');
      } else {
        setMobilePairingStatus('ready');
      }
    } catch (caught) {
      setMobilePairingQrCode(null);
      setMobilePairingError(
        caught instanceof Error ? caught.message : 'Mobile pairing link failed.'
      );
      setMobilePairingStatus('error');
    }
  };

  const probeSshTarget = async () => {
    const target = sshTarget.trim();
    if (!target) {
      setSshProbeError('Enter an SSH target.');
      setSshProbeStatus('error');
      return;
    }

    setSshProbeStatus('probing');
    setSshProbeResult(null);
    setSshProbeError(null);
    try {
      const result = await probeDesktopAppServerSshTarget({ target });
      setSshProbeResult(result);
      setSshProbeStatus(result.appServerAvailable ? 'ready' : 'error');
      setSshProbeError(result.appServerAvailable ? null : result.message);
    } catch (caught) {
      setSshProbeError(caught instanceof Error ? caught.message : 'SSH probe failed.');
      setSshProbeStatus('error');
    }
  };

  const rememberRemoteEnvironment = useCallback(
    (result: AppServerSshConnectResult, appServerPath?: string | null) => {
      const nextEnvironment: SavedRemoteEnvironment = {
        id: result.target,
        target: result.target,
        appServerPath: appServerPath || null,
        lastLocalBaseUrl: result.localBaseUrl,
      };
      setSavedRemoteEnvironments((current) => {
        const next = [
          nextEnvironment,
          ...current.filter((environment) => environment.id !== nextEnvironment.id),
        ].slice(0, 8);
        saveRemoteEnvironments(next);
        return next;
      });
    },
    []
  );

  const connectSshTarget = async (environment?: SavedRemoteEnvironment) => {
    const target = (environment?.target ?? sshTarget).trim();
    if (!target) {
      setSshConnectError('Enter an SSH target.');
      setSshConnectStatus('error');
      return;
    }

    setSshConnectStatus('connecting');
    setSshConnectResult(null);
    setSshConnectError(null);
    try {
      const result = await connectDesktopAppServerSshTarget({
        target,
        appServerPath: environment?.appServerPath ?? sshProbeResult?.appServerPath ?? null,
      });
      setSshTarget(target);
      setSshConnectResult(result);
      setSshConnectStatus('connected');
      setEnvironmentStatus({
        active: 'remote',
        target: result.target,
        localBaseUrl: result.localBaseUrl,
        remoteBaseUrl: result.remoteBaseUrl,
        localPort: result.localPort,
        remotePort: result.remotePort,
        remoteConnected: true,
      });
      rememberRemoteEnvironment(
        result,
        environment?.appServerPath ?? sshProbeResult?.appServerPath
      );
    } catch (caught) {
      setSshConnectError(caught instanceof Error ? caught.message : 'SSH connection failed.');
      setSshConnectStatus('error');
    }
  };

  const forgetRemoteEnvironment = (id: string) => {
    setSavedRemoteEnvironments((current) => {
      const next = current.filter((environment) => environment.id !== id);
      saveRemoteEnvironments(next);
      return next;
    });
  };

  const disconnectRemoteEnvironment = async () => {
    const next = await disconnectRemoteDesktopAppServerEnvironment();
    setEnvironmentStatus(next);
    setSshConnectResult(null);
    setSshConnectStatus('idle');
    setSshConnectError(null);
  };

  const updateScreenMemoryEnabled = async (enabled: boolean) => {
    setScreenMemoryActionStatus('saving');
    setScreenMemoryError(null);
    try {
      const next = await setDesktopScreenMemoryEnabled(enabled);
      setScreenMemory(next);
      setScreenMemoryActionStatus('idle');
    } catch (caught) {
      setScreenMemoryError(
        caught instanceof Error ? caught.message : 'Screen Memory update failed.'
      );
      setScreenMemoryActionStatus('error');
    }
  };

  const updateScreenMemoryPaused = async (paused: boolean) => {
    setScreenMemoryActionStatus('saving');
    setScreenMemoryError(null);
    try {
      const next = await setDesktopScreenMemoryPaused(paused);
      setScreenMemory(next);
      setScreenMemoryActionStatus('idle');
    } catch (caught) {
      setScreenMemoryError(
        caught instanceof Error ? caught.message : 'Screen Memory update failed.'
      );
      setScreenMemoryActionStatus('error');
    }
  };

  const captureScreenMemory = async () => {
    setScreenMemoryActionStatus('capturing');
    setScreenMemoryError(null);
    try {
      const next = await captureDesktopScreenMemoryNow();
      setScreenMemory(next);
      setScreenMemoryActionStatus('idle');
    } catch (caught) {
      setScreenMemoryError(
        caught instanceof Error ? caught.message : 'Screen Memory capture failed.'
      );
      setScreenMemoryActionStatus('error');
    }
  };

  return (
    <div className="space-y-6 rounded-lg border border-border bg-black/10 p-4">
      <div>
        <h4 className="text-sm font-semibold">Local capabilities</h4>
        <p className="mt-1 text-xs text-slate-200/80">
          Desktop-only controls backed by the shared app-server.
        </p>
      </div>

      {error ? <p className="text-xs text-red-400">{error}</p> : null}
      {loading ? <p className="text-xs text-slate-200/80">Loading local controls...</p> : null}

      <div className="flex items-center justify-between gap-4 border-t border-border pt-4">
        <div className="min-w-0">
          <label className="text-sm font-medium">Active environment</label>
          <p className="mt-1 truncate text-xs text-slate-200/80">
            {formatEnvironmentStatus(environmentStatus)}
          </p>
          {formatEnvironmentDetail(environmentStatus) ? (
            <p className="mt-1 truncate text-xs text-slate-200/80">
              {formatEnvironmentDetail(environmentStatus)}
            </p>
          ) : null}
        </div>
        {environmentStatus?.active === 'remote' || environmentStatus?.remoteConnected ? (
          <button
            type="button"
            className="shrink-0 rounded-md border border-border px-2 py-1 text-xs text-slate-200/80 transition-colors hover:bg-white/5 hover:text-white"
            onClick={() => void disconnectRemoteEnvironment()}
          >
            Disconnect
          </button>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-4 border-t border-border pt-4">
        <div className="min-w-0">
          <label className="text-sm font-medium">Pairing transport</label>
          <p className="mt-1 truncate text-xs text-slate-200/80">
            {pairing.status === 'connected' && pairing.session
              ? `HTTP ready at ${pairing.session.baseUrl}`
              : pairing.status === 'pairing'
                ? 'Checking local HTTP bridge...'
                : pairing.status === 'error'
                  ? (pairing.error ?? 'Local HTTP bridge unavailable.')
                  : 'Waiting for local HTTP bridge.'}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span
            className={clsx(
              'rounded-md border px-2 py-1 text-xs capitalize',
              pairing.status === 'connected'
                ? 'border-emerald-300/40 bg-emerald-400/10 text-emerald-100'
                : pairing.status === 'error'
                  ? 'border-red-300/40 bg-red-400/10 text-red-100'
                  : 'border-border text-slate-200/80'
            )}
          >
            {pairing.status}
          </span>
          {pairing.status === 'error' ? (
            <button
              type="button"
              className="rounded-md border border-border px-2 py-1 text-xs text-slate-200/80 transition-colors hover:bg-white/5 hover:text-white"
              onClick={() => void pairing.connect()}
            >
              Retry
            </button>
          ) : null}
        </div>
      </div>

      {pairing.status === 'connected' && pairing.session ? (
        <div className="space-y-3 border-t border-border pt-4">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <label className="text-sm font-medium">Mobile pairing link</label>
              <p className="mt-1 truncate text-xs text-slate-200/80">
                {mobilePairingStatus === 'copied'
                  ? 'Copied a fresh one-time mobile pairing link.'
                  : mobilePairingStatus === 'ready'
                    ? 'Fresh one-time mobile pairing link is ready.'
                    : mobilePairingStatus === 'generating'
                      ? 'Generating a fresh one-time mobile pairing link...'
                      : mobilePairingStatus === 'error'
                        ? (mobilePairingError ?? 'Mobile pairing link unavailable.')
                        : 'Generate a one-time link for the mobile settings pairing card.'}
              </p>
            </div>
            <button
              type="button"
              className="shrink-0 rounded-md border border-border px-2 py-1 text-xs text-slate-200/80 transition-colors hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
              disabled={mobilePairingStatus === 'generating'}
              onClick={() => void copyMobilePairingLink()}
            >
              {mobilePairingStatus === 'generating' ? 'Generating' : 'Copy mobile link'}
            </button>
          </div>
          {mobilePairingLink ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
              {mobilePairingQrCode ? (
                <img
                  alt="Mobile pairing QR code"
                  className="h-28 w-28 rounded-md border border-border bg-white p-2"
                  src={mobilePairingQrCode}
                />
              ) : null}
              <input
                readOnly
                aria-label="Mobile pairing link"
                className="min-w-0 flex-1 rounded-md border border-border bg-black/20 px-2 py-1.5 text-xs text-slate-200/80"
                value={mobilePairingLink}
                onFocus={(event) => event.currentTarget.select()}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {screenMemory ? (
        <div className="space-y-3 border-t border-border pt-4">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <label className="text-sm font-medium">Screen Memory</label>
              <p className="mt-1 text-xs text-slate-200/80">{screenMemory.message}</p>
            </div>
            <Switch
              checked={screenMemory.enabled}
              disabled={!screenMemory.supported || screenMemoryActionStatus === 'saving'}
              onCheckedChange={(enabled) => void updateScreenMemoryEnabled(enabled)}
              aria-label="Toggle Screen Memory"
            />
          </div>
          <div className="grid gap-2 text-xs text-slate-200/80 sm:grid-cols-2">
            <p className="truncate">
              Latest: {formatScreenMemoryTime(screenMemory.latestCaptureAt)}
            </p>
            <p className="truncate">Snapshots: {screenMemory.captureCount}</p>
            <p className="truncate">Capture directory: {screenMemory.captureDirectory}</p>
            <p className="truncate">Memory source: {screenMemory.memoryPath ?? 'Unavailable'}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-md border border-border px-2 py-1 text-xs text-slate-200/80 transition-colors hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
              disabled={
                !screenMemory.supported ||
                !screenMemory.enabled ||
                screenMemoryActionStatus === 'saving'
              }
              onClick={() => void updateScreenMemoryPaused(!screenMemory.paused)}
            >
              {screenMemory.paused ? 'Resume' : 'Pause'}
            </button>
            <button
              type="button"
              className="rounded-md border border-border px-2 py-1 text-xs text-slate-200/80 transition-colors hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
              disabled={
                !screenMemory.supported ||
                !screenMemory.enabled ||
                screenMemory.paused ||
                screenMemoryActionStatus === 'capturing'
              }
              onClick={() => void captureScreenMemory()}
            >
              {screenMemoryActionStatus === 'capturing' ? 'Capturing' : 'Capture now'}
            </button>
          </div>
          {screenMemoryError ? <p className="text-xs text-red-400">{screenMemoryError}</p> : null}
        </div>
      ) : null}

      <div className="space-y-3 border-t border-border pt-4">
        <div>
          <label className="text-sm font-medium" htmlFor="desktop-ssh-target">
            Remote environment
          </label>
          <p className="mt-1 text-xs text-slate-200/80">
            Probe an SSH host for a TaskForceAI app-server runtime.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id="desktop-ssh-target"
            className="min-w-0 flex-1 rounded-md border border-border bg-black/20 px-2 py-1.5 text-xs text-white placeholder:text-slate-300/65"
            placeholder="user@example.com"
            value={sshTarget}
            onChange={(event) => setSshTarget(event.currentTarget.value)}
            onInput={(event) => setSshTarget(event.currentTarget.value)}
          />
          <button
            type="button"
            className="shrink-0 rounded-md border border-border px-2 py-1 text-xs text-slate-200/80 transition-colors hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
            disabled={sshProbeStatus === 'probing'}
            onClick={() => void probeSshTarget()}
          >
            {sshProbeStatus === 'probing' ? 'Probing' : 'Probe SSH'}
          </button>
          <button
            type="button"
            className="shrink-0 rounded-md border border-border px-2 py-1 text-xs text-slate-200/80 transition-colors hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
            disabled={sshConnectStatus === 'connecting'}
            onClick={() => void connectSshTarget()}
          >
            {sshConnectStatus === 'connecting' ? 'Connecting' : 'Connect'}
          </button>
        </div>
        {sshProbeResult ? (
          <p className="text-xs text-slate-200/80">
            {sshProbeResult.message}
            {sshProbeResult.appServerPath ? ` Path: ${sshProbeResult.appServerPath}` : ''}
          </p>
        ) : null}
        {sshConnectResult ? (
          <p className="text-xs text-emerald-100">
            {sshConnectResult.message} Local: {sshConnectResult.localBaseUrl}
          </p>
        ) : null}
        {sshProbeError ? <p className="text-xs text-red-400">{sshProbeError}</p> : null}
        {sshConnectError ? <p className="text-xs text-red-400">{sshConnectError}</p> : null}
        {savedRemoteEnvironments.length > 0 ? (
          <div className="space-y-2">
            {savedRemoteEnvironments.map((environment) => (
              <div
                key={environment.id}
                className="flex items-center justify-between gap-3 rounded-md border border-border bg-black/10 px-2 py-1.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium">{environment.target}</p>
                  <p className="truncate text-xs text-slate-200/80">
                    {environment.lastLocalBaseUrl ?? environment.appServerPath ?? 'Saved SSH host'}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    className="rounded-md border border-border px-2 py-1 text-xs text-slate-200/80 transition-colors hover:bg-white/5 hover:text-white"
                    onClick={() => void connectSshTarget(environment)}
                  >
                    Connect
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-border px-2 py-1 text-xs text-slate-200/80 transition-colors hover:bg-white/5 hover:text-white"
                    onClick={() => forgetRemoteEnvironment(environment.id)}
                  >
                    Forget
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {hybrid ? (
        <div className="flex items-center justify-between gap-4 border-t border-border pt-4">
          <div className="min-w-0">
            <label className="text-sm font-medium">Hybrid local reviewer</label>
            <p className="mt-1 text-xs text-slate-200/80">
              {hybrid.enabled
                ? `${hybrid.role} uses ${hybrid.modelId ?? hybrid.recommendedModelId}`
                : `Recommended: ${hybrid.recommendedModelId}`}
            </p>
          </div>
          <Switch
            checked={hybrid.enabled}
            onCheckedChange={(enabled) => void updateHybrid(enabled)}
            aria-label="Toggle hybrid local reviewer"
          />
        </div>
      ) : null}

      {pet ? (
        <div className="space-y-3 border-t border-border pt-4">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <label className="text-sm font-medium">Companion</label>
              <p className="mt-1 text-xs text-slate-200/80">{pet.message}</p>
            </div>
            <Switch
              checked={pet.visible}
              onCheckedChange={(visible) => void updatePet({ visible })}
              aria-label="Toggle companion"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {PET_MOODS.map((mood) => (
              <button
                key={mood}
                type="button"
                className={clsx(
                  'rounded-md border px-2 py-1 text-xs capitalize transition-colors',
                  pet.mood === mood
                    ? 'border-sky-300/50 bg-sky-400/15 text-sky-100'
                    : 'border-border text-slate-200/80 hover:bg-white/5 hover:text-white'
                )}
                onClick={() => void updatePet({ mood })}
              >
                {mood}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="space-y-3 border-t border-border pt-4">
        <div>
          <label className="text-sm font-medium">Plugins</label>
          <p className="mt-1 text-xs text-slate-200/80">
            Enable or disable installed app-server plugins.
          </p>
        </div>
        {plugins.length === 0 ? (
          <p className="text-xs text-slate-200/80">No plugins discovered.</p>
        ) : (
          <div className="space-y-3">
            {plugins.map((plugin) => (
              <div key={plugin.id} className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{plugin.name}</p>
                  <p className="truncate text-xs text-slate-200/80">{plugin.source ?? plugin.id}</p>
                </div>
                <Switch
                  checked={plugin.enabled}
                  onCheckedChange={(enabled) => void updatePlugin(plugin.id, enabled)}
                  aria-label={`Toggle ${plugin.name}`}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

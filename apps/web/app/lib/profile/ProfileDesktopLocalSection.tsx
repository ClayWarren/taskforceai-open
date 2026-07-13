'use client';

import clsx from 'clsx';
import { useCallback, useEffect, useState } from 'react';

import { definedProps } from '@taskforceai/client-core/utils/object';
import { Switch } from '@taskforceai/ui-kit/switch';

import {
  connectDesktopAppServerSshTarget,
  disconnectRemoteDesktopAppServerEnvironment,
  getDesktopAppServerBrowserStatus,
  getDesktopAppServerComputerUseMode,
  getDesktopAppServerComputerUseStatus,
  getDesktopAppServerEnvironmentStatus,
  getDesktopAppServerHybridMode,
  getDesktopAppServerPet,
  getDesktopScreenMemoryStatus,
  listDesktopAppServerPlugins,
  probeDesktopAppServerSshTarget,
  setDesktopAppServerComputerUseMode,
  setDesktopAppServerHybridMode,
  setDesktopAppServerPet,
  setDesktopAppServerPluginEnabled,
  type AppServerBrowserStatus,
  type AppServerComputerUseStatus,
  type AppServerEnvironmentStatus,
  type AppServerHybridModeResult,
  type AppServerModeResult,
  type AppServerPetState,
  type AppServerPluginListResult,
  type AppServerSshConnectResult,
  type AppServerSshProbeResult,
  type DesktopScreenMemoryStatus,
} from '../platform/desktop/app-server';

import { AppshotSection } from './ProfileDesktopAppshotSection';
import { BrowserPreviewSection } from './ProfileDesktopBrowserPreviewSection';
import { ScreenMemorySection } from './ProfileDesktopScreenMemorySection';
import { WorkspaceSections } from './ProfileDesktopWorkspaceSection';
import { useDesktopBrowserPreviewSection } from './useDesktopBrowserPreviewSection';
import {
  PET_MOODS,
  formatEnvironmentDetail,
  formatEnvironmentStatus,
  loadSavedRemoteEnvironments,
  saveRemoteEnvironments,
  type SavedRemoteEnvironment,
  type SshConnectStatus,
  type SshProbeStatus,
} from './ProfileDesktopLocalSection.helpers';

type DesktopPlugin = AppServerPluginListResult['plugins'][number];

const matchesBrowserPlugin = (plugin: DesktopPlugin) => {
  const id = plugin.id.toLocaleLowerCase();
  const name = plugin.name.toLocaleLowerCase();
  return id.includes('browser') || name.includes('browser');
};

const matchesComputerUsePlugin = (plugin: DesktopPlugin) => {
  const id = plugin.id.toLocaleLowerCase();
  const name = plugin.name.toLocaleLowerCase();
  return id.includes('computer-use') || name.includes('computer use');
};

function DesktopCapabilityPluginRows(props: {
  plugins: DesktopPlugin[];
  emptyLabel: string;
  onToggle: (_pluginId: string, _enabled: boolean) => void;
}) {
  if (props.plugins.length === 0) {
    return <p className="text-xs text-slate-200/80">{props.emptyLabel}</p>;
  }

  return (
    <div className="space-y-3">
      {props.plugins.map((plugin) => (
        <div key={plugin.id} className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{plugin.name}</p>
            <p className="truncate text-xs text-slate-200/80">
              {plugin.description ?? plugin.source ?? plugin.id}
            </p>
          </div>
          <Switch
            checked={plugin.enabled}
            onCheckedChange={(enabled) => props.onToggle(plugin.id, enabled)}
            aria-label={`Toggle ${plugin.name}`}
          />
        </div>
      ))}
    </div>
  );
}

const DesktopLocalLoadStatus = ({ error, loading }: { error: string | null; loading: boolean }) => (
  <>
    {error ? <p className="text-xs text-red-400">{error}</p> : null}
    {loading ? <p className="text-xs text-slate-200/80">Loading local controls...</p> : null}
  </>
);

// @taskforceai-complexity-ignore legacy desktop settings panel with many independent controls
export function DesktopLocalSection() {
  const [hybrid, setHybrid] = useState<AppServerHybridModeResult | null>(null);
  const [pet, setPet] = useState<AppServerPetState | null>(null);
  const [plugins, setPlugins] = useState<AppServerPluginListResult['plugins']>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
  const [savedRemoteEnvironments, setSavedRemoteEnvironments] = useState<SavedRemoteEnvironment[]>(
    () => loadSavedRemoteEnvironments()
  );
  const browserPreviewSection = useDesktopBrowserPreviewSection();
  const { refreshBrowserPreview } = browserPreviewSection;

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [hybridResult, petResult, pluginResult, screenMemoryResult] = await Promise.all([
        getDesktopAppServerHybridMode(),
        getDesktopAppServerPet(),
        listDesktopAppServerPlugins(),
        getDesktopScreenMemoryStatus(),
        refreshBrowserPreview(),
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
  }, [refreshBrowserPreview]);

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

  return (
    <div className="space-y-6 rounded-lg border border-border bg-black/10 p-4">
      <div>
        <h4 className="text-sm font-semibold">Local capabilities</h4>
        <p className="mt-1 text-xs text-slate-200/80">
          Desktop-only controls backed by the shared app-server.
        </p>
      </div>

      <DesktopLocalLoadStatus error={error} loading={loading} />

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

      <BrowserPreviewSection {...browserPreviewSection} />

      {screenMemory ? (
        <ScreenMemorySection screenMemory={screenMemory} onScreenMemoryChange={setScreenMemory} />
      ) : null}

      <AppshotSection />

      <WorkspaceSections />

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

export function DesktopBrowserUseSection() {
  const [plugins, setPlugins] = useState<AppServerPluginListResult['plugins']>([]);
  const [browserStatus, setBrowserStatus] = useState<AppServerBrowserStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const browserPreviewSection = useDesktopBrowserPreviewSection();
  const { refreshBrowserPreview } = browserPreviewSection;

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [pluginResult, statusResult] = await Promise.all([
        listDesktopAppServerPlugins(),
        getDesktopAppServerBrowserStatus(),
        refreshBrowserPreview(),
      ]);
      setPlugins(pluginResult.plugins);
      setBrowserStatus(statusResult);
    } catch {
      setError('Browser use settings are unavailable.');
    } finally {
      setLoading(false);
    }
  }, [refreshBrowserPreview]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const updatePlugin = async (pluginId: string, enabled: boolean) => {
    setError(null);
    try {
      const next = await setDesktopAppServerPluginEnabled(pluginId, enabled);
      setPlugins(next.plugins);
      setBrowserStatus(await getDesktopAppServerBrowserStatus());
    } catch {
      setError('Failed to update Browser plugin.');
    }
  };

  const browserPlugins = plugins.filter(matchesBrowserPlugin);

  return (
    <div className="space-y-6 rounded-lg border border-border bg-black/10 p-4">
      <div>
        <h4 className="text-sm font-semibold">Browser use</h4>
        <p className="mt-1 text-xs text-slate-200/80">
          {browserStatus?.message ?? 'Control the desktop in-app browser plugin and preview.'}
        </p>
      </div>

      {error ? <p className="text-xs text-red-400">{error}</p> : null}
      {loading ? <p className="text-xs text-slate-200/80">Loading Browser settings...</p> : null}

      <div className="space-y-3 border-t border-border pt-4">
        <div>
          <label className="text-sm font-medium">Plugin access</label>
          <p className="mt-1 text-xs text-slate-200/80">
            Enable browser automation tools for desktop runs.
          </p>
        </div>
        <DesktopCapabilityPluginRows
          plugins={browserPlugins}
          emptyLabel="No Browser plugin discovered."
          onToggle={(pluginId, enabled) => void updatePlugin(pluginId, enabled)}
        />
      </div>

      <BrowserPreviewSection {...browserPreviewSection} />
    </div>
  );
}

export function DesktopComputerUseSection() {
  const [plugins, setPlugins] = useState<AppServerPluginListResult['plugins']>([]);
  const [computerUseStatus, setComputerUseStatus] = useState<AppServerComputerUseStatus | null>(
    null
  );
  const [computerUseMode, setComputerUseMode] = useState<AppServerModeResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [pluginResult, statusResult, modeResult] = await Promise.all([
        listDesktopAppServerPlugins(),
        getDesktopAppServerComputerUseStatus(),
        getDesktopAppServerComputerUseMode(),
      ]);
      setPlugins(pluginResult.plugins);
      setComputerUseStatus(statusResult);
      setComputerUseMode(modeResult);
    } catch {
      setError('Computer Use settings are unavailable.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const updatePlugin = async (pluginId: string, enabled: boolean) => {
    setError(null);
    try {
      const next = await setDesktopAppServerPluginEnabled(pluginId, enabled);
      setPlugins(next.plugins);
      setComputerUseStatus(await getDesktopAppServerComputerUseStatus());
    } catch {
      setError('Failed to update Computer Use plugin.');
    }
  };

  const updateComputerUseMode = async (enabled: boolean) => {
    setError(null);
    try {
      setComputerUseMode(await setDesktopAppServerComputerUseMode(enabled));
    } catch {
      setError('Failed to update Computer Use mode.');
    }
  };

  const computerUsePlugins = plugins.filter(matchesComputerUsePlugin);

  return (
    <div className="space-y-6 rounded-lg border border-border bg-black/10 p-4">
      <div>
        <h4 className="text-sm font-semibold">Computer Use</h4>
        <p className="mt-1 text-xs text-slate-200/80">
          {computerUseStatus?.message ?? 'Control local screen automation for desktop runs.'}
        </p>
      </div>

      {error ? <p className="text-xs text-red-400">{error}</p> : null}
      {loading ? (
        <p className="text-xs text-slate-200/80">Loading Computer Use settings...</p>
      ) : null}

      <div className="flex items-center justify-between gap-4 border-t border-border pt-4">
        <div className="min-w-0">
          <label className="text-sm font-medium">Computer Use mode</label>
          <p className="mt-1 text-xs text-slate-200/80">
            Request Computer Use when a desktop run starts.
          </p>
        </div>
        <Switch
          checked={computerUseMode?.enabled ?? false}
          onCheckedChange={(enabled) => void updateComputerUseMode(enabled)}
          aria-label="Toggle Computer Use mode"
        />
      </div>

      <div className="space-y-3 border-t border-border pt-4">
        <div>
          <label className="text-sm font-medium">Plugin access</label>
          <p className="mt-1 text-xs text-slate-200/80">
            Enable screen-control tools exposed by the Computer Use plugin.
          </p>
        </div>
        <DesktopCapabilityPluginRows
          plugins={computerUsePlugins}
          emptyLabel="No Computer Use plugin discovered."
          onToggle={(pluginId, enabled) => void updatePlugin(pluginId, enabled)}
        />
        {computerUseStatus?.permissionRequired ? (
          <p className="text-xs text-amber-100">
            macOS screen recording or accessibility permission may be required.
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function DesktopAppshotsSection() {
  return (
    <div className="space-y-6 rounded-lg border border-border bg-black/10 p-4">
      <div>
        <h4 className="text-sm font-semibold">Appshots</h4>
        <p className="mt-1 text-xs text-slate-200/80">
          Capture the frontmost app window and attach the image or extracted text.
        </p>
      </div>
      <AppshotSection />
    </div>
  );
}

export function DesktopEnvironmentsSection() {
  return (
    <div className="space-y-6 rounded-lg border border-border bg-black/10 p-4">
      <div>
        <h4 className="text-sm font-semibold">Environments</h4>
        <p className="mt-1 text-xs text-slate-200/80">
          Configure project-local setup and action scripts for desktop coding runs.
        </p>
      </div>
      <WorkspaceSections mode="environment" />
    </div>
  );
}

export function DesktopWorktreesSection() {
  return (
    <div className="space-y-6 rounded-lg border border-border bg-black/10 p-4">
      <div>
        <h4 className="text-sm font-semibold">Worktrees</h4>
        <p className="mt-1 text-xs text-slate-200/80">
          Create and switch local Git worktrees used by desktop coding runs.
        </p>
      </div>
      <WorkspaceSections mode="worktrees" />
    </div>
  );
}

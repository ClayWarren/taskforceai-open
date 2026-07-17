'use client';

import QRCode from 'qrcode';
import { useCallback, useEffect, useState } from 'react';

import { Switch } from '@taskforceai/ui-kit/switch';

import {
  createDesktopRemotePairingCode,
  getDesktopRemoteSettings,
  listDesktopRemoteControllers,
  revokeDesktopRemoteController,
  updateDesktopRemoteSettings,
  type AppServerRemoteController,
  type AppServerRemoteSettings,
} from '../platform/app-server';
import { dispatchDesktopAppServerAuthChanged } from '../platform/auth-events';

const remoteErrorMessage = (caught: unknown, fallback: string) => {
  const message = caught instanceof Error ? caught.message : fallback;
  if (/sign in again/i.test(message)) {
    dispatchDesktopAppServerAuthChanged();
  }
  return message;
};

export function PairingSections() {
  const [settings, setSettings] = useState<AppServerRemoteSettings | null>(null);
  const [controllers, setControllers] = useState<AppServerRemoteController[]>([]);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [pairingQr, setPairingQr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const nextSettings = await getDesktopRemoteSettings();
      setSettings(nextSettings);
      try {
        const nextControllers = await listDesktopRemoteControllers();
        setControllers(nextControllers.devices);
      } catch (caught) {
        setControllers([]);
        setError(remoteErrorMessage(caught, 'Remote devices are unavailable.'));
      }
    } catch (caught) {
      setError(remoteErrorMessage(caught, 'Remote settings are unavailable.'));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const update = async (patch: { allowConnections?: boolean; keepAwake?: boolean }) => {
    setBusy(true);
    setError(null);
    try {
      const next = await updateDesktopRemoteSettings(patch);
      setSettings(next);
      if (!next.allowConnections) {
        setPairingCode(null);
        setPairingQr(null);
      }
    } catch (caught) {
      setError(remoteErrorMessage(caught, 'Remote settings could not be updated.'));
    } finally {
      setBusy(false);
    }
  };

  const addConnection = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await createDesktopRemotePairingCode();
      const link = `taskforceai://remote/pair?code=${encodeURIComponent(result.code)}`;
      setPairingCode(result.code);
      setPairingQr(
        await QRCode.toDataURL(link, { errorCorrectionLevel: 'M', margin: 1, scale: 7 })
      );
    } catch (caught) {
      setError(remoteErrorMessage(caught, 'A connection code could not be created.'));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (deviceId: string) => {
    setBusy(true);
    try {
      await revokeDesktopRemoteController(deviceId);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5 border-t border-border pt-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold">Control this Mac</h3>
          <p className="mt-1 text-xs text-slate-200/70">
            Allow your TaskForceAI mobile app to manage tasks running on this Mac.
          </p>
        </div>
        <button
          type="button"
          disabled={busy || !settings?.allowConnections}
          onClick={() => void addConnection()}
          className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-black disabled:cursor-not-allowed disabled:opacity-40"
        >
          Add
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-white/[0.025]">
        <SettingRow
          title="Allow connections"
          description="Make this Mac available to explicitly approved devices on your account."
          checked={settings?.allowConnections ?? false}
          disabled={busy || !settings}
          onChange={(checked) => void update({ allowConnections: checked })}
        />
        {controllers.length > 0 ? (
          <div className="border-t border-border">
            {controllers.map((controller) => (
              <div
                key={controller.deviceId}
                className="flex items-center justify-between gap-4 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{controller.deviceName}</p>
                  <p className="mt-0.5 text-xs text-slate-200/60">
                    Last connected {formatLastConnected(controller.lastConnectedAt)}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void revoke(controller.deviceId)}
                  className="shrink-0 rounded-full bg-white/5 px-3 py-1.5 text-xs text-slate-100 hover:bg-white/10 disabled:opacity-50"
                >
                  Revoke access
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="border-t border-border px-4 py-3 text-xs text-slate-200/60">
            No mobile devices have access yet.
          </p>
        )}
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold text-slate-200/80">Other settings</p>
        <div className="overflow-hidden rounded-xl border border-border bg-white/[0.025]">
          <SettingRow
            title="Keep this Mac awake"
            description="Prevent sleep while plugged in and Remote connections are enabled."
            checked={settings?.keepAwake ?? false}
            disabled={busy || !settings}
            onChange={(checked) => void update({ keepAwake: checked })}
          />
        </div>
      </div>

      {pairingCode ? (
        <div className="rounded-xl border border-border bg-black/20 p-4">
          <p className="text-center text-sm font-semibold">Approve on your phone</p>
          <p className="mt-1 text-center text-xs text-slate-200/60">
            In the TaskForceAI mobile app, open Remote → Add connection.
          </p>
          <div className="mt-4 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            {pairingQr ? (
              <img
                alt="Remote connection QR code"
                className="h-40 w-40 rounded-xl bg-white p-2"
                src={pairingQr}
              />
            ) : null}
            <div>
              <p className="text-center font-mono text-3xl font-semibold tracking-[0.2em] sm:text-left">
                {pairingCode}
              </p>
              <p className="mt-2 text-center text-xs text-slate-200/60 sm:text-left">
                This one-time code expires in 10 minutes.
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {error ? <p className="text-xs text-red-400">{error}</p> : null}
    </div>
  );
}

function SettingRow(props: {
  title: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onChange: (_checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">{props.title}</p>
        <p className="mt-0.5 text-xs text-slate-200/60">{props.description}</p>
      </div>
      <Switch
        checked={props.checked}
        disabled={props.disabled}
        onCheckedChange={props.onChange}
        aria-label={props.title}
      />
    </div>
  );
}

const formatLastConnected = (value: string): string => {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return 'recently';
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
};

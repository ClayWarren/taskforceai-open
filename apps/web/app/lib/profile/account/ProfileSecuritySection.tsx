'use client';

import { getBrowserClient } from '@taskforceai/api-client/browserClient';
import QRCode from 'qrcode';
import React from 'react';

import { Button } from '@taskforceai/ui-kit/button';
import { Switch } from '@taskforceai/ui-kit/switch';

import { FeedbackBanner } from './ProfileBasicSections';

export function SecuritySection(props: {
  initialAuthenticatorEnabled: boolean;
  onAuthenticatorStatusChange?: (_enabled: boolean) => void;
}) {
  const [enabled, setEnabled] = React.useState(props.initialAuthenticatorEnabled);
  const [setupSecret, setSetupSecret] = React.useState<string | null>(null);
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

      <FeedbackBanner className="mb-0" message={message} kind="success" />
      <FeedbackBanner className="mb-0" message={error} kind="error" />

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
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void navigator.clipboard?.writeText(setupSecret)}
              >
                Copy setup key
              </Button>
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

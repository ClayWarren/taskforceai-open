'use client';

import clsx from 'clsx';
import QRCode from 'qrcode';
import { useState } from 'react';

import {
  createDesktopHttpPairingDeepLink,
  mintDesktopHttpPairingInfo,
} from '../platform/desktop/http-app-server';
import { useDesktopHttpAppServerPairing } from '../platform/desktop/useDesktopHttpAppServerPairing';

import { type MobilePairingLinkStatus } from './ProfileDesktopLocalSection.helpers';

export function PairingSections() {
  const [mobilePairingLink, setMobilePairingLink] = useState<string | null>(null);
  const [mobilePairingQrCode, setMobilePairingQrCode] = useState<string | null>(null);
  const [mobilePairingStatus, setMobilePairingStatus] = useState<MobilePairingLinkStatus>('idle');
  const [mobilePairingError, setMobilePairingError] = useState<string | null>(null);
  const pairing = useDesktopHttpAppServerPairing();

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

  return (
    <>
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
    </>
  );
}

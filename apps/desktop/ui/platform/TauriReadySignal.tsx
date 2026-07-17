'use client';

import { useEffect } from 'react';

import { getRuntimeEnv } from '@taskforceai/config/app-env';

import { logger as platformLogger } from '@taskforceai/web/app/lib/logger';
import { invokeTauri } from './bridge';
import { parseEnabledFlag } from '@taskforceai/config/env-parsing';
import { detectRuntime } from '@taskforceai/browser-runtime/runtime';

const shouldSignalReadiness = (): boolean =>
  detectRuntime() === 'desktop' ||
  parseEnabledFlag(getRuntimeEnv('VITE_TAURI_FORCE_READY')) ||
  parseEnabledFlag(getRuntimeEnv('NEXT_PUBLIC_TAURI_FORCE_READY'));

export const TauriReadySignal = () => {
  useEffect(() => {
    if (!shouldSignalReadiness()) {
      return;
    }

    let cancelled = false;
    invokeTauri('frontend_ready').catch((error: unknown) => {
      if (!cancelled) {
        platformLogger.warn('Failed to signal Tauri frontend readiness', { error });
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
};

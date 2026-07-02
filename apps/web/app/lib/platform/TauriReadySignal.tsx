'use client';

import { useEffect } from 'react';

import { getRuntimeEnv } from '@taskforceai/shared/config/app-env';

import { logger as platformLogger } from '../logger';
import { invokeTauri } from './desktop/bridge';
import { parseEnabledFlag } from '@taskforceai/shared/utils/env-parsing';
import { detectRuntime } from '@taskforceai/shared/utils/runtime';

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

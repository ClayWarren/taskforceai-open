'use client';

import { type Result, err, ok } from '@taskforceai/client-core/result';

export type ClientMetadata = {
  locale?: string;
  timezone?: string;
  platform?: string;
};

export type ClientMetadataError = {
  kind: 'unavailable' | 'missing' | 'failed';
  message: string;
};

export const readPlatformLabel = (): Result<string, ClientMetadataError> => {
  if (typeof navigator === 'undefined') {
    return err({ kind: 'unavailable', message: 'Navigator unavailable.' });
  }
  const platform = navigator.platform || navigator.userAgent || '';
  if (!platform) {
    return err({ kind: 'missing', message: 'Platform unavailable.' });
  }
  return ok(platform);
};

export const readClientMetadata = (): Result<ClientMetadata, ClientMetadataError> => {
  if (typeof window === 'undefined') {
    return err({ kind: 'unavailable', message: 'Client metadata unavailable.' });
  }

  const metadata: ClientMetadata = {};

  if (navigator.language) {
    metadata.locale = navigator.language;
  }

  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (timezone) {
    metadata.timezone = timezone;
  }

  const platformResult = readPlatformLabel();
  if (platformResult.ok) {
    metadata.platform = platformResult.value;
  }

  return ok(metadata);
};

/**
 * TLS pin source of truth for native config plugins plus runtime production
 * host validation. OS-level pinning is enforced by Android network security
 * config and iOS NSPinnedDomains.
 */
import { createModuleLogger } from '../logger';

/**
 * SHA-256 SPKI hashes for *.taskforceai.chat. Android accepts any pin in the
 * certificate chain; iOS uses the CA pins only for rotation tolerance.
 */
export const PINNED_LEAF_SPKI_HASHES: readonly string[] = [
  'RLuFVJ2V0Ew4coFgR1qyDIZBKailpT7NSkvYYIrcVJg=',
  'uXLQYJd7UiK0Qgwd8SSOG3raaD1SHQdD4OmSpAlYsgQ=',
] as const;

export const PINNED_CA_SPKI_HASHES: readonly string[] = [
  'kZwN96eHtZftBWrOZUsd6cA4es80n3NzSk/XtYz2EqQ=',
] as const;

export const PINNED_SPKI_HASHES: readonly string[] = [
  ...PINNED_LEAF_SPKI_HASHES,
  ...PINNED_CA_SPKI_HASHES,
] as const;

const PLACEHOLDER_HASHES = new Set([
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
  'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=',
]);

const pinningLogger = createModuleLogger('CertificatePinning');

const PINNED_DOMAINS = [
  'api.taskforceai.chat',
  'www.taskforceai.chat',
] as const;

export const isPlaceholderPinHash = (hash: string): boolean => {
  const trimmed = hash.trim();
  if (PLACEHOLDER_HASHES.has(trimmed)) return true;
  const unpadded = trimmed.replace(/=+$/g, '');
  return /^([A])\1+$/.test(unpadded) || /^([B])\1+$/.test(unpadded);
};

const hasPlaceholderPins = (): boolean =>
  PINNED_SPKI_HASHES.some((hash) => isPlaceholderPinHash(hash));

export const assertProductionPinConfiguration = (): void => {
  if (__DEV__) return;

  if (hasPlaceholderPins()) {
    throw new Error(
      '[CertificatePinning] Placeholder SPKI hashes detected. Refusing production network calls until real certificate pins are configured.'
    );
  }
};

export const isPinnedDomain = (url: string): boolean => {
  try {
    const hostname = new URL(url).hostname;
    return (PINNED_DOMAINS as readonly string[]).includes(hostname);
  } catch {
    return false;
  }
};

export const assertProductionDomain = (url: string): void => {
  if (__DEV__) {
    return;
  }

  if (!isPinnedDomain(url)) {
    throw new Error(
      `[CertificatePinning] Production API request to non-pinned domain: ${new URL(url).hostname}. ` +
      `Only ${PINNED_DOMAINS.join(', ')} are allowed.`
    );
  }
};

export const createPinnedFetch = (
  baseFetch: typeof fetch = fetch.bind(globalThis),
): typeof fetch => {
  const pinnedFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;

    assertProductionPinConfiguration();
    assertProductionDomain(url);

    try {
      return await baseFetch(input, init);
    } catch (error) {
      if (error instanceof TypeError && !__DEV__) {
        const msg = (error as Error).message?.toLowerCase() ?? '';
        const isTlsError =
          msg.includes('certificate') ||
          msg.includes('ssl') ||
          msg.includes('tls') ||
          msg.includes('trust') ||
          msg.includes('anchor');

        if (isTlsError) {
          pinningLogger.error(
            '[CertificatePinning] TLS verification failed — this may indicate a MITM attack or an expired pin.',
            { url, error: (error as Error).message },
          );
        }
      }
      throw error;
    }
  };

  return Object.assign(pinnedFetch, baseFetch) as typeof fetch;
};

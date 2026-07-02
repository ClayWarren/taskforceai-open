const DEFAULT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type BufferLike = {
  from(input: string, encoding: 'base64'): { toString(encoding: 'utf8'): string };
};

const base64UrlToUtf8 = (input: string): string | null => {
  if (input.length === 0) {
    return null; // coverage-ignore-line -- public JWT parsing rejects empty payloads before decoding.
  }

  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const paddingLength = (4 - (normalized.length % 4)) % 4;
  const padded = `${normalized}${'='.repeat(paddingLength)}`;

  try {
    if (typeof globalThis.atob === 'function') {
      return globalThis.atob(padded);
    }

    const maybeBuffer = (globalThis as { Buffer?: BufferLike }).Buffer;
    if (maybeBuffer) {
      return maybeBuffer.from(padded, 'base64').toString('utf8');
    }
  } catch {
    return null;
  }

  return null;
};

const readNumericExpClaim = (claims: Record<string, unknown>): number | null => {
  const expClaim = claims['exp'];
  if (typeof expClaim === 'number' && Number.isFinite(expClaim) && expClaim > 0) {
    return expClaim;
  }

  if (typeof expClaim === 'string' && /^\d+(\.\d+)?$/.test(expClaim)) {
    const numericExp = Number(expClaim);
    if (Number.isFinite(numericExp) && numericExp > 0) {
      return numericExp;
    }
  }

  return null;
};

export const getJwtExpiryMs = (accessToken: string): number | null => {
  if (typeof accessToken !== 'string' || accessToken.length === 0) {
    return null;
  }

  const parts = accessToken.split('.');
  if (parts.length < 2) {
    return null;
  }

  const payloadSegment = parts[1];
  if (!payloadSegment) {
    return null;
  }

  const payloadText = base64UrlToUtf8(payloadSegment);
  if (!payloadText) {
    return null;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(payloadText);
  } catch {
    return null;
  }

  if (typeof payload !== 'object' || payload === null) {
    return null;
  }

  const expSeconds = readNumericExpClaim(payload as Record<string, unknown>);
  if (expSeconds === null) {
    return null;
  }

  return Math.floor(expSeconds * 1000);
};

export const resolveSessionExpiryMs = (
  accessToken: string,
  fallbackExpiresAt?: number,
  nowMs = Date.now()
): number => {
  const jwtExpiryMs = getJwtExpiryMs(accessToken);
  if (jwtExpiryMs !== null) {
    return jwtExpiryMs;
  }

  if (
    typeof fallbackExpiresAt === 'number' &&
    Number.isFinite(fallbackExpiresAt) &&
    fallbackExpiresAt > 0
  ) {
    return fallbackExpiresAt;
  }

  return nowMs + DEFAULT_SESSION_TTL_MS;
};

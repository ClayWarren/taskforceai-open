export const REALTIME_SETUP_PREFETCH_MAX_AGE_MS = 45_000;
export const REALTIME_SETUP_PREFETCH_REFRESH_WINDOW_MS = 15_000;
export const REALTIME_SETUP_PREFETCH_EXPIRY_SKEW_MS = 10_000;

export interface RealtimeVoiceSetupPrefetchPayload {
  expiresAt?: unknown;
}

interface RealtimeVoiceSetupPrefetchEntry<TPayload> {
  key: string;
  payload: TPayload;
  usableUntil: number;
}

export interface RealtimeVoiceSetupPrefetchCacheOptions {
  maxAgeMs?: number;
  refreshWindowMs?: number;
  expirySkewMs?: number;
  now?: () => number;
}

export const normalizeRealtimeSetupExpiryMs = (expiresAt: unknown): number | null => {
  if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) {
    return null;
  }
  return expiresAt < 10_000_000_000 ? expiresAt * 1_000 : expiresAt;
};

export class RealtimeVoiceSetupPrefetchCache<TPayload extends RealtimeVoiceSetupPrefetchPayload> {
  private entry: RealtimeVoiceSetupPrefetchEntry<TPayload> | null = null; // coverage-ignore-line -- Bun does not attribute this TS private field initializer consistently.
  private readonly maxAgeMs: number;
  private readonly refreshWindowMs: number;
  private readonly expirySkewMs: number;
  private readonly now: () => number;

  constructor(options: RealtimeVoiceSetupPrefetchCacheOptions = {}) {
    this.maxAgeMs = options.maxAgeMs ?? REALTIME_SETUP_PREFETCH_MAX_AGE_MS;
    this.refreshWindowMs = options.refreshWindowMs ?? REALTIME_SETUP_PREFETCH_REFRESH_WINDOW_MS;
    this.expirySkewMs = options.expirySkewMs ?? REALTIME_SETUP_PREFETCH_EXPIRY_SKEW_MS;
    this.now = options.now ?? Date.now;
  }

  clear(): void {
    this.entry = null;
  }

  hasUsable(key: string): boolean {
    return this.entry !== null && this.isUsableEntry(this.entry, key);
  }

  hasFresh(key: string): boolean {
    return this.entry !== null && this.isFreshEntry(this.entry, key);
  }

  store(key: string, payload: TPayload): boolean {
    const usableUntil = this.getUsableUntil(payload);
    if (usableUntil <= this.now()) {
      return false;
    }

    this.entry = {
      key,
      payload,
      usableUntil,
    };
    return true;
  }

  consume(key: string): TPayload | null {
    const entry = this.entry;
    this.entry = null;
    return entry && this.isUsableEntry(entry, key) ? entry.payload : null;
  }

  getUsableUntil(payload: TPayload): number {
    const now = this.now();
    const maxAgeExpiresAt = now + this.maxAgeMs;
    const tokenExpiresAt = normalizeRealtimeSetupExpiryMs(payload.expiresAt);
    if (!tokenExpiresAt) {
      return maxAgeExpiresAt;
    }
    return Math.min(maxAgeExpiresAt, tokenExpiresAt - this.expirySkewMs);
  }

  private isUsableEntry(entry: RealtimeVoiceSetupPrefetchEntry<TPayload>, key: string): boolean {
    return entry.key === key && entry.usableUntil > this.now();
  }

  private isFreshEntry(entry: RealtimeVoiceSetupPrefetchEntry<TPayload>, key: string): boolean {
    return entry.key === key && entry.usableUntil - this.now() > this.refreshWindowMs;
  }
}

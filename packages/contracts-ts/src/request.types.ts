import { z } from 'zod';

import { type Result } from './utils/result';

export interface MetricsCollector {
  incrementCounter(name: string, tags?: Record<string, unknown>): void;
  startTimer(name: string, tags?: Record<string, unknown>): () => void;
}

export interface RetryPolicy {
  attempts: number;
  baseDelayMs: number;
  jitterMs: number;
  maxDelayMs?: number;
}

export interface ResiliencePolicy {
  apiClient: {
    timeoutMs?: number;
    circuitBreaker: {
      failureThreshold: number;
      recoveryTimeMs: number;
    };
    retry: RetryPolicy;
  };
}

export interface CircuitBreaker {
  execute<T>(fn: () => Promise<T>): Promise<T>;
}

export const tokenSchema = z
  .object({
    access_token: z.string().optional(),
    token: z.string().optional(),
  })
  .passthrough();

export type AuthTokenPayload = string | { access_token?: string; token?: string };
export type TokenError = 'TOKEN_MISSING' | 'TOKEN_INVALID' | 'TOKEN_UNAVAILABLE';
export type TokenResult = Result<AuthTokenPayload, TokenError>;

export interface RequestContextOptions {
  baseUrl?: string;
  defaultHeaders?: Record<string, string>;
  getToken?: () => TokenResult | Promise<TokenResult>;
  getCsrfToken?: () => string | Promise<string>;
  fetchImpl?: typeof fetch;
  metrics?: MetricsCollector;
  resiliencePolicy?: ResiliencePolicy;
  circuitBreakerFactory?: (
    name: string,
    options: { failureThreshold: number; recoveryTimeMs: number; labels: Record<string, string> }
  ) => CircuitBreaker;
  retryHandler?: <T>(
    fn: () => Promise<T>,
    options: RetryPolicy & { labels: Record<string, unknown>; signal?: AbortSignal }
  ) => Promise<T>;
}

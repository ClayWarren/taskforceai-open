'use client';

import { type ApiClient, createApiClient } from './client';
import { getStoredToken } from './auth/auth-storage';
import { getCsrfToken } from './auth/csrf';
import type { TokenResult } from './request';
import { err } from './utils/result';

type BrowserWindow = Window & {
  NEXT_PUBLIC_API_URL?: string;
};

const defaultGetToken = async (): Promise<TokenResult> => {
  const tokenResult = getStoredToken();
  if (!tokenResult.ok) {
    return err('TOKEN_MISSING');
  }
  return tokenResult;
};

export interface BrowserClientOptions {
  baseUrl?: string;
  getToken?: () => TokenResult | Promise<TokenResult>;
  getCsrfToken?: () => string | Promise<string>;
}

type CachedBrowserClientOptions = {
  resolvedBaseUrl: string;
  getToken: BrowserClientOptions['getToken'];
  getCsrfToken: BrowserClientOptions['getCsrfToken'];
};

let cachedClient: ApiClient | null = null;
let cachedOptions: CachedBrowserClientOptions | null = null;
let hasManualClientOverride = false;

const hasTauriRuntime = (): boolean => typeof window !== 'undefined' && '__TAURI__' in window;

const isAbsoluteHttpUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

const readEnvApiURL = (): string => {
  if (typeof process !== 'undefined' && process.env) {
    const value = process.env['NEXT_PUBLIC_API_URL'];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }

  if (typeof window !== 'undefined') {
    const win = window as BrowserWindow;
    if (typeof win.NEXT_PUBLIC_API_URL === 'string' && win.NEXT_PUBLIC_API_URL.length > 0) {
      return win.NEXT_PUBLIC_API_URL;
    }
  }

  return '';
};

const resolveBaseUrl = (optionsBaseUrl?: string): string => {
  if (typeof optionsBaseUrl === 'string') {
    return optionsBaseUrl;
  }

  const envApiUrl = readEnvApiURL();
  return hasTauriRuntime()
    ? 'https://taskforceai.chat'
    : typeof window !== 'undefined'
      ? '' // Let the proxy handle the /api prefix from the relative path
      : envApiUrl;
};

export const getBrowserClient = (options: BrowserClientOptions = {}): ApiClient => {
  if (cachedClient && hasManualClientOverride) {
    return cachedClient;
  }

  const resolvedBaseUrl = resolveBaseUrl(options.baseUrl);

  if (
    cachedClient &&
    cachedOptions &&
    cachedOptions.resolvedBaseUrl === resolvedBaseUrl &&
    cachedOptions.getToken === options.getToken &&
    cachedOptions.getCsrfToken === options.getCsrfToken
  ) {
    return cachedClient;
  }

  if (typeof window === 'undefined' && !hasTauriRuntime() && !isAbsoluteHttpUrl(resolvedBaseUrl)) {
    throw new Error(
      'NEXT_PUBLIC_API_URL must be set to an absolute http(s) URL for server-side API calls'
    );
  }

  cachedOptions = {
    resolvedBaseUrl,
    getToken: options.getToken,
    getCsrfToken: options.getCsrfToken,
  };
  hasManualClientOverride = false;
  cachedClient = createApiClient({
    baseUrl: resolvedBaseUrl,
    getToken: options.getToken ?? defaultGetToken,
    getCsrfToken: options.getCsrfToken ?? getCsrfToken,
  });

  return cachedClient;
};

export const setBrowserClient = (client: ApiClient | null) => {
  cachedClient = client;
  cachedOptions = null;
  hasManualClientOverride = client !== null;
};

export const clearBrowserClientCache = () => {
  cachedClient = null;
  cachedOptions = null;
  hasManualClientOverride = false;
};

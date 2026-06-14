const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export const readStatusCode = (value: unknown): number | null => {
  if (!isRecord(value)) {
    return null;
  }
  const directStatus = value['status'];
  if (typeof directStatus === 'number') {
    return directStatus;
  }
  const statusCode = value['statusCode'];
  if (typeof statusCode === 'number') {
    return statusCode;
  }
  const response = value['response'];
  if (isRecord(response)) {
    const responseStatus = response['status'];
    if (typeof responseStatus === 'number') {
      return responseStatus;
    }
  }
  return null;
};

export const readErrorBody = (value: unknown): unknown => {
  if (!isRecord(value)) {
    return null;
  }
  return value['body'] ?? null;
};

export const readApiErrorMessage = (value: unknown): string | null => {
  if (!isRecord(value)) {
    return null;
  }
  const error = value['error'];
  if (typeof error === 'string' && error.length > 0) {
    return error;
  }
  const message = value['message'];
  if (typeof message === 'string' && message.length > 0) {
    return message;
  }
  return null;
};

export const getServerBaseUrl = (env?: Record<string, string | undefined>): string => {
  const safeEnv = env ?? (typeof process !== 'undefined' ? process.env : {}) ?? {};
  const apiUrl = safeEnv['VITE_API_URL'] || safeEnv['NEXT_PUBLIC_API_URL'];
  if (apiUrl) {
    return apiUrl.replace(/\/+$/, '');
  }

  if (safeEnv['VERCEL_URL']) {
    return `https://${safeEnv['VERCEL_URL']}`;
  }

  if (
    typeof window !== 'undefined' &&
    (!env || env === (typeof process !== 'undefined' ? process.env : undefined))
  ) {
    return window.location.origin;
  }

  return `http://localhost:${safeEnv['PORT'] ?? 3000}`;
};

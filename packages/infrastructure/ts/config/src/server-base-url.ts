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

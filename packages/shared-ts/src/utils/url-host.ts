type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null;

export const getStringProp = (obj: unknown, prop: string): string => {
  if (!isRecord(obj)) {
    return '';
  }
  const value = obj[prop];
  return typeof value === 'string' ? value : '';
};

export const getObjectProp = (obj: unknown, prop: string): unknown => {
  if (!isRecord(obj)) {
    return undefined;
  }
  const value = obj[prop];
  return value !== null && typeof value === 'object' ? value : undefined;
};

export const extractHostFromCandidate = (candidate: string): string => {
  const sanitized = candidate.trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  if (!sanitized) {
    return '';
  }

  const authority = sanitized.split('/')[0] ?? '';
  if (!authority) {
    return '';
  }

  if (authority.startsWith('[')) {
    const closingIndex = authority.indexOf(']');
    if (closingIndex <= 1) {
      return '';
    }
    return authority.slice(1, closingIndex);
  }

  const colonCount = (authority.match(/:/g) ?? []).length;
  if (colonCount > 1) {
    return authority;
  }

  return authority.split(':')[0] ?? '';
};

export const formatHostForHttpUrl = (host: string): string =>
  host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;

export const isLocalDevBaseUrl = (baseUrl: string): boolean =>
  baseUrl.includes('localhost') || /^http:\/\/\d+\.\d+\.\d+\.\d+/.test(baseUrl);

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

const normalizeHostname = (hostname: string): string =>
  hostname.trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '').replace(/\.$/, '');

const parseIPv4Octets = (hostname: string): [number, number, number, number] | null => {
  const parts = hostname.split('.');
  if (parts.length !== 4) {
    return null;
  }

  const octets = parts.map((part) => {
    if (!/^\d{1,3}$/.test(part)) {
      return null;
    }
    const value = Number(part);
    return value >= 0 && value <= 255 ? value : null;
  });

  return octets.every((value): value is number => value !== null)
    ? (octets as [number, number, number, number])
    : null;
};

const isPrivateOrLoopbackIPv4 = (hostname: string): boolean => {
  const octets = parseIPv4Octets(hostname);
  if (!octets) {
    return false;
  }

  const [first, second, third, fourth] = octets;
  return (
    first === 10 ||
    first === 127 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 169 && second === 254) ||
    (first === 0 && second === 0 && third === 0 && fourth === 0)
  );
};

const isLocalOrPrivateIPv6 = (hostname: string): boolean =>
  hostname === '::1' ||
  (hostname.includes(':') &&
    (/^(?:fc|fd)[0-9a-f]{0,2}:/i.test(hostname) || /^fe80:/i.test(hostname)));

const getHostnameFromBaseUrl = (baseUrl: string): string => {
  const trimmed = baseUrl.trim();
  if (!trimmed) {
    return '';
  }

  try {
    return normalizeHostname(new URL(trimmed).hostname);
  } catch {
    return normalizeHostname(extractHostFromCandidate(trimmed));
  }
};

export const isLocalDevBaseUrl = (baseUrl: string): boolean => {
  const hostname = getHostnameFromBaseUrl(baseUrl);
  if (!hostname) {
    return false;
  }

  return (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    isPrivateOrLoopbackIPv4(hostname) ||
    isLocalOrPrivateIPv6(hostname)
  );
};

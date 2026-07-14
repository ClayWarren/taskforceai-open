export type DeviceAuthorizeResponse =
  | { status: 'success' }
  | { status: 'unauthorized' }
  | { status: 'expired' }
  | { status: 'not_found' }
  | { status: 'error'; message: string };

export type DeviceLoginClient = 'terminal' | 'desktop';

export const normalizeDeviceLoginCode = (input: string): string =>
  input
    .replace(/[^A-Za-z0-9]/g, '')
    .slice(0, 8)
    .toUpperCase()
    .replace(/(.{4})/g, '$1-')
    .replace(/-$/, '');

export const stripDeviceLoginCode = (input: string): string =>
  input.replace(/[^A-Za-z0-9]/g, '').toUpperCase();

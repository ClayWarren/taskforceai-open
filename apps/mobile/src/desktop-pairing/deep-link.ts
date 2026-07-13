const desktopPairingRoute = 'desktop-pairing';

export const isDesktopPairingDeepLink = (rawUrl: string): boolean => {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }

  if (url.protocol !== 'taskforceai:') {
    return false;
  }

  const host = url.hostname.toLowerCase();
  const path = url.pathname.replace(/^\/+/, '').toLowerCase();
  return host === desktopPairingRoute || path === desktopPairingRoute;
};

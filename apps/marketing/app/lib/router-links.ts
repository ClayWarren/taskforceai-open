const protocolHrefPattern = /^[a-z][a-z\d+.-]*:/i;

export function splitInternalRouterHref(href: string): { to: string; hash?: string } | null {
  if (href.startsWith('#') || protocolHrefPattern.test(href)) {
    return null;
  }

  const hashIndex = href.indexOf('#');
  if (hashIndex === -1) {
    return { to: href };
  }

  const to = href.slice(0, hashIndex) || '/';
  const hash = href.slice(hashIndex + 1);

  return hash ? { to, hash } : { to };
}

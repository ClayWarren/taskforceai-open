export function safeExternalHref(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const href = value.trim();
  if (href.length === 0) {
    return null;
  }

  if (href.startsWith('/') && !href.startsWith('//')) {
    return href;
  }

  try {
    const parsed = new URL(href);
    return parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

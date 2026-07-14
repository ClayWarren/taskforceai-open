export const jsonContentTypeHeaders = new Headers({
  'content-type': 'application/json',
});

export const mergeHeaders = (...headerSets: (HeadersInit | undefined)[]): Headers => {
  const headers = new Headers();
  for (const headerSet of headerSets) {
    if (!headerSet) {
      continue;
    }
    new Headers(headerSet).forEach((value, key) => {
      headers.set(key, value);
    });
  }
  return headers;
};

export const readJsonErrorMessage = async (response: Response): Promise<string | null> => {
  try {
    const payload = (await response.json()) as { error?: unknown };
    return typeof payload.error === 'string' ? payload.error : null;
  } catch {
    return null;
  }
};

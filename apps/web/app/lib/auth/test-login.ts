export const submitLocalDevLogin = async (email: string): Promise<void> => {
  const response = await fetch('/api/v1/auth/test-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(body?.detail || `Local sign-in failed (${response.status})`);
  }
};

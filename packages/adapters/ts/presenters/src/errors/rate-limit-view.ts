export const formatRateLimitCountdown = (resetTime: string, nowMs = Date.now()): string | null => {
  const resetMs = Date.parse(resetTime);
  if (!Number.isFinite(resetMs)) {
    return null;
  }

  const diffMs = resetMs - nowMs;
  if (diffMs <= 0) {
    return 'Ready to retry';
  }

  const minutes = Math.floor(diffMs / 60_000);
  const seconds = Math.floor((diffMs % 60_000) / 1000);

  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
};

export const formatRateLimitResetDate = (resetTime: string): string | null => {
  const resetMs = Date.parse(resetTime);
  return Number.isFinite(resetMs) ? new Date(resetMs).toLocaleString() : null;
};

export const formatTime = (seconds: number): string => {
  if (seconds < 60) {
    return `${Math.floor(seconds)}S`;
  }
  if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${minutes}M${secs}S`;
  }
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}H${minutes}M`;
};

export const formatRelativeTime = (timestamp: string | number | Date): string => {
  const date = new Date(timestamp);
  if (isNaN(date.getTime())) {
    return 'Invalid date';
  }
  const now = Date.now();
  const diff = now - date.getTime();
  const absDiff = Math.abs(diff);
  const isFuture = diff < 0;
  const suffix = isFuture ? 'from now' : 'ago';
  const seconds = Math.floor(absDiff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days} day${days > 1 ? 's' : ''} ${suffix}`;
  if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ${suffix}`;
  if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ${suffix}`;
  return 'just now';
};

export const formatISODate = (date: Date = new Date()): string => {
  return date.toISOString();
};

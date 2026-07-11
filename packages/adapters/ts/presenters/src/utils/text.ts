export const stripHtml = (html: string): string => {
  return html.replace(/<[^>]*>/g, '');
};

export const truncate = (str: string, maxLength: number): string => {
  const limit = Math.max(0, Math.floor(maxLength));
  const chars = Array.from(str);
  if (chars.length <= limit) return str;
  if (limit <= 3) return '.'.repeat(limit);
  return chars.slice(0, limit - 3).join('') + '...';
};

export const capitalize = (str: string): string => {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
};

export const slugify = (str: string): string => {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
};

const rateLimitMessages: Record<'pro' | 'super' | 'default', string> = {
  pro: 'You have reached your message limit. Please upgrade to Super for more messages or wait for your limit to reset.',
  super: 'You have reached your message limit. Please wait for your limit to reset.',
  default:
    'You have reached your message limit. Please upgrade to Pro for more messages or wait for your limit to reset.',
};

export const buildRateLimitUpgradeMessage = (plan?: string | null): string => {
  if (plan === 'pro') return rateLimitMessages.pro;
  if (plan === 'super') return rateLimitMessages.super;
  return rateLimitMessages.default;
};

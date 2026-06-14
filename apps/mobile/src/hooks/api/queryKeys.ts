export const queryKeys = {
  user: ['user'] as const,
  conversations: ['conversations'] as const,
  conversationsPage: (limit = 20) => ['conversations', limit] as const,
  subscription: ['subscription'] as const,
  billingBalance: ['billingBalance'] as const,
  storage: ['storage'] as const,
  products: ['products'] as const,
  projects: () => ['projects'] as const,
  pendingPrompts: ['pendingPrompts'] as const,
  desktopSessions: ['desktopSessions'] as const,
  desktopWork: ['desktopWork'] as const,
  modelSelector: ['modelSelectorOptions'] as const,
} as const;

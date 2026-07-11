export interface HelpCategory {
  id: string;
  title: string;
  description: string;
  icon: string;
}

export const helpCategories: HelpCategory[] = [
  {
    id: 'getting-started',
    title: 'Getting Started',
    description: 'New to TaskForceAI? Start here.',
    icon: 'Rocket',
  },
  {
    id: 'account-billing',
    title: 'Account & Billing',
    description: 'Manage your subscription and payments.',
    icon: 'CreditCard',
  },
  {
    id: 'web-app',
    title: 'Web App',
    description: 'Browser-based interface features.',
    icon: 'Globe',
  },
  {
    id: 'desktop',
    title: 'Desktop',
    description: 'Mac, Windows, and Linux apps.',
    icon: 'Monitor',
  },
  {
    id: 'mobile',
    title: 'Mobile',
    description: 'iOS and Android applications.',
    icon: 'Smartphone',
  },
  {
    id: 'cli',
    title: 'CLI',
    description: 'Terminal interface and commands.',
    icon: 'Terminal',
  },
  {
    id: 'api',
    title: 'API',
    description: 'REST API authentication and endpoints.',
    icon: 'Server',
  },
  {
    id: 'sdks',
    title: 'SDKs',
    description: 'TypeScript, Python, Rust, and Go.',
    icon: 'Code2',
  },
  {
    id: 'enterprise',
    title: 'Enterprise',
    description: 'SSO, SCIM, and admin features.',
    icon: 'Building2',
  },
  {
    id: 'privacy-security',
    title: 'Privacy & Security',
    description: 'Data handling and compliance.',
    icon: 'Shield',
  },
];

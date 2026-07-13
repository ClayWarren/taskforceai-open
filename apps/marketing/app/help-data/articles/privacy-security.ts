import type { HelpArticle } from './types';

export const privacySecurityArticles: HelpArticle[] = [
  {
    slug: 'data-retention-deletion',
    categoryId: 'privacy-security',
    title: 'Data retention and deletion',
    description: 'Understand how your data is stored and deleted.',
    lastUpdated: '2025-01-15',
    content:
      '\n# Data Retention and Deletion\n\nUnderstand how TaskForceAI handles your data.\n\n## What Data We Store\n\n- Account information (email, name)\n- Conversation history\n- Usage metadata\n- Payment information (via Stripe)\n\n## Retention Periods\n\n| Data Type | Standard | Enterprise |\n|-----------|----------|------------|\n| Conversations | 30 days | Custom |\n| Audit logs | 90 days | 1 year |\n| Payment records | 7 years | 7 years |\n\n## Zero-Retention Mode\n\nEnterprise customers can enable zero-retention:\n\n- Conversations deleted after 24 hours\n- No training on your data (guaranteed)\n- Audit logs still maintained for compliance\n\n## Deleting Your Data\n\n### Delete Conversations\n\n1. Right-click a conversation\n2. Select "Delete"\n3. Confirm deletion\n\n### Delete All Data\n\n1. Go to Settings > Privacy\n2. Click "Delete All Data"\n3. Enter your password\n4. Confirm\n\n### Delete Account\n\n1. Go to Settings > Account\n2. Click "Delete Account"\n3. This action is irreversible\n\n## Data Export\n\nExport your data before deletion:\n\n1. Go to Settings > Privacy\n2. Click "Export My Data"\n3. Download the archive\n    ',
  },
  {
    slug: 'ai-provider-data-sharing',
    categoryId: 'privacy-security',
    title: 'AI provider data sharing',
    description: 'What is sent to AI providers when you use TaskForceAI.',
    lastUpdated: '2026-06-13',
    content:
      '\n# AI Provider Data Sharing\n\nTaskForceAI sends your prompts, attachments, conversation context, selected model settings, and related usage metadata to TaskForceAI servers and third-party AI providers only to generate the response or workflow you request.\n\n## Providers\n\nDepending on the selected model or workflow, TaskForceAI may process requests through OpenAI, Anthropic, Google, xAI, Mistral, Z.ai, and Vercel AI Gateway.\n\n## Permission\n\nThe mobile app asks for permission before sending prompt content or attachments to third-party AI providers. You can decline and avoid sending the request.\n\n## What Not To Send\n\nDo not include sensitive personal data, credentials, health information, financial account numbers, or other confidential information unless you want it processed for your request.\n\n## Support\n\nQuestions about data handling can be sent to [support@taskforceai.chat](mailto:support@taskforceai.chat).\n    ',
  },
  {
    slug: 'security-practices',
    categoryId: 'privacy-security',
    title: 'Security practices',
    description: 'How we keep your data secure.',
    lastUpdated: '2025-01-15',
    content:
      '\n# Security Practices\n\nHow TaskForceAI protects your data.\n\n## Encryption\n\n- **In Transit**: TLS 1.3 for all connections\n- **At Rest**: AES-256 encryption\n- **Keys**: Hardware security modules (HSM)\n\n## Infrastructure\n\n- Cloud infrastructure with SOC 2 certification\n- Regular security audits\n- 24/7 monitoring\n- DDoS protection\n\n## Authentication\n\n- Secure password hashing (bcrypt)\n- Two-factor authentication available\n- SSO support (SAML/OIDC)\n- Session management\n\n## Access Controls\n\n- Role-based access control (RBAC)\n- Principle of least privilege\n- Audit logging of all access\n- Regular access reviews\n\n## Vulnerability Management\n\n- Regular penetration testing\n- Bug bounty program\n- Automated vulnerability scanning\n- Timely security patches\n\n## Incident Response\n\n- 24/7 security team\n- Documented incident response plan\n- Customer notification within 72 hours\n- Post-incident reviews\n\n## Responsible Disclosure\n\nReport security issues to: security@taskforceai.chat\n    ',
  },
  {
    slug: 'compliance-certifications',
    categoryId: 'privacy-security',
    title: 'Compliance certifications',
    description: 'Our compliance certifications and standards.',
    lastUpdated: '2025-01-15',
    content:
      '\n# Compliance Certifications\n\nTaskForceAI meets rigorous compliance standards.\n\n## Current Certifications\n\n### SOC 2 Type II\n\n- Annual audit by independent firm\n- Controls for security, availability, confidentiality\n- Report available on request (NDA required)\n\n### GDPR\n\n- EU data protection compliance\n- Data Processing Agreement available\n- EU data residency option\n\n### CCPA\n\n- California Consumer Privacy Act compliance\n- Data deletion on request\n- No sale of personal information\n\n## In Progress\n\n- HIPAA (healthcare)\n- ISO 27001\n- FedRAMP (government)\n\n## Data Residency\n\nChoose where your data is stored:\n\n- United States (default)\n- European Union\n- Custom regions (Enterprise)\n\n## Compliance Documents\n\nRequest compliance documents:\n\n1. Contact your account manager\n2. Or email compliance@taskforceai.chat\n\nAvailable documents:\n\n- SOC 2 Type II Report\n- Penetration Test Summary\n- Data Processing Agreement\n- Security Whitepaper\n\n## Questions?\n\nFor compliance inquiries: compliance@taskforceai.chat\n    ',
  },
];

import type { HelpArticle } from './types';

export const enterpriseArticles: HelpArticle[] = [
  {
    slug: 'setting-up-sso',
    categoryId: 'enterprise',
    title: 'Enterprise SSO onboarding',
    description: 'Plan managed SAML onboarding for your organization.',
    lastUpdated: '2026-07-14',
    content: `
# Enterprise SSO Onboarding

TaskForceAI currently provisions enterprise SAML access as a managed onboarding process.

## Start an SSO Review

Contact [sales@taskforceai.chat](mailto:sales@taskforceai.chat) with:

- Your identity provider
- The verified email domains your organization uses
- Your target pilot date
- Any sign-in or session-policy requirements

Our engineering team will confirm the supported configuration and provide the current service-provider details directly. Do not configure an identity provider against an endpoint copied from an old guide.

## Before Rollout

Test sign-in with a small pilot group, verify organization membership, and agree on a recovery path for administrators before enforcing SSO.
    `,
  },
  {
    slug: 'directory-sync-scim',
    categoryId: 'enterprise',
    title: 'Directory provisioning requirements',
    description: 'Review user lifecycle and directory requirements before rollout.',
    lastUpdated: '2026-07-14',
    content: `
# Directory Provisioning Requirements

Directory provisioning is not currently offered as a self-service SCIM endpoint.

Contact [sales@taskforceai.chat](mailto:sales@taskforceai.chat) to review:

- Expected user and group volume
- Provisioning and deprovisioning requirements
- Role and workspace mapping
- Audit and reporting needs

The TaskForceAI team will document the supported pilot workflow and any manual administration steps. Do not point an identity provider at an undocumented SCIM URL.
    `,
  },
  {
    slug: 'admin-console-overview',
    categoryId: 'enterprise',
    title: 'Enterprise administration',
    description: 'Understand the current administration and support path.',
    lastUpdated: '2026-07-14',
    content: `
# Enterprise Administration

The API Console manages developer API keys and usage. Organization-wide enterprise controls are coordinated with TaskForceAI during onboarding rather than through a separate self-service admin console.

Contact [support@taskforceai.chat](mailto:support@taskforceai.chat) for membership changes, access recovery, or pilot support. Contact [sales@taskforceai.chat](mailto:sales@taskforceai.chat) for organization policy and rollout planning.
    `,
  },
  {
    slug: 'audit-logs-compliance',
    categoryId: 'enterprise',
    title: 'Security and compliance review',
    description: 'Request current security, data-flow, and compliance materials.',
    lastUpdated: '2026-07-14',
    content: `
# Security and Compliance Review

Available audit, retention, export, and compliance materials depend on the deployed product surface and your pilot requirements.

Contact [sales@taskforceai.chat](mailto:sales@taskforceai.chat) to request current architecture and data-flow documentation. Include your retention, audit-event, SIEM, residency, and regulatory requirements so the team can confirm what is supported before you commit to a rollout.

Do not rely on an older help article as evidence of a certification or product control. Use the current materials supplied for your review.
    `,
  },
];

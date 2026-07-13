import type { HelpArticle } from './types';

export const enterpriseArticles: HelpArticle[] = [
  {
    slug: 'setting-up-sso',
    categoryId: 'enterprise',
    title: 'Setting up SSO (SAML/OIDC)',
    description: 'Configure single sign-on for your organization.',
    lastUpdated: '2025-01-15',
    content:
      '\n# Setting Up SSO\n\nEnable single sign-on for your TaskForceAI organization.\n\n## Supported Providers\n\n- Okta\n- Azure Active Directory\n- Google Workspace\n- OneLogin\n- Any SAML 2.0 or OIDC provider\n\n## SAML Setup\n\n### Step 1: Get TaskForceAI Details\n\nFrom your admin console, note:\n\n- **ACS URL**: `https://auth.taskforceai.chat/saml/acs`\n- **Entity ID**: `https://taskforceai.chat`\n\n### Step 2: Configure Your IdP\n\n1. Create a new SAML application\n2. Enter the ACS URL and Entity ID\n3. Configure attribute mappings:\n   - `email` (required)\n   - `firstName` (optional)\n   - `lastName` (optional)\n\n### Step 3: Upload Metadata\n\n1. Download metadata XML from your IdP\n2. Go to Admin Console > SSO\n3. Upload the metadata file\n4. Click "Enable SSO"\n\n## OIDC Setup\n\n1. Create an OIDC application in your IdP\n2. Note the Client ID and Secret\n3. Enter these in Admin Console > SSO\n4. Configure redirect URI: `https://auth.taskforceai.chat/oidc/callback`\n\n## Testing\n\nUse "Test SSO" button before enforcing for all users.\n    ',
  },
  {
    slug: 'directory-sync-scim',
    categoryId: 'enterprise',
    title: 'Directory sync with SCIM',
    description: 'Automatically sync users from your identity provider.',
    lastUpdated: '2025-01-15',
    content:
      '\n# Directory Sync with SCIM\n\nAutomatically provision and deprovision users.\n\n## What is SCIM?\n\nSCIM (System for Cross-domain Identity Management) automatically syncs your directory with TaskForceAI:\n\n- New employees get access automatically\n- Departed employees lose access immediately\n- Groups and roles stay in sync\n\n## Setup\n\n### Step 1: Generate SCIM Token\n\n1. Go to Admin Console > Directory Sync\n2. Click "Generate SCIM Token"\n3. Copy and securely store the token\n\n### Step 2: Configure Your IdP\n\nEnter these details in your identity provider:\n\n- **SCIM URL**: `https://api.taskforceai.chat/scim/v2`\n- **Token**: Your generated token\n\n### Step 3: Configure Sync\n\nChoose what to sync:\n\n- Users (required)\n- Groups (optional)\n- Custom attributes (optional)\n\n### Step 4: Enable Sync\n\n1. Click "Enable Directory Sync"\n2. Run initial sync\n3. Verify users appear correctly\n\n## Troubleshooting\n\n- Check SCIM logs in Admin Console\n- Verify token hasn\'t expired\n- Ensure IdP has correct permissions\n    ',
  },
  {
    slug: 'admin-console-overview',
    categoryId: 'enterprise',
    title: 'Admin console overview',
    description: 'Manage your organization from the admin console.',
    lastUpdated: '2025-01-15',
    content:
      '\n# Admin Console Overview\n\nManage your TaskForceAI organization.\n\n## Accessing the Console\n\n1. Sign in as an admin\n2. Click your avatar > "Admin Console"\n\n## Dashboard\n\nThe dashboard shows:\n\n- Active users\n- Usage statistics\n- Recent activity\n- System status\n\n## User Management\n\nManage organization members:\n\n- Invite new users\n- Assign roles (Admin, Member, Viewer)\n- Suspend or remove users\n- Reset passwords\n\n## Settings\n\nConfigure organization-wide settings:\n\n- Default model preferences\n- Usage limits per user\n- Data retention policies\n- Allowed integrations\n\n## Billing\n\n- View current plan\n- Upgrade or downgrade\n- View invoices\n- Manage payment methods\n\n## Security\n\n- SSO configuration\n- Directory sync (SCIM)\n- Session policies\n- IP allowlists\n\n## Integrations\n\n- API key management\n- Webhook configuration\n- Third-party app connections\n    ',
  },
  {
    slug: 'audit-logs-compliance',
    categoryId: 'enterprise',
    title: 'Audit logs and compliance',
    description: 'Access audit logs and compliance reports.',
    lastUpdated: '2025-01-15',
    content:
      "\n# Audit Logs and Compliance\n\nMaintain compliance with comprehensive audit logging.\n\n## What's Logged\n\nEvery action is logged:\n\n- User sign-ins and sign-outs\n- Conversation creation and deletion\n- Settings changes\n- Admin actions\n- API key usage\n\n## Accessing Logs\n\n1. Go to Admin Console > Audit Logs\n2. Filter by date, user, or action type\n3. Export as CSV or JSON\n\n## Log Entry Details\n\nEach entry includes:\n\n- Timestamp (UTC)\n- User email\n- Action type\n- IP address\n- User agent\n- Additional context\n\n## Retention\n\n- Standard: 90 days\n- Enterprise: 1 year\n- Extended retention available on request\n\n## SIEM Integration\n\nExport logs to your SIEM:\n\n1. Go to Admin Console > Integrations\n2. Configure SIEM webhook\n3. Select events to forward\n\nSupported: Splunk, Datadog, Elastic, custom webhooks.\n\n## Compliance Reports\n\nGenerate compliance reports:\n\n- SOC 2 evidence packages\n- GDPR data processing records\n- Custom audit reports\n\nContact your account manager for compliance documentation.\n    ",
  },
];

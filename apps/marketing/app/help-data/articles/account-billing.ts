import type { HelpArticle } from './types';

export const accountBillingArticles: HelpArticle[] = [
  {
    slug: 'managing-your-subscription',
    categoryId: 'account-billing',
    title: 'Managing your subscription',
    description: 'Upgrade, downgrade, or modify your plan.',
    lastUpdated: '2025-01-15',
    content:
      '\n# Managing Your Subscription\n\nControl your TaskForceAI subscription from your account settings.\n\n## Viewing Your Plan\n\n1. Click your avatar in the top right\n2. Select "Settings"\n3. Go to "Billing"\n\n## Upgrading\n\nTo upgrade your plan:\n\n1. Go to Billing settings\n2. Click "Upgrade"\n3. Select your new plan\n4. Confirm payment\n\nYour new plan takes effect immediately.\n\n## Downgrading\n\nTo downgrade:\n\n1. Go to Billing settings\n2. Click "Change Plan"\n3. Select a lower tier\n4. Confirm\n\nDowngrades take effect at the end of your current billing period.\n\n## Cancellation\n\nTo cancel your subscription:\n\n1. Go to Billing settings\n2. Click "Cancel Subscription"\n3. Confirm cancellation\n\nYou\'ll retain access until the end of your billing period.\n    ',
  },
  {
    slug: 'payment-methods-and-billing',
    categoryId: 'account-billing',
    title: 'Payment methods and billing',
    description: 'Add or update your payment information.',
    lastUpdated: '2025-01-15',
    content:
      '\n# Payment Methods and Billing\n\nManage your payment methods and billing preferences.\n\n## Accepted Payment Methods\n\n- Credit cards (Visa, Mastercard, American Express)\n- Debit cards\n- Corporate cards\n\n## Adding a Payment Method\n\n1. Go to Settings > Billing\n2. Click "Add Payment Method"\n3. Enter your card details\n4. Click "Save"\n\n## Updating Payment Method\n\n1. Go to Settings > Billing\n2. Click "Edit" next to your card\n3. Update the details\n4. Click "Save"\n\n## Billing Cycle\n\n- Monthly plans are billed on the same date each month\n- Annual plans are billed once per year\n- Usage-based charges appear on your next invoice\n\n## Failed Payments\n\nIf a payment fails:\n\n1. We\'ll email you immediately\n2. You have 7 days to update your payment method\n3. Service continues during the grace period\n    ',
  },
  {
    slug: 'viewing-invoices-and-usage',
    categoryId: 'account-billing',
    title: 'Viewing invoices and usage',
    description: 'Access your billing history and usage reports.',
    lastUpdated: '2025-01-15',
    content:
      '\n# Viewing Invoices and Usage\n\nTrack your spending and download invoices.\n\n## Accessing Invoices\n\n1. Go to Settings > Billing\n2. Scroll to "Billing History"\n3. Click any invoice to view or download\n\n## Invoice Details\n\nEach invoice shows:\n\n- Billing period\n- Plan charges\n- Usage-based charges\n- Total amount\n- Payment status\n\n## Usage Reports\n\nView your usage in real-time:\n\n1. Go to Settings > Usage\n2. See current period usage\n3. View historical trends\n\n## Exporting Data\n\nExport your billing data:\n\n1. Go to Billing History\n2. Click "Export"\n3. Choose format (CSV or PDF)\n4. Download the file\n    ',
  },
  {
    slug: 'canceling-or-changing-plans',
    categoryId: 'account-billing',
    title: 'Canceling or changing plans',
    description: 'How to cancel or switch your subscription.',
    lastUpdated: '2025-01-15',
    content:
      '\n# Canceling or Changing Plans\n\nFlexibility to change your plan anytime.\n\n## Changing Plans\n\nYou can upgrade or downgrade at any time:\n\n1. Go to Settings > Billing\n2. Click "Change Plan"\n3. Select your new plan\n4. Confirm the change\n\n**Upgrades**: Take effect immediately, prorated for the current period.\n\n**Downgrades**: Take effect at the end of your current billing period.\n\n## Canceling Your Subscription\n\nTo cancel:\n\n1. Go to Settings > Billing\n2. Click "Cancel Subscription"\n3. Tell us why (optional)\n4. Confirm cancellation\n\n## After Cancellation\n\n- Access continues until period end\n- Your data is retained for 30 days\n- You can reactivate anytime\n- Conversation history remains accessible\n\n## Reactivating\n\nTo reactivate a canceled subscription:\n\n1. Log in to your account\n2. Go to Settings > Billing\n3. Click "Reactivate"\n4. Choose a plan\n    ',
  },
];

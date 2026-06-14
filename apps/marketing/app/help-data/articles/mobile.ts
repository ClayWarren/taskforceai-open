import type { HelpArticle } from './types';

export const mobileArticles: HelpArticle[] = [
  {
    slug: 'installing-ios-app',
    categoryId: 'mobile',
    title: 'Installing the iOS app',
    description: 'Get TaskForceAI on your iPhone or iPad.',
    lastUpdated: '2025-01-15',
    content:
      '\n# Installing the iOS App\n\nGet TaskForceAI on your iPhone or iPad.\n\n## Requirements\n\n- iOS 15.0 or later\n- iPhone, iPad, or iPod touch\n- ~100MB storage\n\n## Installation\n\n1. Open the App Store\n2. Search for "TaskForceAI"\n3. Tap "Get" to download\n4. Open the app after installation\n\n## First Launch\n\n1. Tap "Sign In" or "Create Account"\n2. Enter your credentials\n3. Enable notifications (optional)\n4. Start chatting!\n\n## iPad Features\n\nOn iPad, TaskForceAI supports:\n\n- Split View multitasking\n- Slide Over\n- Keyboard shortcuts\n- Apple Pencil for selections\n\n## Face ID / Touch ID\n\nEnable biometric login:\n\n1. Open Settings in the app\n2. Go to "Security"\n3. Enable "Face ID" or "Touch ID"\n    ',
  },
  {
    slug: 'installing-android-app',
    categoryId: 'mobile',
    title: 'Installing the Android app',
    description: 'Get TaskForceAI on your Android device.',
    lastUpdated: '2025-01-15',
    content:
      '\n# Installing the Android App\n\nGet TaskForceAI on your Android phone or tablet.\n\n## Requirements\n\n- Android 8.0 (Oreo) or later\n- ~100MB storage\n\n## Installation\n\n1. Open Google Play Store\n2. Search for "TaskForceAI"\n3. Tap "Install"\n4. Open the app after installation\n\n## First Launch\n\n1. Tap "Sign In" or "Create Account"\n2. Enter your credentials\n3. Enable notifications (optional)\n4. Grant permissions as needed\n5. Start chatting!\n\n## Tablet Features\n\nOn Android tablets:\n\n- Optimized layout for larger screens\n- Keyboard shortcuts with external keyboards\n- Multi-window support\n\n## Biometric Login\n\nEnable fingerprint or face unlock:\n\n1. Open Settings in the app\n2. Go to "Security"\n3. Enable "Biometric Login"\n    ',
  },
  {
    slug: 'syncing-across-devices',
    categoryId: 'mobile',
    title: 'Syncing across devices',
    description: 'Keep your conversations in sync everywhere.',
    lastUpdated: '2025-01-15',
    content:
      '\n# Syncing Across Devices\n\nYour conversations sync automatically across all devices.\n\n## How Sync Works\n\nWhen you\'re signed in:\n\n- New conversations appear on all devices\n- Message history syncs in real-time\n- Settings sync across devices\n- Archive and delete actions sync\n\n## Sync Status\n\nCheck sync status:\n\n- Look for the sync indicator in the sidebar\n- Green = synced\n- Yellow = syncing\n- Red = sync error\n\n## Troubleshooting Sync\n\nIf sync isn\'t working:\n\n1. Check your internet connection\n2. Sign out and back in\n3. Force close and reopen the app\n4. Check [status page](https://status.taskforceai.chat) for issues\n\n## Offline Mode\n\nWhen offline:\n\n- You can view previous conversations\n- New messages queue for sending\n- Sync resumes when online\n\n## Selective Sync\n\nOn mobile, you can limit sync to save data:\n\n1. Go to Settings > Sync\n2. Choose "Sync over Wi-Fi only"\n    ',
  },
  {
    slug: 'push-notifications',
    categoryId: 'mobile',
    title: 'Push notifications',
    description: 'Configure mobile notifications.',
    lastUpdated: '2025-01-15',
    content:
      "\n# Push Notifications\n\nStay informed with mobile notifications.\n\n## Enabling Notifications\n\n### iOS\n\n1. Go to device Settings\n2. Find TaskForceAI\n3. Enable \"Allow Notifications\"\n\n### Android\n\n1. Go to device Settings > Apps\n2. Find TaskForceAI\n3. Enable notifications\n\n## Notification Types\n\nYou can receive notifications for:\n\n- New messages in shared conversations\n- Team mentions\n- System announcements\n- Billing alerts\n\n## Customizing Notifications\n\nIn the TaskForceAI app:\n\n1. Go to Settings > Notifications\n2. Toggle notification types on/off\n3. Set quiet hours if desired\n\n## Troubleshooting\n\nIf notifications aren't working:\n\n1. Check device notification settings\n2. Ensure you're signed in\n3. Check battery optimization isn't blocking\n4. Reinstall the app if needed\n    ",
  },
];

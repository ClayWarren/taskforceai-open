'use client';

export type ProfileTab =
  | 'general'
  | 'security'
  | 'keyboard'
  | 'notifications'
  | 'personalization'
  | 'subscription'
  | 'usage'
  | 'storage'
  | 'data'
  | 'finance'
  | 'apps'
  | 'mcp'
  | 'connections'
  | 'browser'
  | 'computer-use'
  | 'appshots'
  | 'environments'
  | 'worktrees'
  | 'archived-chats';

export {
  AppsIcon,
  DataIcon,
  GeneralIcon,
  KeyboardIcon,
  NotificationsIcon,
  PersonalizationIcon,
  StorageIcon,
  SubscriptionIcon,
} from './ProfileModalIcons';
export { CancelSubscriptionDialog, DeleteAccountDialog } from './ProfileModalDialogs';
export { ConnectedAppsSection } from '../integrations/ProfileConnectedApps';
export { ProfileFinanceSection } from '../billing/ProfileFinanceSection';
export { McpServersSection } from '../integrations/ProfileMcpServers';
export {
  DataControlsSection,
  SubscriptionSection,
  UpgradeSection,
} from '../billing/ProfileBillingSections';
export {
  FeedbackBanner,
  ProfileDetailsSection,
  SettingsSection,
} from '../account/ProfileBasicSections';
export { SecuritySection } from '../account/ProfileSecuritySection';
export { KeyboardShortcutsSection } from '../preferences/ProfileKeyboardSection';
export { NotificationsSection } from '../preferences/ProfileNotificationsSection';
export { PersonalizationSection } from '../preferences/ProfilePersonalizationSection';
export { UsageLimitsSection } from '../billing/ProfileUsageLimitsSection';
export { StorageSection } from '../account/ProfileStorageSection';
export { MemorySummaryDialog } from './ProfileMemorySummaryDialog';

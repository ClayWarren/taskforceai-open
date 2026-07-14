import type { SettingsItemDefinition, SettingsSectionDefinition } from './types';

export const settingsSections: SettingsSectionDefinition[] = [
  { id: 'general', i18nKey: 'mobile.settings.tabs.general', defaultLabel: 'General' },
  {
    id: 'security',
    i18nKey: 'mobile.settings.tabs.security',
    defaultLabel: 'Security and login',
  },
  {
    id: 'notifications',
    i18nKey: 'mobile.settings.tabs.notifications',
    defaultLabel: 'Notifications',
  },
  {
    id: 'personalization',
    i18nKey: 'mobile.settings.tabs.personalization',
    defaultLabel: 'Personalization',
  },
  {
    id: 'subscription',
    i18nKey: 'mobile.settings.tabs.subscription',
    defaultLabel: 'Subscription',
  },
  {
    id: 'usage',
    i18nKey: 'mobile.settings.tabs.usage',
    defaultLabel: 'Usage',
  },
  { id: 'storage', i18nKey: 'mobile.settings.tabs.storage', defaultLabel: 'Storage' },
  { id: 'data', i18nKey: 'mobile.settings.tabs.data', defaultLabel: 'Data controls' },
  { id: 'automation', i18nKey: 'mobile.settings.tabs.automation', defaultLabel: 'Automation' },
  { id: 'apps', i18nKey: 'mobile.settings.tabs.apps', defaultLabel: 'Connected Apps' },
];

export const settingsItems: SettingsItemDefinition[] = [
  {
    id: 'subscription',
    iconName: 'Zap',
    i18nKey: 'mobile.settings.tabs.subscription',
    defaultLabel: 'Subscription',
  },
  {
    id: 'usage',
    iconName: 'Gauge',
    i18nKey: 'mobile.settings.tabs.usage',
    defaultLabel: 'Usage',
  },
  {
    id: 'general',
    iconName: 'UserRound',
    i18nKey: 'mobile.settings.tabs.general',
    defaultLabel: 'General',
  },
  {
    id: 'security',
    iconName: 'ShieldCheck',
    i18nKey: 'mobile.settings.tabs.security',
    defaultLabel: 'Security and login',
  },
  {
    id: 'personalization',
    iconName: 'SlidersHorizontal',
    i18nKey: 'mobile.settings.tabs.personalization',
    defaultLabel: 'Personalization',
  },
  {
    id: 'notifications',
    iconName: 'Bell',
    i18nKey: 'mobile.settings.tabs.notifications',
    defaultLabel: 'Notifications',
  },
  {
    id: 'storage',
    iconName: 'HardDrive',
    i18nKey: 'mobile.settings.tabs.storage',
    defaultLabel: 'Storage',
  },
  {
    id: 'automation',
    iconName: 'Monitor',
    i18nKey: 'mobile.settings.tabs.automation',
    defaultLabel: 'Automation',
  },
  {
    id: 'apps',
    iconName: 'Globe',
    i18nKey: 'mobile.settings.tabs.apps',
    defaultLabel: 'Connected Apps',
  },
  {
    id: 'data',
    iconName: 'Database',
    i18nKey: 'mobile.settings.tabs.data',
    defaultLabel: 'Data controls',
  },
];

import type { IconName } from '../../components/Icon';

export type SettingsSectionId =
  | 'general'
  | 'security'
  | 'notifications'
  | 'personalization'
  | 'subscription'
  | 'usage'
  | 'storage'
  | 'data'
  | 'automation'
  | 'apps';

export type RemoteSettingsPatch = {
  full_name?: string;
  theme_preference?: 'dark' | 'light' | 'system';
  memory_enabled?: boolean;
  web_search_enabled?: boolean;
  code_execution_enabled?: boolean;
  notifications_enabled?: boolean;
  trust_layer_enabled?: boolean;
};

export type PersonalizationState = {
  memoryEnabled: boolean;
  webSearchEnabled: boolean;
  codeExecutionEnabled: boolean;
  trustLayerEnabled: boolean;
};

export type PersonalizationKey = keyof PersonalizationState;

export type IntegrationItem = {
  provider: string;
  connected: boolean;
};

export type SettingsSectionDefinition = {
  id: SettingsSectionId;
  i18nKey: string;
  defaultLabel: string;
};

export type SettingsItemDefinition = SettingsSectionDefinition & {
  iconName: IconName;
};

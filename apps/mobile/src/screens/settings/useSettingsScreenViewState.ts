import type { AuthenticatedUser, ProductSummary } from '@taskforceai/contracts/contracts';
import {
  formatProfilePlanLabel,
  resolveProfilePlanPriceLabels,
  resolveProfileDisplayName,
  resolveProfileHandle,
  resolveProfileInitials,
} from '@taskforceai/presenters/profile/view-model';

import { settingsSections } from './config';
import type { SettingsSectionId } from './types';

interface UseSettingsScreenViewStateOptions {
  activeSection: SettingsSectionId | null;
  products: ProductSummary[] | undefined;
  t: (key: string, options?: { defaultValue?: string }) => string;
  user: AuthenticatedUser | null | undefined;
}

export function useSettingsScreenViewState({
  activeSection,
  products,
  t,
  user,
}: UseSettingsScreenViewStateOptions) {
  const profileName = resolveProfileDisplayName({
    fullName: user?.full_name,
    email: user?.email,
    fallback: t('mobile.settings.notSet', { defaultValue: 'Not set' }),
  });
  const profileEmail = user?.email ?? t('mobile.settings.notSet', { defaultValue: 'Not set' });
  const profileInitials = resolveProfileInitials({
    fullName: user?.full_name,
    email: user?.email,
  });
  const profileHandle = resolveProfileHandle(user?.email);
  const planLabel = user?.plan ? formatProfilePlanLabel(user.plan) : undefined;

  const { proPriceLabel, superPriceLabel } = resolveProfilePlanPriceLabels(products);

  const currentSection = activeSection
    ? settingsSections.find((section) => section.id === activeSection) ?? null
    : null;
  const activeSectionLabel = currentSection
    ? t(currentSection.i18nKey, { defaultValue: currentSection.defaultLabel })
    : t('mobile.settings.title', { defaultValue: 'Settings' });

  return {
    activeSectionLabel,
    isAdmin: user?.is_admin === true,
    planLabel,
    proPriceLabel,
    profileEmail,
    profileHandle,
    profileInitials,
    profileName,
    superPriceLabel,
  };
}

import { getMobileClient } from './client';

type MobileClient = ReturnType<typeof getMobileClient>;

export type MobileSettingsPatch = Parameters<MobileClient['updateSettings']>[0];

export const updateMobileSettings = async (patch: MobileSettingsPatch) =>
  getMobileClient().updateSettings(patch);

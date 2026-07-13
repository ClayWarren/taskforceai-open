import { getMobileClient } from './client';

export const listMobileIntegrations = async () => getMobileClient().getIntegrations();

export const disconnectMobileIntegration = async (provider: string) =>
  getMobileClient().disconnectIntegration(provider);

import { getMobileClient } from './client';

type MobileClient = ReturnType<typeof getMobileClient>;

export type MobileMemoryUpdate = Parameters<MobileClient['updateMemory']>[1];
export type MobileMemoryCreate = Parameters<MobileClient['createMemory']>[0];

export const listMobileMemories = async () => getMobileClient().listMemories();

export const updateMobileMemory = async (id: number, patch: MobileMemoryUpdate) =>
  getMobileClient().updateMemory(id, patch);

export const createMobileMemory = async (request: MobileMemoryCreate) =>
  getMobileClient().createMemory(request);

export const deleteMobileMemory = async (id: number) => getMobileClient().deleteMemory(id);

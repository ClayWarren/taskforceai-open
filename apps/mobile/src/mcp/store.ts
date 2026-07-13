import AsyncStorage from '@react-native-async-storage/async-storage';
import { persistStoredMcpServers, readStoredMcpServers } from '@taskforceai/react-core';

import type { MobileMcpServerConfig } from './manager';
import { createModuleLogger } from '../logger';

const MOBILE_MCP_SERVERS_STORAGE_KEY = '@taskforceai:mcp-servers';

const logger = createModuleLogger('MobileMcpStore');
const listeners = new Set<() => void>();

const notifyMobileMcpServersChanged = (): void => {
  for (const listener of listeners) {
    listener();
  }
};

export const loadStoredMobileMcpServers = async (): Promise<MobileMcpServerConfig[]> => {
  return readStoredMcpServers<MobileMcpServerConfig>({
    read: () => AsyncStorage.getItem(MOBILE_MCP_SERVERS_STORAGE_KEY),
    onReadError: (error) => logger.error('Failed to load stored MCP servers', { error }),
  });
};

export const persistMobileMcpServers = async (
  servers: MobileMcpServerConfig[],
): Promise<MobileMcpServerConfig[]> => {
  return persistStoredMcpServers(
    {
      write: (value) => AsyncStorage.setItem(MOBILE_MCP_SERVERS_STORAGE_KEY, value),
      remove: () => AsyncStorage.removeItem(MOBILE_MCP_SERVERS_STORAGE_KEY),
      notify: notifyMobileMcpServersChanged,
      onWriteError: (error, count) =>
        logger.error('Failed to persist MCP servers', { error, count }),
    },
    servers,
  );
};

export const subscribeMobileMcpServers = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

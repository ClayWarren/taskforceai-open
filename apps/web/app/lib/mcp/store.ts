import type { WebMcpServerConfig } from './manager';
import {
  normalizeMcpServers,
  parseStoredMcpServers,
  serializeStoredMcpServers,
} from '@taskforceai/react-core';

import {
  readStorageItem,
  removeStorageItem,
  writeStorageItem,
} from '@taskforceai/shared/utils/browser-storage';

export const WEB_MCP_SERVERS_STORAGE_KEY = 'taskforceai:mcp-servers';
export const WEB_MCP_SERVERS_CHANGED_EVENT = 'taskforceai:mcp-servers-changed';

const notifyWebMcpServersChanged = (): void => {
  if (typeof window === 'undefined') {
    return;
  }
  window.dispatchEvent(new CustomEvent(WEB_MCP_SERVERS_CHANGED_EVENT));
};

export const readStoredWebMcpServers = (): WebMcpServerConfig[] => {
  const stored = readStorageItem(WEB_MCP_SERVERS_STORAGE_KEY);
  if (!stored.ok) {
    return [];
  }

  try {
    return parseStoredMcpServers<WebMcpServerConfig>(stored.value);
  } catch {
    return [];
  }
};

export const persistWebMcpServers = (servers: WebMcpServerConfig[]): WebMcpServerConfig[] => {
  const normalized = normalizeMcpServers(servers);
  const serialized = serializeStoredMcpServers(normalized);
  if (!serialized) {
    removeStorageItem(WEB_MCP_SERVERS_STORAGE_KEY);
    notifyWebMcpServersChanged();
    return [];
  }

  writeStorageItem(WEB_MCP_SERVERS_STORAGE_KEY, serialized);
  notifyWebMcpServersChanged();
  return normalized;
};

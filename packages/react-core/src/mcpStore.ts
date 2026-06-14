import type { McpServerConfig } from './mcpManager';

type MaybePromise<T> = T | Promise<T>;

export interface McpServerStoreAdapter {
  read: () => MaybePromise<string | null>;
  write: (value: string) => MaybePromise<void>;
  remove: () => MaybePromise<void>;
  notify?: () => void;
  onReadError?: (error: unknown) => void;
  onWriteError?: (error: unknown, count: number) => void;
}

export const normalizeMcpServers = <TServerConfig extends McpServerConfig>(
  servers: TServerConfig[]
): TServerConfig[] => {
  const normalized = new Map<string, TServerConfig>();

  for (const server of servers) {
    const name = server.name.trim();
    const endpoint = server.endpoint.trim();
    if (!name || !endpoint) {
      continue;
    }
    normalized.set(name.toLowerCase(), {
      ...server,
      name,
      endpoint,
      enabled: server.enabled,
    });
  }

  return [...normalized.values()];
};

export const parseStoredMcpServers = <TServerConfig extends McpServerConfig>(
  raw: string | null
): TServerConfig[] => {
  if (!raw) {
    return [];
  }

  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    return [];
  }

  return normalizeMcpServers(
    parsed.map((value) => {
      const item = value as { name?: unknown; endpoint?: unknown; enabled?: unknown } | null;
      return {
        name: typeof item?.name === 'string' ? item.name : '',
        endpoint: typeof item?.endpoint === 'string' ? item.endpoint : '',
        enabled: item?.enabled !== false,
      } as TServerConfig;
    })
  );
};

export const serializeStoredMcpServers = <TServerConfig extends McpServerConfig>(
  servers: TServerConfig[]
): string | null => {
  const normalized = normalizeMcpServers(servers);
  return normalized.length > 0 ? JSON.stringify(normalized) : null;
};

export const readStoredMcpServers = async <TServerConfig extends McpServerConfig>(
  adapter: Pick<McpServerStoreAdapter, 'read' | 'onReadError'>
): Promise<TServerConfig[]> => {
  try {
    return parseStoredMcpServers<TServerConfig>(await adapter.read());
  } catch (error) {
    adapter.onReadError?.(error);
    return [];
  }
};

export const persistStoredMcpServers = async <TServerConfig extends McpServerConfig>(
  adapter: Pick<McpServerStoreAdapter, 'write' | 'remove' | 'notify' | 'onWriteError'>,
  servers: TServerConfig[]
): Promise<TServerConfig[]> => {
  const normalized = normalizeMcpServers(servers);

  try {
    if (normalized.length === 0) {
      await adapter.remove();
      adapter.notify?.();
      return [];
    }

    await adapter.write(JSON.stringify(normalized));
    adapter.notify?.();
    return normalized;
  } catch (error) {
    adapter.onWriteError?.(error, normalized.length);
    return normalized;
  }
};

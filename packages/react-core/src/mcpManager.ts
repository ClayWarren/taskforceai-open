export type McpServerConfig = {
  name: string;
  endpoint: string;
  enabled: boolean;
};

export type McpToolSummary = {
  name: string;
  title: string;
  description: string;
};

export type McpPromptSummary = {
  name: string;
  title: string;
  description: string;
};

export type McpResourceSummary = {
  name: string;
  title: string;
  description: string;
  uri: string;
  mimeType: string;
};

export type McpServerSnapshot<TExtra extends object = object> = {
  name: string;
  endpoint: string;
  serverName: string;
  serverVersion: string;
  instructions: string;
  tools: McpToolSummary[];
  prompts: McpPromptSummary[];
  resources: McpResourceSummary[];
} & TExtra;

export type McpClientLike = {
  callTool: (params: { name: string; arguments?: Record<string, unknown> }) => Promise<unknown>;
  close: () => Promise<void>;
  getInstructions: () => string | undefined;
  getServerCapabilities: () =>
    | {
        tools?: unknown;
        prompts?: unknown;
        resources?: unknown;
      }
    | undefined;
  getServerVersion: () =>
    | {
        name?: string | null;
        version?: string | null;
      }
    | undefined;
  listPrompts: (params?: { cursor: string }) => Promise<{
    prompts: Array<{
      name: string;
      title?: string | null;
      description?: string | null;
    }>;
    nextCursor?: string;
  }>;
  listResources: (params?: { cursor: string }) => Promise<{
    resources: Array<{
      name: string;
      title?: string | null;
      description?: string | null;
      uri: string;
      mimeType?: string | null;
    }>;
    nextCursor?: string;
  }>;
  listTools: (params?: { cursor: string }) => Promise<{
    tools: Array<{
      name: string;
      title?: string | null;
      description?: string | null;
    }>;
    nextCursor?: string;
  }>;
};

export type McpConnectedSession<
  TClient extends McpClientLike = McpClientLike,
  TTransport extends { close: () => Promise<void> } = { close: () => Promise<void> },
> = {
  client: TClient;
  transport: TTransport;
};

type ManagedSession<
  TEndpoint extends { url: URL },
  TClient extends McpClientLike,
  TTransport extends { close: () => Promise<void> },
> = {
  endpoint: TEndpoint;
  server: McpServerConfig;
  session: McpConnectedSession<TClient, TTransport>;
};

export type SharedMcpManagerOptions<
  TEndpoint extends { url: URL },
  TExtra extends object,
  TClient extends McpClientLike = McpClientLike,
  TTransport extends { close: () => Promise<void> } = { close: () => Promise<void> },
> = {
  connect: (rawEndpoint: string) => Promise<McpConnectedSession<TClient, TTransport>>;
  parseEndpoint: (rawEndpoint: string) => TEndpoint;
  isEndpointMatch?: (left: TEndpoint, right: TEndpoint) => boolean;
  getSnapshotExtra?: (session: ManagedSession<TEndpoint, TClient, TTransport>) => TExtra;
};

const normalizeServerKey = (name: string): string => name.trim().toLowerCase();

const trimValue = (value: string | null | undefined): string => value?.trim() ?? '';
const MAX_MCP_PAGINATION_PAGES = 20;

const listPaginated = async <TItem, TResult extends { nextCursor?: string }>(
  fetchPage: (cursor?: string) => Promise<TResult>,
  mapItems: (result: TResult) => TItem[]
): Promise<TItem[]> => {
  const items: TItem[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;

  for (let page = 0; page < MAX_MCP_PAGINATION_PAGES; page += 1) {
    // eslint-disable-next-line no-await-in-loop -- cursor pagination is intentionally sequential.
    const result = await fetchPage(cursor);
    items.push(...mapItems(result));
    if (!result.nextCursor) {
      return items;
    }

    const nextCursor = result.nextCursor.trim();
    if (!nextCursor || seenCursors.has(nextCursor)) {
      throw new Error('MCP pagination cursor did not advance');
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }

  throw new Error('MCP pagination exceeded maximum page count');
};

const listAllTools = async (client: McpClientLike): Promise<McpToolSummary[]> => {
  return listPaginated(
    (cursor) => client.listTools(cursor ? { cursor } : undefined),
    (result) =>
      result.tools.map((tool) => ({
        name: tool.name,
        title: trimValue(tool.title),
        description: trimValue(tool.description),
      }))
  );
};

const listAllPrompts = async (client: McpClientLike): Promise<McpPromptSummary[]> => {
  return listPaginated(
    (cursor) => client.listPrompts(cursor ? { cursor } : undefined),
    (result) =>
      result.prompts.map((prompt) => ({
        name: prompt.name,
        title: trimValue(prompt.title),
        description: trimValue(prompt.description),
      }))
  );
};

const listAllResources = async (client: McpClientLike): Promise<McpResourceSummary[]> => {
  return listPaginated(
    (cursor) => client.listResources(cursor ? { cursor } : undefined),
    (result) =>
      result.resources.map((resource) => ({
        name: resource.name,
        title: trimValue(resource.title),
        description: trimValue(resource.description),
        uri: resource.uri,
        mimeType: trimValue(resource.mimeType),
      }))
  );
};

export class SharedMcpManager<
  TEndpoint extends { url: URL },
  TExtra extends object = object,
  TClient extends McpClientLike = McpClientLike,
  TTransport extends { close: () => Promise<void> } = { close: () => Promise<void> },
> {
  private readonly sessions = new Map<string, ManagedSession<TEndpoint, TClient, TTransport>>();
  private readonly connect: (
    rawEndpoint: string
  ) => Promise<McpConnectedSession<TClient, TTransport>>;
  private readonly parseEndpoint: (rawEndpoint: string) => TEndpoint;
  private readonly isEndpointMatch: (left: TEndpoint, right: TEndpoint) => boolean;
  private readonly getSnapshotExtra:
    | ((session: ManagedSession<TEndpoint, TClient, TTransport>) => TExtra)
    | undefined;

  constructor(options: SharedMcpManagerOptions<TEndpoint, TExtra, TClient, TTransport>) {
    this.connect = options.connect;
    this.parseEndpoint = options.parseEndpoint;
    this.isEndpointMatch =
      options.isEndpointMatch ?? ((left, right) => left.url.toString() === right.url.toString());
    this.getSnapshotExtra = options.getSnapshotExtra;
  }

  async discover(server: McpServerConfig): Promise<McpServerSnapshot<TExtra>> {
    const managed = await this.ensureConnected(server);
    const capabilities = managed.session.client.getServerCapabilities();
    const serverVersion = managed.session.client.getServerVersion();

    const snapshot: McpServerSnapshot<TExtra> = {
      name: managed.server.name,
      endpoint: managed.server.endpoint,
      serverName: trimValue(serverVersion?.name),
      serverVersion: trimValue(serverVersion?.version),
      instructions: trimValue(managed.session.client.getInstructions()),
      tools: [],
      prompts: [],
      resources: [],
      ...(this.getSnapshotExtra ? this.getSnapshotExtra(managed) : ({} as TExtra)),
    };

    if (capabilities?.tools) {
      snapshot.tools = await listAllTools(managed.session.client);
    }
    if (capabilities?.prompts) {
      snapshot.prompts = await listAllPrompts(managed.session.client);
    }
    if (capabilities?.resources) {
      snapshot.resources = await listAllResources(managed.session.client);
    }

    return snapshot;
  }

  async callTool(
    server: McpServerConfig,
    name: string,
    argumentsObject: Record<string, unknown> = {}
  ): Promise<Awaited<ReturnType<TClient['callTool']>>> {
    const managed = await this.ensureConnected(server);
    const toolName = name.trim();
    if (!toolName) {
      throw new Error('Tool name is required.');
    }

    return managed.session.client.callTool({
      name: toolName,
      arguments: argumentsObject,
    }) as Awaited<ReturnType<TClient['callTool']>>;
  }

  async close(name: string): Promise<void> {
    const key = normalizeServerKey(name);
    if (!key) {
      return;
    }

    const managed = this.sessions.get(key);
    this.sessions.delete(key);
    await closeManagedSession(managed);
  }

  async closeAll(): Promise<void> {
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.all(sessions.map((session) => closeManagedSession(session)));
  }

  private async ensureConnected(
    server: McpServerConfig
  ): Promise<ManagedSession<TEndpoint, TClient, TTransport>> {
    const name = server.name.trim();
    if (!name) {
      throw new Error('MCP server name is required.');
    }
    if (!server.enabled) {
      throw new Error(`MCP server ${name} is disabled.`);
    }

    const endpoint = this.parseEndpoint(server.endpoint);
    const key = normalizeServerKey(name);
    const existing = this.sessions.get(key);
    if (existing && isSessionMatch(existing, server, endpoint, this.isEndpointMatch)) {
      return existing;
    }

    this.sessions.delete(key);
    await closeManagedSession(existing);

    const session = await this.connect(server.endpoint);
    const managed: ManagedSession<TEndpoint, TClient, TTransport> = {
      endpoint,
      server: {
        ...server,
        name,
      },
      session,
    };
    this.sessions.set(key, managed);
    return managed;
  }
}

const isSessionMatch = <
  TEndpoint extends { url: URL },
  TClient extends McpClientLike,
  TTransport extends { close: () => Promise<void> },
>(
  session: ManagedSession<TEndpoint, TClient, TTransport>,
  server: McpServerConfig,
  endpoint: TEndpoint,
  isEndpointMatch: (left: TEndpoint, right: TEndpoint) => boolean
): boolean =>
  session.server.enabled === server.enabled &&
  session.server.endpoint === server.endpoint &&
  isEndpointMatch(session.endpoint, endpoint);

const closeManagedSession = async <
  TEndpoint extends { url: URL },
  TClient extends McpClientLike,
  TTransport extends { close: () => Promise<void> },
>(
  session: ManagedSession<TEndpoint, TClient, TTransport> | undefined
): Promise<void> => {
  if (!session) {
    return;
  }
  await session.session.client.close();
};

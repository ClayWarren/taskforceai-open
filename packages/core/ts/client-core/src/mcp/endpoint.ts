export type McpTransportKind = 'streamable-http' | 'sse';

export type ParsedMcpEndpoint = {
  transport: McpTransportKind;
  url: URL;
};

export const parseMcpEndpoint = (
  raw: string,
  options: { allowSse?: boolean } = {}
): ParsedMcpEndpoint => {
  const trimmed = raw.trim();
  if (
    options.allowSse &&
    (trimmed.startsWith('sse+http://') || trimmed.startsWith('sse+https://'))
  ) {
    return {
      transport: 'sse',
      url: new URL(trimmed.slice('sse+'.length)),
    };
  }

  const url = new URL(trimmed);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Unsupported MCP endpoint protocol: ${url.protocol}`);
  }

  return {
    transport: 'streamable-http',
    url,
  };
};

import { describe, expect, it } from 'bun:test';

import { parseMcpEndpoint } from './endpoint';

describe('mcp endpoint parsing', () => {
  it('parses streamable HTTP endpoints by default', () => {
    const endpoint = parseMcpEndpoint(' https://example.com/mcp ');

    expect(endpoint.transport).toBe('streamable-http');
    expect(endpoint.url.href).toBe('https://example.com/mcp');
  });

  it('parses SSE endpoints when enabled', () => {
    const endpoint = parseMcpEndpoint('sse+https://example.com/events', { allowSse: true });

    expect(endpoint.transport).toBe('sse');
    expect(endpoint.url.href).toBe('https://example.com/events');
  });

  it('rejects SSE endpoints when disabled', () => {
    expect(() => parseMcpEndpoint('sse+https://example.com/events')).toThrow(
      'Unsupported MCP endpoint protocol: sse+https:'
    );
  });

  it('rejects unsupported endpoint protocols', () => {
    expect(() => parseMcpEndpoint('stdio://local-server')).toThrow(
      'Unsupported MCP endpoint protocol: stdio:'
    );
  });
});

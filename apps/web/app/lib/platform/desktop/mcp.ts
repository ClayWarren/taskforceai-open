'use client';

import { invokeTauri } from './bridge';

export type DesktopMcpServerConfig = {
  name: string;
  endpoint: string;
  enabled: boolean;
};

export type DesktopMcpToolSummary = {
  name: string;
  title: string;
  description: string;
};

export type DesktopMcpPromptSummary = {
  name: string;
  title: string;
  description: string;
};

export type DesktopMcpResourceSummary = {
  name: string;
  title: string;
  description: string;
  uri: string;
  mime_type: string;
};

export type DesktopMcpServerSnapshot = {
  name: string;
  endpoint: string;
  transport: 'stdio' | 'streamable_http';
  protocol_version: string;
  server_name: string;
  server_title: string;
  server_version: string;
  instructions: string;
  tools: DesktopMcpToolSummary[];
  prompts: DesktopMcpPromptSummary[];
  resources: DesktopMcpResourceSummary[];
};

export const inspectDesktopMcpServer = (server: DesktopMcpServerConfig) =>
  invokeTauri<DesktopMcpServerSnapshot>('mcp_discover', { server });

export const callDesktopMcpTool = (
  _server: DesktopMcpServerConfig,
  _name: string,
  _argumentsObject?: Record<string, unknown>
) => Promise.reject(new Error('MCP tool execution requires explicit user approval.'));

export const closeDesktopMcpServer = (serverName: string) =>
  invokeTauri<void>('mcp_close', { serverName });

export const closeAllDesktopMcpServers = () => invokeTauri<void>('mcp_close_all');

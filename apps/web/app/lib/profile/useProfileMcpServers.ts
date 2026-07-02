'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  formatMcpServerInspectionSummary,
  normalizeMcpServerInput,
  removeMcpServerByName,
  upsertMcpServerByName,
} from '@taskforceai/shared/mcp/settings';

import { logger } from '../logger';
import { WebMcpManager } from '../mcp/manager';
import { persistWebMcpServers, readStoredWebMcpServers } from '../mcp/store';
import { waitForTauriBridge } from '../platform/desktop/bridge';
import { inspectDesktopMcpServer } from '../platform/desktop/mcp';

type McpServer = {
  name: string;
  endpoint: string;
  enabled: boolean;
};

interface UseProfileMcpServersOptions {
  open: boolean;
  setFeedbackKind: (kind: 'success' | 'error') => void;
  setFeedbackMessage: (message: string | null) => void;
  userEmail: string | null;
}

export function useProfileMcpServers({
  open,
  setFeedbackKind,
  setFeedbackMessage,
  userEmail,
}: UseProfileMcpServersOptions) {
  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);
  const [pendingMcpName, setPendingMcpName] = useState('');
  const [pendingMcpEndpoint, setPendingMcpEndpoint] = useState('');
  const [mcpBusyServerName, setMcpBusyServerName] = useState<string | null>(null);
  const webMcpManagerRef = useRef(new WebMcpManager());
  const lastLoadedUserEmailRef = useRef<string | null>(null);

  useEffect(() => {
    if (open && userEmail !== lastLoadedUserEmailRef.current) {
      setMcpServers(readStoredWebMcpServers());
      lastLoadedUserEmailRef.current = userEmail;
    }

    if (!open) {
      setMcpBusyServerName(null);
      lastLoadedUserEmailRef.current = null;
      void webMcpManagerRef.current.closeAll();
    }
  }, [open, userEmail]);

  const handleSaveMcpServer = useCallback(() => {
    const input = normalizeMcpServerInput({
      name: pendingMcpName,
      endpoint: pendingMcpEndpoint,
    });
    if (!input.ok) {
      setFeedbackKind('error');
      setFeedbackMessage(input.message);
      return;
    }

    const nextServers = persistWebMcpServers(upsertMcpServerByName(mcpServers, input.value));
    setMcpServers(nextServers);
    setPendingMcpName('');
    setPendingMcpEndpoint('');
    setFeedbackKind('success');
    setFeedbackMessage(`Saved MCP server ${input.value.name}.`);
  }, [mcpServers, pendingMcpEndpoint, pendingMcpName, setFeedbackKind, setFeedbackMessage]);

  const handleRemoveMcpServer = useCallback(
    (serverName: string) => {
      const nextServers = persistWebMcpServers(removeMcpServerByName(mcpServers, serverName));
      setMcpServers(nextServers);
      void webMcpManagerRef.current.close(serverName);
      setFeedbackKind('success');
      setFeedbackMessage(`Removed MCP server ${serverName}.`);
    },
    [mcpServers, setFeedbackKind, setFeedbackMessage]
  );

  const handleInspectMcpServer = useCallback(
    async (server: McpServer) => {
      setMcpBusyServerName(server.name);
      try {
        const hasDesktopBridge = await waitForTauriBridge(50);
        const snapshot = hasDesktopBridge
          ? await inspectDesktopMcpServer(server)
          : await webMcpManagerRef.current.discover(server);
        const snapshotName = 'server_name' in snapshot ? snapshot.server_name : snapshot.serverName;
        setFeedbackKind('success');
        setFeedbackMessage(
          formatMcpServerInspectionSummary({
            serverName: snapshotName,
            fallbackName: server.name,
            tools: snapshot.tools.length,
            prompts: snapshot.prompts.length,
            resources: snapshot.resources.length,
          })
        );
      } catch (error) {
        logger.error('Failed to inspect MCP server', { error, server });
        setFeedbackKind('error');
        setFeedbackMessage(`Failed to inspect MCP server ${server.name}.`);
      } finally {
        setMcpBusyServerName(null);
      }
    },
    [setFeedbackKind, setFeedbackMessage]
  );

  return {
    handleInspectMcpServer,
    handleRemoveMcpServer,
    handleSaveMcpServer,
    mcpBusyServerName,
    mcpServers,
    pendingMcpEndpoint,
    pendingMcpName,
    setPendingMcpEndpoint,
    setPendingMcpName,
  };
}

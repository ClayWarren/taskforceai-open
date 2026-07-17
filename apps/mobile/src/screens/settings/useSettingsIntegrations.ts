import React from 'react';
import { Alert, Linking } from 'react-native';

import {
  normalizeMcpServerInput,
  removeMcpServerByName,
  upsertMcpServerByName,
} from '@taskforceai/client-core/mcp/settings';

import { disconnectMobileIntegration, listMobileIntegrations } from '../../api/integrations';
import { getMobileBaseUrl } from '../../config/base-url';
import { createModuleLogger } from '../../logger';
import { MobileMcpManager } from '../../mcp/manager';
import { loadStoredMobileMcpServers, persistMobileMcpServers } from '../../mcp/store';
import type { IntegrationItem, SettingsSectionId } from './types';

const logger = createModuleLogger('SettingsIntegrations');

interface UseSettingsIntegrationsOptions {
  visible: boolean;
  activeSection: SettingsSectionId | null;
  t: (_key: string, _options?: { defaultValue?: string }) => string;
}

export function useSettingsIntegrations({
  visible,
  activeSection,
  t,
}: UseSettingsIntegrationsOptions) {
  const [integrations, setIntegrations] = React.useState<IntegrationItem[]>([]);
  const [loadingIntegrations, setLoadingIntegrations] = React.useState(false);
  const [integrationActionProvider, setIntegrationActionProvider] = React.useState<string | null>(
    null
  );
  const [mcpServers, setMcpServers] = React.useState<
    Array<{ name: string; endpoint: string; enabled: boolean }>
  >([]);
  const [pendingMcpName, setPendingMcpName] = React.useState('');
  const [pendingMcpEndpoint, setPendingMcpEndpoint] = React.useState('');
  const [mcpActionServer, setMcpActionServer] = React.useState<string | null>(null);
  const mcpManagerRef = React.useRef(new MobileMcpManager());

  const loadIntegrations = React.useCallback(async () => {
    setLoadingIntegrations(true);
    try {
      const result = await listMobileIntegrations();
      setIntegrations(result.map((item) => ({ provider: item.provider, connected: item.connected })));
    } catch (error) {
      logger.error('Failed to load integrations', { error });
      Alert.alert(
        t('mobile.settings.integrationsLoadErrorTitle', { defaultValue: 'Unable to load apps' }),
        t('mobile.settings.integrationsLoadErrorMessage', {
          defaultValue: 'Please try again in a moment.',
        })
      );
    } finally {
      setLoadingIntegrations(false);
    }
  }, [t]);

  React.useEffect(() => {
    if (!visible || activeSection !== 'apps') return;
    void loadIntegrations();
    void loadStoredMobileMcpServers().then(setMcpServers);
  }, [activeSection, loadIntegrations, visible]);

  React.useEffect(() => {
    if (!visible) {
      void mcpManagerRef.current.closeAll();
    }
  }, [visible]);

  const handleConnectIntegration = async (provider: string) => {
    const baseURL = getMobileBaseUrl().replace(/\/+$/, '');
    const signInURL = `${baseURL}/api/auth/signin/${provider}`;
    try {
      await Linking.openURL(signInURL);
    } catch (error) {
      logger.error('Failed to open integration connect URL', { error, provider, signInURL });
      Alert.alert(
        t('mobile.settings.integrationsConnectErrorTitle', { defaultValue: 'Unable to connect' }),
        t('mobile.settings.integrationsConnectErrorMessage', {
          defaultValue: 'Please try again from a web browser.',
        })
      );
    }
  };

  const handleDisconnectIntegration = async (provider: string) => {
    setIntegrationActionProvider(provider);
    try {
      await disconnectMobileIntegration(provider);
      await loadIntegrations();
    } catch (error) {
      logger.error('Failed to disconnect integration', { error, provider });
      Alert.alert(
        t('mobile.settings.integrationsDisconnectErrorTitle', {
          defaultValue: 'Unable to disconnect',
        }),
        t('mobile.settings.integrationsDisconnectErrorMessage', {
          defaultValue: 'Please try again in a moment.',
        })
      );
    } finally {
      setIntegrationActionProvider(null);
    }
  };

  const handleAddMcpServer = async () => {
    const input = normalizeMcpServerInput({
      name: pendingMcpName,
      endpoint: pendingMcpEndpoint,
      missingMessage: 'Please provide both a server name and endpoint.',
    });
    if (!input.ok) {
      Alert.alert('MCP server required', input.message);
      return;
    }

    try {
      const nextServers = await persistMobileMcpServers(
        upsertMcpServerByName(mcpServers, input.value)
      );
      setMcpServers(nextServers);
      setPendingMcpName('');
      setPendingMcpEndpoint('');
      Alert.alert('MCP server saved', `${input.value.name} is ready to inspect.`);
    } catch (error) {
      logger.error('Failed to save MCP server', { error, server: input.value });
      Alert.alert('Unable to save MCP server', 'Please try again in a moment.');
    }
  };

  const handleRemoveMcpServer = async (serverName: string) => {
    try {
      const nextServers = await persistMobileMcpServers(
        removeMcpServerByName(mcpServers, serverName)
      );
      setMcpServers(nextServers);
      await mcpManagerRef.current.close(serverName);
      Alert.alert('MCP server removed', `${serverName} has been removed.`);
    } catch (error) {
      logger.error('Failed to remove MCP server', { error, serverName });
      Alert.alert('Unable to remove MCP server', 'Please try again in a moment.');
    }
  };

  const handleInspectMcpServer = async (serverName: string) => {
    const server = mcpServers.find((entry) => entry.name === serverName);
    if (!server) {
      return;
    }

    setMcpActionServer(server.name);
    try {
      const snapshot = await mcpManagerRef.current.discover(server);
      Alert.alert(
        snapshot.serverName || server.name,
        `${snapshot.tools.length} tools, ${snapshot.prompts.length} prompts, ${snapshot.resources.length} resources`
      );
    } catch (error) {
      logger.error('Failed to inspect mobile MCP server', { error, server });
      Alert.alert('MCP inspection failed', `Unable to inspect ${server.name}.`);
    } finally {
      setMcpActionServer(null);
    }
  };

  return {
    integrations,
    loadingIntegrations,
    integrationActionProvider,
    mcpServers,
    pendingMcpName,
    setPendingMcpName,
    pendingMcpEndpoint,
    setPendingMcpEndpoint,
    mcpActionServer,
    handleConnectIntegration,
    handleDisconnectIntegration,
    handleAddMcpServer,
    handleRemoveMcpServer,
    handleInspectMcpServer,
  };
}

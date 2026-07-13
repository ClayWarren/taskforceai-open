import React from 'react';
import { ActivityIndicator, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useTheme } from '../../../contexts/ThemeContext';
import { ActionButton } from '../../../components/ActionButton';
import { Section } from '../components';
import { DesktopPairingCard } from './DesktopPairingCard';

interface IntegrationItem {
  provider: string;
  connected: boolean;
}

interface IntegrationsSectionProps {
  integrations: IntegrationItem[];
  mcpServers: Array<{ name: string; endpoint: string; enabled: boolean }>;
  loading: boolean;
  actionProvider: string | null;
  pendingMcpName: string;
  pendingMcpEndpoint: string;
  mcpActionServer: string | null;
  onConnect: (provider: string) => void;
  onDisconnect: (provider: string) => void;
  onPendingMcpNameChange: (value: string) => void;
  onPendingMcpEndpointChange: (value: string) => void;
  onAddMcpServer: () => void;
  onInspectMcpServer: (serverName: string) => void;
  onRemoveMcpServer: (serverName: string) => void;
  desktopPairingPayload?: string | null;
}

export function IntegrationsSection({
  integrations,
  mcpServers,
  loading,
  actionProvider,
  pendingMcpName,
  pendingMcpEndpoint,
  mcpActionServer,
  onConnect,
  onDisconnect,
  onPendingMcpNameChange,
  onPendingMcpEndpointChange,
  onAddMcpServer,
  onInspectMcpServer,
  onRemoveMcpServer,
  desktopPairingPayload,
}: IntegrationsSectionProps) {
  const { theme } = useTheme();
  const { t } = useTranslation();

  const formatProviderName = (provider: string): string =>
    provider
      .split('-')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');

  return (
    <Section title={t('mobile.settings.tabs.apps', { defaultValue: 'Connected Apps' })} variant="plain">
      <DesktopPairingCard initialPayload={desktopPairingPayload} />

      {loading ? (
        <View className="rounded-2xl border border-white/10 bg-white/5 px-md py-lg">
          <ActivityIndicator size="small" color={theme.colors.primary} />
        </View>
      ) : integrations.length > 0 ? (
        integrations.map((integration) => (
          <View
            key={integration.provider}
            className="rounded-2xl border border-white/10 bg-white/5 px-md py-md"
          >
            <Text className="text-text text-sm font-semibold">
              {formatProviderName(integration.provider)}
            </Text>
            <Text className="text-text-muted mt-1 text-xs">
              {integration.connected
                ? t('mobile.settings.integrationConnected', { defaultValue: 'Connected' })
                : t('mobile.settings.integrationNotConnected', { defaultValue: 'Not connected' })}
            </Text>
            {integration.connected ? (
              <ActionButton
                variant="danger"
                disabled={actionProvider === integration.provider}
                isLoading={actionProvider === integration.provider}
                onPress={() => {
                  onDisconnect(integration.provider);
                }}
              >
                {t('mobile.settings.disconnectApp', { defaultValue: 'Disconnect' })}
              </ActionButton>
            ) : (
              <ActionButton
                disabled={actionProvider === integration.provider}
                onPress={() => {
                  onConnect(integration.provider);
                }}
              >
                {t('mobile.settings.connectApp', { defaultValue: 'Connect' })}
              </ActionButton>
            )}
          </View>
        ))
      ) : (
        <View className="rounded-2xl border border-white/10 bg-white/5 px-md py-md">
          <Text className="text-text-muted text-sm">
            {t('mobile.settings.noConnectedApps', {
              defaultValue: 'No connected apps found.',
            })}</Text>
        </View>
      )}

      <View className="mt-md rounded-2xl border border-white/10 bg-white/5 px-md py-md">
        <Text className="text-text text-sm font-semibold">MCP Servers</Text>
        <Text className="text-text-muted mt-1 text-xs">
          Add remote MCP endpoints here. Mobile supports remote HTTP-based MCP servers.
        </Text>

        <TextInput
          value={pendingMcpName}
          onChangeText={onPendingMcpNameChange}
          placeholder="Server name"
          placeholderTextColor={theme.colors.textMuted}
          className="mt-3 rounded-xl border border-white/10 px-md py-sm text-text"
        />
        <TextInput
          value={pendingMcpEndpoint}
          onChangeText={onPendingMcpEndpointChange}
          placeholder="https://example.com/mcp"
          placeholderTextColor={theme.colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          className="mt-3 rounded-xl border border-white/10 px-md py-sm text-text"
        />
        <ActionButton onPress={onAddMcpServer}>Save MCP Server</ActionButton>

        {mcpServers.length === 0 ? (
          <Text className="text-text-muted mt-3 text-sm">No MCP servers saved yet.</Text>
        ) : (
          mcpServers.map((server) => (
            <View
              key={server.name}
              className="mt-3 rounded-2xl border border-white/10 bg-black/10 px-md py-md"
            >
              <Text className="text-text text-sm font-semibold">{server.name}</Text>
              <Text className="text-text-muted mt-1 text-xs">{server.endpoint}</Text>
              <View className="mt-3 flex-row gap-sm">
                <ActionButton
                  disabled={mcpActionServer === server.name}
                  isLoading={mcpActionServer === server.name}
                  onPress={() => {
                    onInspectMcpServer(server.name);
                  }}
                >
                  Inspect
                </ActionButton>
                <ActionButton
                  variant="danger"
                  disabled={mcpActionServer === server.name}
                  onPress={() => {
                    onRemoveMcpServer(server.name);
                  }}
                >
                  Remove
                </ActionButton>
              </View>
            </View>
          ))
        )}
      </View>
    </Section>
  );
}

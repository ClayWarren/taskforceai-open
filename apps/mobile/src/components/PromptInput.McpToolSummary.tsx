import { insertMcpToolCommandIntoPrompt, type McpRuntimeToolDescriptor } from '@taskforceai/shared';
import { spacingTokens } from '@taskforceai/design-tokens';
import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

interface PromptInputMcpToolSummaryProps {
  message: string;
  summary?: string | null;
  items: McpRuntimeToolDescriptor[];
  onMessageChange: (_message: string) => void;
}

export function PromptInputMcpToolSummary({
  message,
  summary,
  items,
  onMessageChange,
}: PromptInputMcpToolSummaryProps) {
  if (!summary) {
    return null;
  }

  const handleInsertTool = (serverName: string, toolName: string) => {
    onMessageChange(insertMcpToolCommandIntoPrompt({ prompt: message, serverName, toolName }));
  };

  return (
    <View className="mb-xs">
      <Text className="mb-xs px-md text-xs text-sky-200">{summary}</Text>
      {items.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.mcpToolsContent}
        >
          {items.slice(0, 6).map((item) => (
            <TouchableOpacity
              key={`${item.serverName}:${item.toolName}`}
              style={styles.mcpToolChip}
              onPress={() => handleInsertTool(item.serverName, item.toolName)}
              accessibilityRole="button"
              accessibilityLabel={`Use MCP tool ${item.serverName}/${item.toolName}`}
            >
              <Text style={styles.mcpToolChipText}>{item.serverName}/{item.toolName}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  mcpToolsContent: {
    paddingHorizontal: spacingTokens.md,
    gap: spacingTokens.xs,
    flexDirection: 'row',
  },
  mcpToolChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(56,189,248,0.35)',
    backgroundColor: 'rgba(14,165,233,0.12)',
    paddingHorizontal: spacingTokens.sm,
    paddingVertical: spacingTokens.xs / 2,
  },
  mcpToolChipText: {
    color: '#e0f2fe',
    fontSize: 11,
    fontWeight: '500',
  },
});

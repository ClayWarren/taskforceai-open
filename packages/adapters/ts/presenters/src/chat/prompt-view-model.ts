import { formatMcpToolCallCommand } from '@taskforceai/client-core/chat/mcp-tools';

export type PromptPrimaryActionMode = 'voice' | 'send' | 'stop';

export interface PromptPrimaryActionState {
  mode: PromptPrimaryActionMode;
  disabled: boolean;
  title: string;
}

export const hasPromptText = (prompt: string): boolean => prompt.trim().length > 0;

export const hasCustomRoleModels = (roleModels?: Record<string, string> | null): boolean =>
  Object.keys(roleModels ?? {}).length > 0;

export const resolvePromptPrimaryAction = ({
  prompt,
  hasAttachments = false,
  controlsDisabled,
  interactionsDisabled,
  loading,
  isListening,
  isStreaming = false,
  isAuthenticated = true,
}: {
  prompt: string;
  hasAttachments?: boolean;
  controlsDisabled: boolean;
  interactionsDisabled: boolean;
  loading: boolean;
  isListening: boolean;
  isStreaming?: boolean;
  isAuthenticated?: boolean;
}): PromptPrimaryActionState => {
  if (isStreaming) {
    return { mode: 'stop', disabled: false, title: 'Stop run' };
  }

  const mode: PromptPrimaryActionMode = hasPromptText(prompt) || hasAttachments ? 'send' : 'voice';
  const disabled = mode === 'send' ? controlsDisabled : interactionsDisabled || loading;
  const title =
    mode === 'send'
      ? isAuthenticated
        ? 'Send message'
        : 'Login required to send messages'
      : isListening
        ? 'Stop dictation'
        : 'Dictate with your microphone';

  return { mode, disabled, title };
};

export const insertMcpToolCommandIntoPrompt = ({
  prompt,
  serverName,
  toolName,
}: {
  prompt: string;
  serverName: string;
  toolName: string;
}): string => {
  const command = formatMcpToolCallCommand(serverName, toolName);
  const trimmedPrompt = prompt.trim();

  if (!trimmedPrompt) {
    return command;
  }

  if (trimmedPrompt === command.trim()) {
    return prompt;
  }

  return `${prompt.trimEnd()}\n${command}`;
};

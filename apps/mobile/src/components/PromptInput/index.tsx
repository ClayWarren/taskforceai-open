import { spacingTokens } from '@taskforceai/design-tokens';
import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PROMPT_BUBBLE_MAX_WIDTH } from './internal';
import { usePromptInputState, type PromptInputProps } from './state';
import { PromptInputView } from './view';

export type { PromptInputProps } from './state';

export const resolvePromptMaxWidth = (windowWidth: number): number => {
  const availableWidth = Math.max(windowWidth - spacingTokens.sm * 2, 0);
  return Math.min(availableWidth, PROMPT_BUBBLE_MAX_WIDTH);
};

export function PromptInput(props: PromptInputProps) {
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const promptMaxWidth = resolvePromptMaxWidth(windowWidth);
  const bottomPadding = Math.max(insets.bottom, spacingTokens.sm) + spacingTokens.md;

  const state = usePromptInputState(props);

  return (
    <PromptInputView
      {...state}
      placeholder={props.placeholder ?? 'Ask TaskForce'}
      promptMaxWidth={promptMaxWidth}
      bottomPadding={bottomPadding}
      agentCount={props.agentCount}
      onAgentCountChange={props.onAgentCountChange}
      userPlan={props.userPlan}
      mcpToolSummary={props.mcpToolSummary}
      mcpToolItems={props.mcpToolItems}
    />
  );
}

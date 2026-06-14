import type { McpRuntimeToolDescriptor } from '@taskforceai/shared';

import { McpToolSummary } from './McpToolSummary';
import { ModeBadges, type ModeBadge } from './ModeBadges';

interface PromptFormHeaderProps {
  loginPromptText: string;
  mcpToolItems: McpRuntimeToolDescriptor[];
  mcpToolSummary: string | null;
  modeBadges: ModeBadge[];
  onInsertMcpTool: (serverName: string, toolName: string) => void;
  shouldShowLoginNote: boolean;
}

export function PromptFormHeader({
  loginPromptText,
  mcpToolItems,
  mcpToolSummary,
  modeBadges,
  onInsertMcpTool,
  shouldShowLoginNote,
}: PromptFormHeaderProps) {
  return (
    <>
      {shouldShowLoginNote ? (
        <p className="prompt-login-note" aria-live="polite">
          {loginPromptText}
        </p>
      ) : null}

      <ModeBadges badges={modeBadges} />
      <McpToolSummary
        summary={mcpToolSummary}
        items={mcpToolItems}
        onInsertTool={onInsertMcpTool}
      />
    </>
  );
}

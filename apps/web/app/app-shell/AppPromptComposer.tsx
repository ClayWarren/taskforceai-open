'use client';

import type { ModelSelectorResponse } from '@taskforceai/contracts/contracts';
import type {
  SessionLifecycleMessageSession,
  StartStreamingOptions,
} from '@taskforceai/react-core';
import clsx from 'clsx';
import React from 'react';

import PromptForm from '../components/chat/PromptForm';
import { Image } from '../components/shared/Image';
import type { Message } from '../lib/types';
import { usePromptFormBridge } from './usePromptFormBridge';

type PromptVariant = 'centered' | 'bottom';

type AppPromptComposerProps = {
  session: SessionLifecycleMessageSession<Message, StartStreamingOptions>;
  initialModelSelector?: ModelSelectorResponse | null;
  isDisabled: boolean;
  promptVariant: PromptVariant;
  promptValue: string;
  showPromptLogo: boolean;
  onPromptValueChange: React.Dispatch<React.SetStateAction<string>>;
  updateToRemoteConversation: (_conversationId: number) => void;
  variant: PromptVariant;
};

export const AppPromptComposer: React.FC<AppPromptComposerProps> = ({
  session,
  initialModelSelector = null,
  isDisabled,
  promptVariant,
  promptValue,
  showPromptLogo,
  onPromptValueChange,
  updateToRemoteConversation,
  variant,
}) => {
  const { mcpToolCatalog, promptFormProps } = usePromptFormBridge({
    session,
    initialModelSelector,
    isDisabled,
    updateToRemoteConversation,
    variant,
  });

  if (promptVariant !== variant) {
    return null;
  }

  return (
    <div
      className={clsx(
        'prompt-form-container',
        variant === 'bottom' && 'prompt-form-container--fixed',
        variant === 'centered' && 'centered-variant'
      )}
    >
      <div className="prompt-form-stack">
        {showPromptLogo ? (
          <div className="prompt-form-logo">
            <div className="relative h-[120px] w-[120px]">
              <Image
                src="/icon.png"
                alt="TaskForceAI logo"
                fill
                sizes="120px"
                loading="eager"
                className="object-contain"
                priority
              />
            </div>
          </div>
        ) : null}
        <PromptForm
          {...promptFormProps}
          mcpToolSummary={mcpToolCatalog.toolSummary}
          mcpToolItems={mcpToolCatalog.items}
          promptValue={promptValue}
          onPromptValueChange={onPromptValueChange}
        />
      </div>
    </div>
  );
};

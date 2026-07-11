'use client';

import type { ModelSelectorResponse } from '@taskforceai/contracts/contracts';
import type {
  SessionLifecycleMessageSession,
  StartStreamingOptions,
} from '@taskforceai/react-core';
import { PRIVATE_CHAT_DISCLOSURE } from '@taskforceai/react-core';
import clsx from 'clsx';
import { ShieldCheck } from 'lucide-react';
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
  isPrivateChat?: boolean;
  persistenceEnabled?: boolean;
  promptVariant: PromptVariant;
  promptValue: string;
  showPromptLogo: boolean;
  desktopRightInset?: string;
  onRealtimeVoiceActiveChange?: (_isActive: boolean) => void;
  onPromptValueChange: React.Dispatch<React.SetStateAction<string>>;
  updateToRemoteConversation: (_conversationId: number) => void;
  variant: PromptVariant;
};

export const AppPromptComposer: React.FC<AppPromptComposerProps> = ({
  session,
  initialModelSelector = null,
  isDisabled,
  isPrivateChat = false,
  persistenceEnabled = true,
  promptVariant,
  promptValue,
  showPromptLogo,
  desktopRightInset,
  onRealtimeVoiceActiveChange,
  onPromptValueChange,
  updateToRemoteConversation,
  variant,
}) => {
  const [isRealtimeVoiceActive, setIsRealtimeVoiceActive] = React.useState(false);
  const isRealtimeVoiceActiveRef = React.useRef(false);
  const handleRealtimeVoiceActiveChange = React.useCallback(
    (isActive: boolean) => {
      isRealtimeVoiceActiveRef.current = isActive;
      setIsRealtimeVoiceActive(isActive);
      onRealtimeVoiceActiveChange?.(isActive);
    },
    [onRealtimeVoiceActiveChange]
  );
  const { mcpToolCatalog, promptFormProps } = usePromptFormBridge({
    session,
    initialModelSelector,
    isDisabled,
    isPrivateChat,
    persistenceEnabled,
    updateToRemoteConversation,
    variant,
  });

  React.useEffect(
    () => () => {
      if (isRealtimeVoiceActiveRef.current) {
        onRealtimeVoiceActiveChange?.(false);
      }
    },
    [onRealtimeVoiceActiveChange]
  );

  if (promptVariant !== variant) {
    return null;
  }

  const effectiveVariant = isRealtimeVoiceActive ? 'bottom' : variant;
  const shouldShowLogo = showPromptLogo && !isRealtimeVoiceActive;
  const shouldInsetFixedComposer = effectiveVariant === 'bottom' && Boolean(desktopRightInset);

  return (
    <div
      className={clsx(
        'prompt-form-container',
        effectiveVariant === 'bottom' && 'prompt-form-container--fixed',
        shouldInsetFixedComposer && 'prompt-form-container--desktop-browser-inset',
        isRealtimeVoiceActive && 'prompt-form-container--voice-active',
        effectiveVariant === 'centered' && 'centered-variant'
      )}
    >
      <div className="prompt-form-stack">
        {shouldShowLogo ? (
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
        {isPrivateChat ? (
          <div className="private-chat-disclosure" role="status" aria-live="polite">
            <ShieldCheck aria-hidden="true" size={16} strokeWidth={2.2} />
            <span>{PRIVATE_CHAT_DISCLOSURE}</span>
          </div>
        ) : null}
        <PromptForm
          {...promptFormProps}
          mcpToolSummary={mcpToolCatalog.toolSummary}
          mcpToolItems={mcpToolCatalog.items}
          promptValue={promptValue}
          onPromptValueChange={onPromptValueChange}
          onRealtimeVoiceActiveChange={handleRealtimeVoiceActiveChange}
          variant={effectiveVariant}
        />
      </div>
    </div>
  );
};

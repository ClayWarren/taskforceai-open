import type { ModelOptionSummary } from '@taskforceai/contracts/contracts';
import type { PromptPrimaryActionMode } from '@taskforceai/presenters';
import { AudioLines, Check, Square, X } from 'lucide-react';
import React from 'react';

import { ModelSelectorControl } from '../../../lib/prompt/ModelSelectorControl';
import { VoiceIcon } from '../../../lib/prompt/prompt-icons';
import { ReasoningEffortControl } from './ReasoningEffortControl';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@taskforceai/ui-kit/tooltip';

interface PromptActionsProps {
  modelSelectorEnabled: boolean;
  modelOptions: ModelOptionSummary[];
  selectedModelId: string | null;
  selectedModelLabel: string | null;
  modelSelectorDisabled: boolean;
  modelSelectorLoading: boolean;
  modelSelectorTriggerRef?: React.Ref<HTMLButtonElement>;
  onModelSelect: (modelId: string) => void;
  userPlan?: string | null;
  reasoningEffortLevels?: string[];
  selectedReasoningEffort: string | null;
  reasoningEffortVariant: 'desktop' | 'select';
  onReasoningEffortChange: (effort: string) => void;
  onCustomizeOrchestration?: () => void;
  quickModeEnabled: boolean;
  onQuickModeToggle: () => void;
  agentCount: number;
  onAgentCountChange: (count: number) => void;
  onClearCustomModels?: () => void;
  roleModels?: Record<string, string>;
  isCompactForm: boolean;
  primaryButtonMode: PromptPrimaryActionMode;
  primaryButtonClassName: string;
  primaryButtonDisabled: boolean;
  primaryButtonTitle: string;
  dictationDisabled: boolean;
  onDictationClick: () => void;
  onPrimaryButtonClick: (event: React.MouseEvent) => void;
  onAcceptDictation: () => void;
  onCancelDictation: () => void;
  onRealtimeVoiceClick: () => void;
  onRealtimeVoicePrewarm: () => void;
  realtimeVoiceActive: boolean;
  realtimeVoiceDisabled: boolean;
  realtimeVoiceTitle: string;
  showRealtimeVoice?: boolean;
  loading: boolean;
  isListening: boolean;
}

const PROMPT_SHORTCUTS = {
  dictate: '^⇧D',
  model: '^⇧M',
  voice: '^⇧V',
} as const;

const formatShortcutTitle = (label: string, shortcut: string): string => `${label} ${shortcut}`;
const defaultValue = <T,>(value: T | undefined, fallback: T): T => value ?? fallback;
const both = (left: boolean, right: boolean): boolean => left && right;
const voiceTooltipLabel = (active: boolean): string => (active ? 'End Voice Chat' : 'Use Voice');

const PromptControlTooltip = ({ label, shortcut }: { label: string; shortcut: string }) => (
  <span className="prompt-control-tooltip__inner">
    <span>{label}</span>
    <span className="prompt-control-tooltip__shortcut">{shortcut}</span>
  </span>
);

export const PromptActions: React.FC<PromptActionsProps> = ({
  modelSelectorEnabled,
  modelOptions,
  selectedModelId,
  selectedModelLabel,
  modelSelectorDisabled,
  modelSelectorLoading,
  modelSelectorTriggerRef,
  onModelSelect,
  userPlan,
  reasoningEffortLevels: reasoningEffortLevelsValue,
  selectedReasoningEffort,
  reasoningEffortVariant,
  onReasoningEffortChange,
  onCustomizeOrchestration,
  quickModeEnabled,
  onQuickModeToggle,
  agentCount,
  onAgentCountChange,
  onClearCustomModels,
  roleModels,
  isCompactForm,
  primaryButtonMode,
  primaryButtonClassName,
  primaryButtonDisabled,
  primaryButtonTitle,
  dictationDisabled,
  onDictationClick,
  onPrimaryButtonClick,
  onAcceptDictation,
  onCancelDictation,
  onRealtimeVoiceClick,
  onRealtimeVoicePrewarm,
  realtimeVoiceActive,
  realtimeVoiceDisabled,
  realtimeVoiceTitle,
  showRealtimeVoice: showRealtimeVoiceValue,
  loading,
  isListening,
}) => {
  const reasoningEffortLevels = defaultValue(reasoningEffortLevelsValue, []);
  const showRealtimeVoice = defaultValue(showRealtimeVoiceValue, true);
  const dictationTooltipLabel = 'Dictate';
  const dictationTooltipTitle = formatShortcutTitle(
    dictationTooltipLabel,
    PROMPT_SHORTCUTS.dictate
  );
  const modelTooltipLabel = 'Select Model';
  const modelTooltipTitle = formatShortcutTitle(modelTooltipLabel, PROMPT_SHORTCUTS.model);
  const realtimeVoiceTooltipLabel = voiceTooltipLabel(realtimeVoiceActive);
  const realtimeVoiceTooltipTitle = formatShortcutTitle(
    realtimeVoiceTooltipLabel,
    PROMPT_SHORTCUTS.voice
  );
  const dictationButtonClassName =
    'icon-circle prompt-bare-icon-button flex h-10 w-10 items-center justify-center rounded-full p-2 text-white transition-colors disabled:cursor-not-allowed disabled:opacity-60';
  const renderPrimaryActionInRealtimeSlot = both(showRealtimeVoice, primaryButtonMode !== 'voice');
  const handleRealtimeVoicePrewarm = () => {
    if (realtimeVoiceActive || realtimeVoiceDisabled) {
      return;
    }
    onRealtimeVoicePrewarm();
  };
  const renderPrimaryActionButton = () => (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type={primaryButtonMode === 'send' ? 'submit' : 'button'}
          className={`${primaryButtonClassName} ${
            primaryButtonMode === 'voice' ? 'prompt-bare-icon-button' : ''
          }`}
          onClick={onPrimaryButtonClick}
          disabled={primaryButtonDisabled}
          aria-disabled={primaryButtonDisabled}
          title={primaryButtonMode === 'voice' ? dictationTooltipTitle : primaryButtonTitle}
        >
          {primaryButtonMode === 'stop' ? (
            <Square aria-hidden="true" size={18} fill="currentColor" strokeWidth={2.25} />
          ) : primaryButtonMode === 'send' ? (
            loading ? (
              <svg
                className="animate-spin"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="white"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="M12,2a10,10,0,0,1,10,10" />
              </svg>
            ) : (
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="white"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M5 12h14" />
                <path d="m12 5 7 7-7 7" />
              </svg>
            )
          ) : (
            <VoiceIcon />
          )}
        </button>
      </TooltipTrigger>
      {primaryButtonMode === 'voice' ? (
        <TooltipContent side="top" className="prompt-control-tooltip">
          <PromptControlTooltip label={dictationTooltipLabel} shortcut={PROMPT_SHORTCUTS.dictate} />
        </TooltipContent>
      ) : null}
    </Tooltip>
  );
  const renderDictationButton = () => (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={dictationButtonClassName}
          onClick={onDictationClick}
          disabled={dictationDisabled}
          aria-disabled={dictationDisabled}
          title={dictationTooltipTitle}
        >
          <VoiceIcon />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="prompt-control-tooltip">
        <PromptControlTooltip label={dictationTooltipLabel} shortcut={PROMPT_SHORTCUTS.dictate} />
      </TooltipContent>
    </Tooltip>
  );
  const renderRealtimeVoiceButton = () => (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={`icon-circle flex h-10 w-10 items-center justify-center rounded-full p-2 text-white transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
            realtimeVoiceActive ? 'is-realtime-voice' : ''
          }`}
          onClick={onRealtimeVoiceClick}
          onFocus={handleRealtimeVoicePrewarm}
          onPointerEnter={handleRealtimeVoicePrewarm}
          onTouchStart={handleRealtimeVoicePrewarm}
          disabled={realtimeVoiceDisabled}
          aria-pressed={realtimeVoiceActive}
          aria-disabled={realtimeVoiceDisabled}
          aria-label={realtimeVoiceTitle}
          title={realtimeVoiceTooltipTitle}
        >
          {realtimeVoiceActive ? (
            <X aria-hidden="true" size={20} strokeWidth={2.25} />
          ) : (
            <AudioLines aria-hidden="true" size={20} strokeWidth={2.25} />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="prompt-control-tooltip">
        <PromptControlTooltip label={realtimeVoiceTooltipLabel} shortcut={PROMPT_SHORTCUTS.voice} />
      </TooltipContent>
    </Tooltip>
  );

  return (
    <TooltipProvider delayDuration={150}>
      <div className="prompt-controls relative z-10 flex items-center gap-1">
        <ModelSelectorControl
          enabled={modelSelectorEnabled}
          options={modelOptions}
          selectedModelId={selectedModelId}
          selectedModelLabel={selectedModelLabel}
          disabled={modelSelectorDisabled}
          loading={modelSelectorLoading}
          onSelect={onModelSelect}
          userPlan={userPlan}
          compact={isCompactForm}
          triggerRef={modelSelectorTriggerRef}
          title={modelTooltipTitle}
          bare
          reasoningEffortLevels={reasoningEffortVariant === 'select' ? reasoningEffortLevels : []}
          selectedReasoningEffort={selectedReasoningEffort}
          onReasoningEffortChange={onReasoningEffortChange}
          quickModeEnabled={quickModeEnabled}
          onQuickModeToggle={onQuickModeToggle}
          agentCount={agentCount}
          onAgentCountChange={onAgentCountChange}
          onCustomizeOrchestration={onCustomizeOrchestration}
          roleModels={roleModels}
          onClearCustomModels={onClearCustomModels}
          tooltip={
            <PromptControlTooltip label={modelTooltipLabel} shortcut={PROMPT_SHORTCUTS.model} />
          }
        />

        {reasoningEffortVariant === 'desktop' ? (
          <ReasoningEffortControl
            disabled={modelSelectorDisabled}
            levels={reasoningEffortLevels}
            selectedEffort={selectedReasoningEffort}
            onChange={onReasoningEffortChange}
          />
        ) : null}

        {isListening ? (
          <>
            <button
              type="button"
              className={`${primaryButtonClassName} text-white`}
              onClick={onCancelDictation}
              aria-label="Cancel Dictation"
              title="Cancel Dictation"
            >
              <X aria-hidden="true" size={19} strokeWidth={2.25} />
            </button>
            <button
              type="button"
              className={`${primaryButtonClassName} primary-send-button text-white`}
              onClick={onAcceptDictation}
              aria-label="Accept Dictation"
              title="Accept Dictation"
            >
              <Check aria-hidden="true" size={20} strokeWidth={2.25} />
            </button>
          </>
        ) : (
          <>
            {renderPrimaryActionInRealtimeSlot
              ? renderDictationButton()
              : renderPrimaryActionButton()}
            {renderPrimaryActionInRealtimeSlot
              ? renderPrimaryActionButton()
              : showRealtimeVoice
                ? renderRealtimeVoiceButton()
                : null}
          </>
        )}
      </div>
    </TooltipProvider>
  );
};

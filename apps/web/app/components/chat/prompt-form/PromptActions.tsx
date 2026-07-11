import type { ModelOptionSummary } from '@taskforceai/contracts/contracts';
import {
  PROMPT_MODE_DEFINITIONS,
  PROMPT_OPTION_LABELS,
  type PromptPrimaryActionMode,
} from '@taskforceai/presenters';
import { AudioLines, Check, Square, X } from 'lucide-react';
import React from 'react';

import { ModelSelectorControl } from '../../../lib/prompt/ModelSelectorControl';
import { VoiceIcon, PulseIcon, EllipsisIcon } from '../../../lib/prompt/prompt-icons';
import { ReasoningEffortControl } from './ReasoningEffortControl';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@taskforceai/ui-kit/dropdown-menu';
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
  reasoningEffortLevels?: string[];
  selectedReasoningEffort: string | null;
  reasoningEffortVariant: 'desktop' | 'select';
  onReasoningEffortChange: (effort: string) => void;
  onCustomizeOrchestration?: () => void;
  isComputerUseAllowed?: boolean;
  computerUseEnabled: boolean;
  onComputerUseToggle: () => void;
  useLoggedInServices: boolean;
  onUseLoggedInServicesToggle: () => void;
  lockedComputerUseEnabled?: boolean;
  lockedComputerUseAvailable?: boolean;
  lockedComputerUseLabel?: string;
  onLockedComputerUseToggle?: () => void;
  quickModeEnabled: boolean;
  onQuickModeToggle: () => void;
  isAutonomyAllowed?: boolean;
  autonomyEnabled: boolean;
  onAutonomyToggle: () => void;
  onOpenAutonomousPanel?: () => void;
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
const hasEntries = (value: Record<string, string> | undefined): boolean =>
  Object.keys(value ?? {}).length > 0;
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
  reasoningEffortLevels: reasoningEffortLevelsValue,
  selectedReasoningEffort,
  reasoningEffortVariant,
  onReasoningEffortChange,
  onCustomizeOrchestration,
  isComputerUseAllowed: isComputerUseAllowedValue,
  computerUseEnabled,
  onComputerUseToggle,
  useLoggedInServices,
  onUseLoggedInServicesToggle,
  lockedComputerUseEnabled: lockedComputerUseEnabledValue,
  lockedComputerUseAvailable: lockedComputerUseAvailableValue,
  lockedComputerUseLabel: lockedComputerUseLabelValue,
  onLockedComputerUseToggle,
  quickModeEnabled,
  onQuickModeToggle,
  isAutonomyAllowed: isAutonomyAllowedValue,
  autonomyEnabled,
  onAutonomyToggle,
  onOpenAutonomousPanel,
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
  const isComputerUseAllowed = defaultValue(isComputerUseAllowedValue, true);
  const lockedComputerUseEnabled = defaultValue(lockedComputerUseEnabledValue, false);
  const lockedComputerUseAvailable = defaultValue(lockedComputerUseAvailableValue, false);
  const lockedComputerUseLabel = defaultValue(lockedComputerUseLabelValue, 'This Mac');
  const isAutonomyAllowed = defaultValue(isAutonomyAllowedValue, true);
  const showRealtimeVoice = defaultValue(showRealtimeVoiceValue, true);
  const hasCustomModels = hasEntries(roleModels);
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
  const scheduleMenuAction = (action: () => void) => {
    // Wait for dropdown selection teardown before opening dialogs.
    globalThis.setTimeout(action, 0);
  };
  const handleRealtimeVoicePrewarm = () => {
    if (realtimeVoiceActive || realtimeVoiceDisabled) {
      return;
    }
    onRealtimeVoicePrewarm();
  };
  const selectDirectChat = () => {
    if (!quickModeEnabled) {
      onQuickModeToggle();
    }
  };
  const selectAgentTeams = () => {
    if (quickModeEnabled) {
      onQuickModeToggle();
    }
  };
  const openAgentTeamConfig = () => {
    selectAgentTeams();
    if (onCustomizeOrchestration) {
      scheduleMenuAction(onCustomizeOrchestration);
    }
  };
  const openAutonomousConfig = () => {
    if (!autonomyEnabled) {
      onAutonomyToggle();
    }
    if (onOpenAutonomousPanel) {
      scheduleMenuAction(onOpenAutonomousPanel);
    }
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
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={`icon-circle flex h-10 w-10 items-center justify-center rounded-full p-2 text-white transition-colors hover:bg-white/10`}
              disabled={modelSelectorDisabled}
              title="Mode Options"
            >
              <EllipsisIcon />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            sideOffset={8}
            className="min-w-[180px] rounded-lg border-[#333] bg-[#1a1a1a] text-white"
          >
            <DropdownMenuItem
              onSelect={() => {
                selectDirectChat();
              }}
              className="cursor-pointer focus:bg-white/10 focus:text-white"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm">⚡</span>
                <span>{PROMPT_OPTION_LABELS.quickModeDirect}</span>
                {quickModeEnabled ? (
                  <span className="ml-auto text-xs text-blue-200">Active</span>
                ) : null}
              </div>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                selectAgentTeams();
              }}
              className="cursor-pointer focus:bg-white/10 focus:text-white"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm">👥</span>
                <span>{PROMPT_OPTION_LABELS.agentTeams}</span>
                {!quickModeEnabled ? (
                  <span className="ml-auto text-xs text-blue-200">Active</span>
                ) : null}
              </div>
            </DropdownMenuItem>
            {isComputerUseAllowed && (
              <>
                <DropdownMenuCheckboxItem
                  checked={computerUseEnabled}
                  onCheckedChange={onComputerUseToggle}
                  className="cursor-pointer focus:bg-white/10 focus:text-white"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm">💻</span>
                    <span>{PROMPT_MODE_DEFINITIONS.computerUse.label}</span>
                  </div>
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={useLoggedInServices}
                  onCheckedChange={onUseLoggedInServicesToggle}
                  disabled={!computerUseEnabled}
                  className="cursor-pointer focus:bg-white/10 focus:text-white"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm">🔐</span>
                    <span>{PROMPT_OPTION_LABELS.useLoggedInServices}</span>
                  </div>
                </DropdownMenuCheckboxItem>
                {lockedComputerUseAvailable && (
                  <DropdownMenuCheckboxItem
                    checked={lockedComputerUseEnabled}
                    onCheckedChange={onLockedComputerUseToggle}
                    disabled={!computerUseEnabled || !onLockedComputerUseToggle}
                    className="cursor-pointer focus:bg-white/10 focus:text-white"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm">🔒</span>
                      <span>{lockedComputerUseLabel}</span>
                      {lockedComputerUseEnabled ? (
                        <span className="ml-auto text-xs text-blue-200">Local</span>
                      ) : null}
                    </div>
                  </DropdownMenuCheckboxItem>
                )}
              </>
            )}
            {isAutonomyAllowed && (
              <DropdownMenuCheckboxItem
                checked={autonomyEnabled}
                onCheckedChange={(checked) => {
                  if (checked) {
                    openAutonomousConfig();
                    return;
                  }
                  onAutonomyToggle();
                }}
                className="cursor-pointer focus:bg-white/10 focus:text-white"
              >
                <div className="flex items-center gap-2">
                  <PulseIcon />
                  <span>{PROMPT_OPTION_LABELS.autonomousMode}</span>
                </div>
              </DropdownMenuCheckboxItem>
            )}
            {isAutonomyAllowed && onOpenAutonomousPanel && (
              <DropdownMenuItem
                onSelect={() => {
                  openAutonomousConfig();
                }}
                className="cursor-pointer pl-8 text-xs text-white/50 focus:bg-white/10 focus:text-white/80"
              >
                Configure autonomous…
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator className="bg-white/10" />
            {onCustomizeOrchestration && (
              <DropdownMenuItem
                onSelect={() => {
                  openAgentTeamConfig();
                }}
                className="cursor-pointer focus:bg-white/10 focus:text-white"
              >
                <div className="flex items-center gap-2">
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M4 9 L12 9 L12 15 L20 15" />
                    <circle cx="4" cy="9" r="2" />
                    <circle cx="20" cy="15" r="2" />
                  </svg>
                  <span>{PROMPT_OPTION_LABELS.agentTeamConfigMenu}</span>
                  {hasCustomModels ? (
                    <span className="ml-auto text-xs text-blue-200">Configured</span>
                  ) : null}
                </div>
              </DropdownMenuItem>
            )}
            {hasCustomModels && onClearCustomModels && (
              <DropdownMenuItem
                onSelect={() => {
                  onClearCustomModels();
                }}
                className="cursor-pointer pl-8 text-xs text-white/50 focus:bg-white/10 focus:text-white/80"
              >
                Clear agent models
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <ModelSelectorControl
          enabled={modelSelectorEnabled}
          options={modelOptions}
          selectedModelId={selectedModelId}
          selectedModelLabel={selectedModelLabel}
          disabled={modelSelectorDisabled}
          loading={modelSelectorLoading}
          onSelect={onModelSelect}
          compact={isCompactForm}
          triggerRef={modelSelectorTriggerRef}
          title={modelTooltipTitle}
          bare
          reasoningEffortLevels={reasoningEffortVariant === 'select' ? reasoningEffortLevels : []}
          selectedReasoningEffort={selectedReasoningEffort}
          onReasoningEffortChange={onReasoningEffortChange}
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

import type { ModelOptionSummary } from '@taskforceai/contracts/contracts';
import {
  PROMPT_MODE_DEFINITIONS,
  PROMPT_OPTION_LABELS,
  type PromptPrimaryActionMode,
} from '@taskforceai/shared';
import { Square } from 'lucide-react';
import React from 'react';

import { ModelSelectorControl } from '../../../lib/prompt/ModelSelectorControl';
import { VoiceIcon, PulseIcon, EllipsisIcon } from '../../../lib/prompt/prompt-icons';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@taskforceai/ui-kit';

interface PromptActionsProps {
  modelSelectorEnabled: boolean;
  modelOptions: ModelOptionSummary[];
  selectedModelId: string | null;
  selectedModelLabel: string | null;
  modelSelectorDisabled: boolean;
  modelSelectorLoading: boolean;
  onModelSelect: (modelId: string) => void;
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
  onPrimaryButtonClick: (event: React.MouseEvent) => void;
  loading: boolean;
  isListening: boolean;
}

export const PromptActions: React.FC<PromptActionsProps> = ({
  modelSelectorEnabled,
  modelOptions,
  selectedModelId,
  selectedModelLabel,
  modelSelectorDisabled,
  modelSelectorLoading,
  onModelSelect,
  onCustomizeOrchestration,
  isComputerUseAllowed = true,
  computerUseEnabled,
  onComputerUseToggle,
  useLoggedInServices,
  onUseLoggedInServicesToggle,
  lockedComputerUseEnabled = false,
  lockedComputerUseAvailable = false,
  lockedComputerUseLabel = 'This Mac',
  onLockedComputerUseToggle,
  quickModeEnabled,
  onQuickModeToggle,
  isAutonomyAllowed = true,
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
  onPrimaryButtonClick,
  loading,
  isListening,
}) => {
  const hasCustomModels = Object.keys(roleModels ?? {}).length > 0;
  const scheduleMenuAction = (action: () => void) => {
    // Wait for dropdown selection teardown before opening dialogs.
    globalThis.setTimeout(action, 0);
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

  return (
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
      />

      <button
        type={primaryButtonMode === 'send' ? 'submit' : 'button'}
        className={primaryButtonClassName}
        onClick={onPrimaryButtonClick}
        disabled={primaryButtonDisabled}
        aria-pressed={primaryButtonMode === 'voice' ? isListening : undefined}
        aria-disabled={primaryButtonDisabled}
        title={primaryButtonTitle}
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
        ) : isListening ? (
          '■'
        ) : (
          <VoiceIcon />
        )}
      </button>
    </div>
  );
};

import type { ModelOptionSummary } from '@taskforceai/contracts/contracts';
import type { PromptPrimaryActionMode } from '@taskforceai/presenters';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { restoreCapturedPromptDraftSelection } from '../../../../lib/prompt/hydration-draft-capture';
import {
  applySlashCommandSuggestion,
  slashCommandSuggestionsForPrompt,
} from '../../../../lib/prompt/slash-commands';
import { AutoResizingTextarea } from './AutoResizingTextarea';
import { PromptAddMenu } from './PromptAddMenu';
import { PromptActions } from './PromptActions';
import { PromptAttachments } from './PromptAttachments';
import { LARGE_PASTE_CHARACTER_THRESHOLD } from './largePasteAttachment';
import type { PromptTemplate } from './promptTemplates';

interface PromptComposerFormProps {
  controlsDisabled: boolean;
  customRoleModels: Record<string, string>;
  effectiveModelId: string | null;
  effectiveModelLabel: string | null;
  fileAccept: string;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  files: File[];
  handleFileChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  handleFileDragLeave: (event: React.DragEvent<HTMLElement>) => void;
  handleFileDragOver: (event: React.DragEvent<HTMLElement>) => void;
  handleFileDrop: (event: React.DragEvent<HTMLElement>) => void;
  iconButtonBaseClass: string;
  isDraggingFiles: boolean;
  isCompactForm: boolean;
  isListening: boolean;
  loading: boolean;
  minPromptHeight: number;
  modelOptions: ModelOptionSummary[];
  modelSelectorDisabled: boolean;
  modelSelectorEnabled: boolean;
  modelSelectorLoading: boolean;
  modelSelectorTriggerRef?: React.Ref<HTMLButtonElement>;
  onClearCustomModels: () => void;
  onCustomizeOrchestration: () => void;
  onFileButtonClick: () => void;
  onKeyDown: (event: React.KeyboardEvent) => void;
  onModelSelect: (modelId: string) => void;
  reasoningEffortLevels: string[];
  selectedReasoningEffort: string | null;
  reasoningEffortVariant: 'desktop' | 'select';
  onReasoningEffortChange: (effort: string) => void;
  onDictationClick: () => void;
  onAcceptDictation: () => void;
  onCancelDictation: () => void;
  onPrimaryButtonClick: (event: React.MouseEvent) => void;
  onRealtimeVoiceClick: () => void;
  onRealtimeVoicePrewarm: () => void;
  onInsertPromptTemplate: (template: PromptTemplate) => void;
  onQuickModeToggle: () => void;
  onRemoveFileAtIndex: (index: number) => void;
  onShowAttachmentInTextField: (index: number) => void;
  onLargePaste: (content: string) => boolean;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  placeholderText: string;
  primaryButtonClassName: string;
  primaryButtonDisabled: boolean;
  primaryButtonMode: PromptPrimaryActionMode;
  primaryButtonTitle: string;
  prompt: string;
  promptTemplates: PromptTemplate[];
  quickModeEnabled: boolean;
  agentCount: number;
  onAgentCountChange: (count: number) => void;
  showRealtimeVoice?: boolean;
  realtimeVoiceActive: boolean;
  realtimeVoiceDisabled: boolean;
  realtimeVoiceTitle: string;
  setPrompt: (value: string) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  userPlan?: string | null;
  variant: 'centered' | 'bottom';
  workMode: boolean;
  showContextWindow?: boolean;
}

export function PromptComposerForm({
  controlsDisabled,
  customRoleModels,
  effectiveModelId,
  effectiveModelLabel,
  fileAccept,
  fileInputRef,
  files,
  handleFileChange,
  handleFileDragLeave,
  handleFileDragOver,
  handleFileDrop,
  iconButtonBaseClass,
  isDraggingFiles,
  isCompactForm,
  isListening,
  loading,
  minPromptHeight,
  modelOptions,
  modelSelectorDisabled,
  modelSelectorEnabled,
  modelSelectorLoading,
  modelSelectorTriggerRef,
  onClearCustomModels,
  onCustomizeOrchestration,
  onFileButtonClick,
  onKeyDown,
  onModelSelect,
  reasoningEffortLevels,
  selectedReasoningEffort,
  reasoningEffortVariant,
  onReasoningEffortChange,
  onDictationClick,
  onAcceptDictation,
  onCancelDictation,
  onPrimaryButtonClick,
  onRealtimeVoiceClick,
  onRealtimeVoicePrewarm,
  onInsertPromptTemplate,
  onQuickModeToggle,
  onRemoveFileAtIndex,
  onShowAttachmentInTextField,
  onLargePaste,
  onSubmit,
  placeholderText,
  primaryButtonClassName,
  primaryButtonDisabled,
  primaryButtonMode,
  primaryButtonTitle,
  prompt,
  promptTemplates,
  quickModeEnabled,
  agentCount,
  onAgentCountChange,
  showRealtimeVoice = true,
  realtimeVoiceActive,
  realtimeVoiceDisabled,
  realtimeVoiceTitle,
  setPrompt,
  textareaRef,
  userPlan,
  variant,
  workMode,
  showContextWindow = false,
}: PromptComposerFormProps) {
  const slashSuggestions = useMemo(() => slashCommandSuggestionsForPrompt(prompt), [prompt]);
  const [selectedSlashSuggestion, setSelectedSlashSuggestion] = useState(0);
  const shouldShowSlashSuggestions = slashSuggestions.length > 0 && !controlsDisabled;

  useEffect(() => {
    setSelectedSlashSuggestion((current) =>
      slashSuggestions.length === 0 ? 0 : Math.min(current, slashSuggestions.length - 1)
    );
  }, [slashSuggestions.length]);

  const acceptSelectedSlashSuggestion = () => {
    const suggestion = slashSuggestions[selectedSlashSuggestion];
    if (!suggestion) {
      return false;
    }
    setPrompt(applySlashCommandSuggestion(prompt, suggestion));
    return true;
  };

  const selectedSuggestion = slashSuggestions[selectedSlashSuggestion];
  const firstPromptToken = prompt.trimStart().split(/\s+/, 1)[0] ?? '';
  const isExpandedPrompt =
    workMode || files.length > 0 || prompt.includes('\n') || prompt.length > 140;
  const selectedSuggestionIsExact = Boolean(
    selectedSuggestion && firstPromptToken === selectedSuggestion.command
  );
  const latestPromptRef = useRef(prompt);
  latestPromptRef.current = prompt;

  const setTextareaElement = useCallback(
    (node: HTMLTextAreaElement | null) => {
      (textareaRef as { current: HTMLTextAreaElement | null }).current = node;
      if (node) {
        restoreCapturedPromptDraftSelection(node, latestPromptRef.current);
      }
    },
    [textareaRef]
  );

  useLayoutEffect(() => {
    restoreCapturedPromptDraftSelection(textareaRef.current, prompt);
  }, [prompt, textareaRef]);

  const handleTextareaKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!shouldShowSlashSuggestions) {
      onKeyDown(event);
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelectedSlashSuggestion((current) => (current + 1) % slashSuggestions.length);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelectedSlashSuggestion(
        (current) => (current - 1 + slashSuggestions.length) % slashSuggestions.length
      );
      return;
    }

    if (event.key === 'Enter' && !event.shiftKey && selectedSuggestionIsExact) {
      onKeyDown(event);
      return;
    }

    if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) {
      event.preventDefault();
      acceptSelectedSlashSuggestion();
      return;
    }

    onKeyDown(event);
  };

  const handleTextareaPaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const pastedText = event.clipboardData.getData('text/plain');
    if (pastedText.length > LARGE_PASTE_CHARACTER_THRESHOLD && onLargePaste(pastedText)) {
      event.preventDefault();
    }
  };

  return (
    <form
      id="prompt-form"
      onSubmit={onSubmit}
      onDragOver={handleFileDragOver}
      onDragLeave={handleFileDragLeave}
      onDrop={handleFileDrop}
      className={`prompt-form relative ${variant === 'bottom' ? 'chat-aligned chat-edge-left' : ''} ${isExpandedPrompt ? 'prompt-form--expanded !items-stretch !rounded-[24px]' : ''} ${files.length > 0 ? '!flex-col !gap-1' : ''} ${isDraggingFiles ? 'ring-2 ring-blue-400/80' : ''}`}
      aria-label="Prompt submission form"
    >
      {isDraggingFiles && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-[inherit] border border-blue-300/60 bg-slate-950/85 text-sm font-semibold text-blue-100 backdrop-blur-sm">
          Drop files to attach
        </div>
      )}

      <input
        ref={fileInputRef}
        id="file-upload"
        type="file"
        multiple
        accept={fileAccept}
        className="hidden"
        onChange={handleFileChange}
      />

      <PromptAttachments
        files={files}
        onRemove={onRemoveFileAtIndex}
        onShowInTextField={onShowAttachmentInTextField}
      />

      {shouldShowSlashSuggestions ? (
        <div
          className="absolute right-3 bottom-[calc(100%+0.5rem)] left-3 z-30 max-h-72 overflow-y-auto rounded-xl border border-white/10 bg-slate-950/95 p-2 text-left shadow-[0_18px_50px_rgba(2,6,23,0.55)] backdrop-blur-xl"
          role="listbox"
          aria-label="Slash commands"
        >
          <div className="flex items-center justify-between px-2 py-1 text-[11px] font-semibold tracking-[0.14em] text-slate-400 uppercase">
            <span>Slash commands</span>
            <span className="tracking-normal normal-case">Up/Down select</span>
          </div>
          <div className="mt-1 space-y-1">
            {slashSuggestions.map((suggestion, index) => {
              const selected = selectedSlashSuggestion === index;
              return (
                <button
                  key={suggestion.command}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={`flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left transition ${
                    selected
                      ? 'bg-blue-400/18 text-white ring-1 ring-blue-300/35'
                      : 'text-slate-200 hover:bg-white/7'
                  }`}
                  onMouseEnter={() => setSelectedSlashSuggestion(index)}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    setPrompt(applySlashCommandSuggestion(prompt, suggestion));
                    textareaRef.current?.focus();
                  }}
                >
                  <span className="min-w-28 font-mono text-sm text-blue-100">
                    {suggestion.command}
                  </span>
                  <span className="min-w-0 flex-1 text-xs leading-5 text-slate-400">
                    {suggestion.description}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className={`flex w-full gap-2 ${isExpandedPrompt ? 'items-end' : 'items-center'}`}>
        <div
          className={`prompt-input-group flex flex-1 gap-2 ${isExpandedPrompt ? 'items-end' : 'items-center'}`}
        >
          <PromptAddMenu
            buttonClassName={iconButtonBaseClass}
            disabled={controlsDisabled}
            onFileButtonClick={onFileButtonClick}
            onInsertPromptTemplate={onInsertPromptTemplate}
            promptTemplates={promptTemplates}
          />
          <AutoResizingTextarea
            ref={setTextareaElement}
            id="prompt"
            value={prompt}
            onValueChange={setPrompt}
            onKeyDown={handleTextareaKeyDown}
            onPaste={handleTextareaPaste}
            placeholder={placeholderText}
            disabled={controlsDisabled}
            aria-disabled={controlsDisabled}
            inputMode="text"
            autoCapitalize="sentences"
            autoComplete="off"
            autoCorrect="on"
            minHeight={minPromptHeight}
            className="min-w-0 flex-1 resize-none overflow-hidden bg-transparent text-base break-words whitespace-pre-wrap text-white placeholder-white/60 focus:outline-none"
          />
        </div>

        <PromptActions
          modelSelectorEnabled={modelSelectorEnabled}
          modelOptions={modelOptions}
          selectedModelId={effectiveModelId}
          selectedModelLabel={effectiveModelLabel}
          modelSelectorDisabled={modelSelectorDisabled}
          modelSelectorLoading={modelSelectorLoading}
          modelSelectorTriggerRef={modelSelectorTriggerRef}
          onModelSelect={onModelSelect}
          userPlan={userPlan}
          reasoningEffortLevels={reasoningEffortLevels}
          selectedReasoningEffort={selectedReasoningEffort}
          reasoningEffortVariant={reasoningEffortVariant}
          onReasoningEffortChange={onReasoningEffortChange}
          onCustomizeOrchestration={onCustomizeOrchestration}
          quickModeEnabled={quickModeEnabled}
          onQuickModeToggle={onQuickModeToggle}
          agentCount={agentCount}
          onAgentCountChange={onAgentCountChange}
          onClearCustomModels={onClearCustomModels}
          roleModels={customRoleModels}
          isCompactForm={isCompactForm}
          primaryButtonMode={primaryButtonMode}
          primaryButtonClassName={primaryButtonClassName}
          primaryButtonDisabled={primaryButtonDisabled}
          primaryButtonTitle={primaryButtonTitle}
          dictationDisabled={controlsDisabled || primaryButtonMode === 'stop'}
          onDictationClick={onDictationClick}
          onPrimaryButtonClick={onPrimaryButtonClick}
          onAcceptDictation={onAcceptDictation}
          onCancelDictation={onCancelDictation}
          onRealtimeVoiceClick={onRealtimeVoiceClick}
          onRealtimeVoicePrewarm={onRealtimeVoicePrewarm}
          realtimeVoiceActive={realtimeVoiceActive}
          realtimeVoiceDisabled={realtimeVoiceDisabled}
          realtimeVoiceTitle={realtimeVoiceTitle}
          showRealtimeVoice={showRealtimeVoice}
          loading={loading}
          isListening={isListening}
          showContextWindow={showContextWindow}
        />
      </div>
    </form>
  );
}

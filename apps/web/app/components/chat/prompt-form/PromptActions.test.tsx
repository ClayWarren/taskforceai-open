import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, describe, it, expect, mock } from 'bun:test';
import type { ReactNode } from 'react';

import '../../../../../../tests/setup/dom';

// Mocks
void mock.module('../../../lib/prompt/ModelSelectorControl', () => ({
  ModelSelectorControl: ({
    title,
    reasoningEffortLevels = [],
    selectedReasoningEffort,
    onReasoningEffortChange,
  }: {
    title?: string;
    reasoningEffortLevels?: string[];
    selectedReasoningEffort?: string | null;
    onReasoningEffortChange?: (effort: string) => void;
  }) => (
    <button
      type="button"
      data-testid="model-selector"
      data-reasoning-levels={reasoningEffortLevels.join(',')}
      data-selected-reasoning-effort={selectedReasoningEffort ?? ''}
      title={title}
      onClick={() => onReasoningEffortChange?.(reasoningEffortLevels[0] ?? '')}
    >
      Model selector
    </button>
  ),
}));

void mock.module('../../../lib/prompt/prompt-icons', () => ({
  VoiceIcon: () => <div data-testid="voice-icon" />,
  EllipsisIcon: () => <div data-testid="ellipsis-icon" />,
  PulseIcon: () => <div data-testid="pulse-icon" />,
}));

void mock.module('@taskforceai/ui-kit/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    onSelect,
  }: {
    children: ReactNode;
    onSelect?: (e: any) => void;
  }) => (
    <button type="button" onClick={() => onSelect?.({ preventDefault: () => {} })}>
      {children}
    </button>
  ),
  DropdownMenuCheckboxItem: ({
    children,
    checked,
    onCheckedChange,
    disabled,
  }: {
    children: ReactNode;
    checked?: boolean;
    onCheckedChange?: (checked: boolean) => void;
    disabled?: boolean;
  }) => (
    <button
      type="button"
      aria-pressed={checked}
      disabled={disabled}
      onClick={() => {
        onCheckedChange?.(!checked);
      }}
    >
      {children}
    </button>
  ),
  DropdownMenuSeparator: () => <hr />,
}));

const { PromptActions } = await import('./PromptActions');

describe('PromptActions', () => {
  afterEach(() => {
    cleanup();
  });

  const defaultProps = {
    modelSelectorEnabled: true,
    modelOptions: [],
    selectedModelId: 'gpt-4',
    selectedModelLabel: 'GPT-4',
    modelSelectorDisabled: false,
    modelSelectorLoading: false,
    onModelSelect: mock(),
    reasoningEffortLevels: [] as string[],
    selectedReasoningEffort: null,
    reasoningEffortVariant: 'select' as const,
    onReasoningEffortChange: mock(),
    onCustomizeOrchestration: mock(),
    computerUseEnabled: false,
    onComputerUseToggle: mock(),
    useLoggedInServices: false,
    onUseLoggedInServicesToggle: mock(),
    lockedComputerUseEnabled: false,
    lockedComputerUseAvailable: false,
    lockedComputerUseLabel: 'Locked Computer Use',
    onLockedComputerUseToggle: mock(),
    quickModeEnabled: false,
    onQuickModeToggle: mock(),
    autonomyEnabled: false,
    onAutonomyToggle: mock(),
    imageGenerationEnabled: false,
    onImageGenerationToggle: mock(),
    isCompactForm: false,
    primaryButtonMode: 'send' as const,
    primaryButtonClassName: 'btn-primary',
    primaryButtonDisabled: false,
    primaryButtonTitle: 'Send message',
    dictationDisabled: false,
    onDictationClick: mock(),
    onPrimaryButtonClick: mock(),
    onAcceptDictation: mock(),
    onCancelDictation: mock(),
    onRealtimeVoiceClick: mock(),
    onRealtimeVoicePrewarm: mock(),
    realtimeVoiceActive: false,
    realtimeVoiceDisabled: false,
    realtimeVoiceTitle: 'Use voice',
    loading: false,
    isListening: false,
  };

  it('renders correctly in send mode', () => {
    render(<PromptActions {...defaultProps} />);

    expect(screen.getByTestId('model-selector')).toBeTruthy();
    expect(screen.getByTitle('Select Model ^⇧M')).toBeTruthy();
    expect(screen.getByTitle('Dictate ^⇧D')).toBeTruthy();
    expect(screen.getByTitle('Send message')).toBeTruthy();
    expect(screen.queryByTitle('Use Voice ^⇧V')).toBeNull();
    expect(screen.getByTitle('Dictate ^⇧D').getAttribute('type')).toBe('button');
    expect(screen.getByTitle('Send message').getAttribute('type')).toBe('submit');
  });

  it('moves browser reasoning effort into the model selector', () => {
    const onReasoningEffortChange = mock();
    const { container } = render(
      <PromptActions
        {...defaultProps}
        reasoningEffortLevels={['low', 'medium', 'high']}
        selectedReasoningEffort="high"
        onReasoningEffortChange={onReasoningEffortChange}
      />
    );

    const modelSelector = screen.getByTestId('model-selector');
    expect(modelSelector.getAttribute('data-reasoning-levels')).toBe('low,medium,high');
    expect(modelSelector.getAttribute('data-selected-reasoning-effort')).toBe('high');
    expect(container.querySelector('.reasoning-effort-select')).toBeNull();
    expect(container.querySelector('.reasoning-effort-trigger')).toBeNull();

    fireEvent.click(modelSelector);
    expect(onReasoningEffortChange).toHaveBeenCalledWith('low');
  });

  it('keeps the standalone reasoning slider on the desktop surface', () => {
    const { container } = render(
      <PromptActions
        {...defaultProps}
        reasoningEffortLevels={['low', 'high']}
        selectedReasoningEffort="high"
        reasoningEffortVariant="desktop"
      />
    );

    expect(screen.getByTestId('model-selector').getAttribute('data-reasoning-levels')).toBe('');
    expect(container.querySelector('.reasoning-effort-trigger')).toBeTruthy();
  });

  it('renders correctly in voice mode', () => {
    render(
      <PromptActions {...defaultProps} primaryButtonMode="voice" primaryButtonTitle="Start voice" />
    );

    expect(screen.getByTestId('voice-icon')).toBeTruthy();
    const button = screen.getByTitle('Dictate ^⇧D');
    expect(button.getAttribute('type')).toBe('button');
    expect(screen.getByTitle('Dictate ^⇧D')).toBeTruthy();
    expect(screen.getByTitle('Use Voice ^⇧V')).toBeTruthy();
  });

  it('handles click in voice mode', () => {
    const onPrimaryButtonClick = mock();
    render(
      <PromptActions
        {...defaultProps}
        primaryButtonMode="voice"
        primaryButtonTitle="Start voice"
        onPrimaryButtonClick={onPrimaryButtonClick}
      />
    );

    fireEvent.click(screen.getByTitle('Dictate ^⇧D'));
    expect(onPrimaryButtonClick).toHaveBeenCalledTimes(1);
  });

  it('keeps dictation stable while send takes the realtime voice slot', () => {
    const onDictationClick = mock();
    const onPrimaryButtonClick = mock();
    render(
      <PromptActions
        {...defaultProps}
        onDictationClick={onDictationClick}
        onPrimaryButtonClick={onPrimaryButtonClick}
      />
    );

    fireEvent.click(screen.getByTitle('Dictate ^⇧D'));
    fireEvent.click(screen.getByTitle('Send message'));

    expect(onDictationClick).toHaveBeenCalledTimes(1);
    expect(onPrimaryButtonClick).toHaveBeenCalledTimes(1);
  });

  it('renders stop mode as a clickable non-submit button', () => {
    const onPrimaryButtonClick = mock();
    render(
      <PromptActions
        {...defaultProps}
        primaryButtonMode="stop"
        primaryButtonTitle="Stop run"
        onPrimaryButtonClick={onPrimaryButtonClick}
      />
    );

    const button = screen.getByTitle('Stop run');
    expect(button.getAttribute('type')).toBe('button');
    fireEvent.click(button);
    expect(onPrimaryButtonClick).toHaveBeenCalledTimes(1);
  });

  it('shows loading spinner when loading in send mode', () => {
    const { container } = render(
      <PromptActions {...defaultProps} primaryButtonMode="send" loading={true} />
    );

    expect(container.querySelector('.animate-spin')).toBeTruthy();
  });

  it('shows dictation accept and cancel controls when listening', () => {
    const onAcceptDictation = mock();
    const onCancelDictation = mock();
    render(
      <PromptActions
        {...defaultProps}
        primaryButtonMode="voice"
        isListening={true}
        primaryButtonTitle="Stop dictation"
        onAcceptDictation={onAcceptDictation}
        onCancelDictation={onCancelDictation}
      />
    );

    fireEvent.click(screen.getByTitle('Cancel Dictation'));
    fireEvent.click(screen.getByTitle('Accept Dictation'));

    expect(onCancelDictation).toHaveBeenCalledTimes(1);
    expect(onAcceptDictation).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('voice-icon')).toBeNull();
    expect(screen.queryByTitle('Use Voice ^⇧V')).toBeNull();
  });

  it('handles realtime voice clicks', () => {
    const onRealtimeVoiceClick = mock();
    render(
      <PromptActions
        {...defaultProps}
        primaryButtonMode="voice"
        primaryButtonTitle="Start voice"
        onRealtimeVoiceClick={onRealtimeVoiceClick}
      />
    );

    fireEvent.click(screen.getByTitle('Use Voice ^⇧V'));

    expect(onRealtimeVoiceClick).toHaveBeenCalledTimes(1);
  });

  it('keeps private-mode primary send in the dictation slot when realtime voice is hidden', () => {
    render(<PromptActions {...defaultProps} showRealtimeVoice={false} />);

    expect(screen.getByTitle('Send message')).toBeTruthy();
    expect(screen.queryByTitle('Dictate ^⇧D')).toBeNull();
    expect(screen.queryByTitle('Use Voice ^⇧V')).toBeNull();
  });

  it('hides realtime voice in voice mode when the host disables it', () => {
    render(
      <PromptActions
        {...defaultProps}
        primaryButtonMode="voice"
        primaryButtonTitle="Start voice"
        showRealtimeVoice={false}
      />
    );

    expect(screen.getByTitle('Dictate ^⇧D')).toBeTruthy();
    expect(screen.queryByTitle('Use Voice ^⇧V')).toBeNull();
  });

  it('prewarms realtime voice on hover when startable', () => {
    const onRealtimeVoicePrewarm = mock();
    render(
      <PromptActions
        {...defaultProps}
        primaryButtonMode="voice"
        primaryButtonTitle="Start voice"
        onRealtimeVoicePrewarm={onRealtimeVoicePrewarm}
      />
    );

    fireEvent.pointerEnter(screen.getByTitle('Use Voice ^⇧V'));

    expect(onRealtimeVoicePrewarm).toHaveBeenCalledTimes(1);
  });

  it('does not prewarm realtime voice when active', () => {
    const onRealtimeVoicePrewarm = mock();
    render(
      <PromptActions
        {...defaultProps}
        primaryButtonMode="voice"
        primaryButtonTitle="Start voice"
        onRealtimeVoicePrewarm={onRealtimeVoicePrewarm}
        realtimeVoiceActive={true}
        realtimeVoiceTitle="End voice chat"
      />
    );

    fireEvent.pointerEnter(screen.getByTitle('End Voice Chat ^⇧V'));

    expect(onRealtimeVoicePrewarm).not.toHaveBeenCalled();
  });

  it('disables button when required', () => {
    render(<PromptActions {...defaultProps} primaryButtonDisabled={true} />);

    expect(screen.getByTitle('Send message')).toBeDisabled();
  });

  it('triggers custom models callback from more options menu', async () => {
    const onCustomizeOrchestration = mock();
    render(<PromptActions {...defaultProps} onCustomizeOrchestration={onCustomizeOrchestration} />);

    // First open the dropdown by clicking the trigger
    fireEvent.click(screen.getByTitle('Mode Options'));
    // Then click the Agent Team Config item
    fireEvent.click(screen.getByText('Agent Team Config'));
    await waitFor(() => expect(onCustomizeOrchestration).toHaveBeenCalledTimes(1));
  });

  it('does not turn off direct chat when direct chat is already active', () => {
    const onQuickModeToggle = mock();
    render(
      <PromptActions
        {...defaultProps}
        quickModeEnabled={true}
        onQuickModeToggle={onQuickModeToggle}
      />
    );

    fireEvent.click(screen.getByText('Direct Chat'));

    expect(onQuickModeToggle).not.toHaveBeenCalled();
  });

  it('switches to agent teams explicitly from direct chat', () => {
    const onQuickModeToggle = mock();
    render(
      <PromptActions
        {...defaultProps}
        quickModeEnabled={true}
        onQuickModeToggle={onQuickModeToggle}
      />
    );

    fireEvent.click(screen.getByText('Agent Teams'));

    expect(onQuickModeToggle).toHaveBeenCalledTimes(1);
  });

  it('opens agent team config from direct chat and switches to agent teams', async () => {
    const onQuickModeToggle = mock();
    const onCustomizeOrchestration = mock();
    render(
      <PromptActions
        {...defaultProps}
        quickModeEnabled={true}
        onQuickModeToggle={onQuickModeToggle}
        onCustomizeOrchestration={onCustomizeOrchestration}
      />
    );

    fireEvent.click(screen.getByText('Agent Team Config'));

    expect(onQuickModeToggle).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onCustomizeOrchestration).toHaveBeenCalledTimes(1));
  });

  it('triggers autonomous panel callback from more options menu', async () => {
    const onOpenAutonomousPanel = mock();
    const onAutonomyToggle = mock();
    render(
      <PromptActions
        {...defaultProps}
        autonomyEnabled={false}
        onAutonomyToggle={onAutonomyToggle}
        onOpenAutonomousPanel={onOpenAutonomousPanel}
      />
    );

    fireEvent.click(screen.getByTitle('Mode Options'));
    fireEvent.click(screen.getByText('Configure autonomous…'));
    expect(onAutonomyToggle).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onOpenAutonomousPanel).toHaveBeenCalledTimes(1));
  });

  it('does not render custom models item when callback is missing', () => {
    render(<PromptActions {...defaultProps} onCustomizeOrchestration={undefined} />);

    expect(screen.queryByText('Custom Models')).toBeNull();
  });

  it('renders locked computer use when available', () => {
    const onLockedComputerUseToggle = mock();
    render(
      <PromptActions
        {...defaultProps}
        computerUseEnabled={true}
        lockedComputerUseAvailable={true}
        lockedComputerUseLabel="Install Locked Computer Use"
        onLockedComputerUseToggle={onLockedComputerUseToggle}
      />
    );

    fireEvent.click(screen.getByText('Install Locked Computer Use'));
    expect(onLockedComputerUseToggle).toHaveBeenCalled();
  });
});

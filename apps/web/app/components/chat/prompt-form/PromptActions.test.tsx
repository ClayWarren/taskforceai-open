import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, describe, it, expect, mock } from 'bun:test';
import type { ReactNode } from 'react';

import '../../../../../../tests/setup/dom';

// Mocks
void mock.module('../../../lib/prompt/ModelSelectorControl', () => ({
  ModelSelectorControl: ({ title }: { title?: string }) => (
    <button type="button" data-testid="model-selector" title={title}>
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
    expect(screen.getByTitle('Send message')).toBeTruthy();
    expect(screen.getByTitle('Use Voice ^⇧V')).toBeTruthy();
    const button = screen.getByTitle('Send message');
    expect(button.getAttribute('type')).toBe('submit');
  });

  it('renders correctly in voice mode', () => {
    render(
      <PromptActions {...defaultProps} primaryButtonMode="voice" primaryButtonTitle="Start voice" />
    );

    expect(screen.getByTestId('voice-icon')).toBeTruthy();
    const button = screen.getByTitle('Dictate ^⇧D');
    expect(button.getAttribute('type')).toBe('button');
    expect(screen.getByTitle('Dictate ^⇧D')).toBeTruthy();
  });

  it('handles click in voice mode', () => {
    render(
      <PromptActions {...defaultProps} primaryButtonMode="voice" primaryButtonTitle="Start voice" />
    );

    fireEvent.click(screen.getByTitle('Dictate ^⇧D'));
    expect(defaultProps.onPrimaryButtonClick).toHaveBeenCalled();
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
    render(<PromptActions {...defaultProps} onRealtimeVoiceClick={onRealtimeVoiceClick} />);

    fireEvent.click(screen.getByTitle('Use Voice ^⇧V'));

    expect(onRealtimeVoiceClick).toHaveBeenCalledTimes(1);
  });

  it('prewarms realtime voice on hover when startable', () => {
    const onRealtimeVoicePrewarm = mock();
    render(<PromptActions {...defaultProps} onRealtimeVoicePrewarm={onRealtimeVoicePrewarm} />);

    fireEvent.pointerEnter(screen.getByTitle('Use Voice ^⇧V'));

    expect(onRealtimeVoicePrewarm).toHaveBeenCalledTimes(1);
  });

  it('does not prewarm realtime voice when active', () => {
    const onRealtimeVoicePrewarm = mock();
    render(
      <PromptActions
        {...defaultProps}
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

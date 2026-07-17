import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { afterEach, describe, it, expect, mock } from 'bun:test';

import '../../../../../../../tests/setup/dom';

// Mocks
void mock.module('../../../../lib/prompt/ModelSelectorControl', () => ({
  ModelSelectorControl: ({
    title,
    reasoningEffortLevels = [],
    selectedReasoningEffort,
    onReasoningEffortChange,
    reasoningEffortPresentation,
    quickModeEnabled,
    agentCount,
  }: {
    title?: string;
    reasoningEffortLevels?: string[];
    selectedReasoningEffort?: string | null;
    onReasoningEffortChange?: (effort: string) => void;
    reasoningEffortPresentation?: 'menu' | 'slider';
    quickModeEnabled?: boolean;
    agentCount?: number;
  }) => (
    <button
      type="button"
      data-testid="model-selector"
      data-reasoning-levels={reasoningEffortLevels.join(',')}
      data-selected-reasoning-effort={selectedReasoningEffort ?? ''}
      data-reasoning-effort-presentation={reasoningEffortPresentation ?? ''}
      data-agent-mode={quickModeEnabled ? 'single' : 'teams'}
      data-agent-count={agentCount}
      title={title}
      onClick={() => onReasoningEffortChange?.(reasoningEffortLevels[0] ?? '')}
    >
      Model selector
    </button>
  ),
}));

void mock.module('../../../../lib/prompt/prompt-icons', () => ({
  VoiceIcon: () => <div data-testid="voice-icon" />,
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
    quickModeEnabled: false,
    onQuickModeToggle: mock(),
    agentCount: 3,
    onAgentCountChange: mock(),
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

  it('moves the desktop reasoning slider into the model selector', () => {
    const { container } = render(
      <PromptActions
        {...defaultProps}
        reasoningEffortLevels={['low', 'high']}
        selectedReasoningEffort="high"
        reasoningEffortVariant="desktop"
      />
    );

    expect(screen.getByTestId('model-selector').getAttribute('data-reasoning-levels')).toBe(
      'low,high'
    );
    expect(
      screen.getByTestId('model-selector').getAttribute('data-reasoning-effort-presentation')
    ).toBe('slider');
    expect(container.querySelector('.reasoning-effort-trigger')).toBeNull();
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

  it('removes more options and forwards agent settings into the model selector', () => {
    render(<PromptActions {...defaultProps} quickModeEnabled={true} agentCount={5} />);

    expect(screen.queryByTitle('Mode Options')).toBeNull();
    expect(screen.getByTestId('model-selector').getAttribute('data-agent-mode')).toBe('single');
    expect(screen.getByTestId('model-selector').getAttribute('data-agent-count')).toBe('5');
  });

  it('does not render autonomous controls in more options', () => {
    render(<PromptActions {...defaultProps} />);

    expect(screen.queryByText('Autonomous')).toBeNull();
    expect(screen.queryByText('Configure autonomous…')).toBeNull();
  });

  it('does not render computer-use controls in more options', () => {
    render(<PromptActions {...defaultProps} />);

    expect(screen.queryByText('Computer Use')).toBeNull();
    expect(screen.queryByText('Use logged-in services')).toBeNull();
    expect(screen.queryByText('Locked Computer Use')).toBeNull();
  });
});

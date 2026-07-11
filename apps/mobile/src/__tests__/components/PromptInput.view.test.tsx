import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { PromptInputView } from '../../components/PromptInput.view';

let mockLatestModeBadgesProps: any;
let mockLatestMoreOptionsProps: any;
let mockLatestModelSelectorProps: any;

jest.mock('expo-linear-gradient', () => ({
  LinearGradient: ({ children }: { children: React.ReactNode }) => {
    const react = require('react');
    const { View } = require('react-native');
    return react.createElement(View, null, children);
  },
}));

jest.mock('../../components/Icon', () => require('../helpers/mock-modules').createIconMockModule());

jest.mock('../../components/PromptInput.AttachmentsBar', () => ({
  AttachmentsBar: ({ attachments }: { attachments: Array<{ id: string }> }) => (
    (() => {
      const react = require('react');
      const { Text } = require('react-native');
      return react.createElement(Text, { testID: 'attachments-bar' }, `attachments:${attachments.length}`);
    })()
  ),
}));

jest.mock('../../components/PromptInput.ModeBadges', () => ({
  ModeBadges: (props: any) => {
    mockLatestModeBadgesProps = props;
    const enabled = props.badges.filter((badge: { enabled: boolean }) => badge.enabled).length;
    const react = require('react');
    const { Text } = require('react-native');
    return react.createElement(Text, { testID: 'mode-badges' }, `enabled:${enabled}`);
  },
}));

jest.mock('../../components/PromptInput.ModelSelector', () => ({
  PromptInputModelSelector: (props: any) => {
    mockLatestModelSelectorProps = props;
    const react = require('react');
    const { Text } = require('react-native');
    return react.createElement(Text, { testID: 'model-selector' }, props.currentLabel);
  },
}));

jest.mock('../../components/PromptInput.MoreOptionsSheet', () => ({
  MoreOptionsSheet: (props: any) => {
    mockLatestMoreOptionsProps = props;
    const { Text, TouchableOpacity, View } = require('react-native');
    return (
      <View>
        <Text testID="more-options-visible">visible:{String(props.visible)}</Text>
        <TouchableOpacity testID="more-options-toggle-quick" onPress={props.onQuickModeToggle}>
          <Text>toggle-quick</Text>
        </TouchableOpacity>
        <TouchableOpacity testID="more-options-toggle-autonomous" onPress={props.onAutonomousModeToggle}>
          <Text>toggle-autonomous</Text>
        </TouchableOpacity>
        <TouchableOpacity testID="more-options-toggle-computer" onPress={props.onComputerUseToggle}>
          <Text>toggle-computer</Text>
        </TouchableOpacity>
      </View>
    );
  },
}));

type PromptInputViewProps = React.ComponentProps<typeof PromptInputView>;

const createProps = (overrides: Partial<PromptInputViewProps> = {}): PromptInputViewProps => ({
  message: '',
  setMessage: jest.fn(),
  placeholder: 'Ask TaskForce',
  attachments: [],
  removeAttachment: jest.fn(),
  isPreparingMessage: false,
  isListening: false,
  transcriptionHint: null,
  handleFileUpload: jest.fn(),
  handleSend: jest.fn(),
  handleVoiceDictation: jest.fn(),
  handleVoiceDictationAccept: jest.fn(),
  handleVoiceDictationCancel: jest.fn(),
  modelOptions: [{ id: 'heavy', label: 'Heavy' }],
  currentModelLabel: 'Heavy',
  effectiveModelId: 'heavy',
  isModelSelectorLoading: false,
  shouldRenderModelSelector: true,
  isModelMenuOpen: false,
  setIsModelMenuOpen: jest.fn(),
  handleModelSelect: jest.fn(),
  reasoningEffortLevels: ['low', 'high'],
  defaultReasoningEffort: 'low',
  selectedReasoningEffort: 'low',
  handleReasoningEffortChange: jest.fn(),
  isDisabled: false,
  promptMaxWidth: 640,
  bottomPadding: 20,
  isMoreOptionsOpen: false,
  setIsMoreOptionsOpen: jest.fn(),
  quickModeEnabled: false,
  handleQuickModeToggle: jest.fn(),
  autonomousModeEnabled: false,
  handleAutonomousModeToggle: jest.fn(),
  computerUseEnabled: false,
  handleComputerUseToggle: jest.fn(),
  onCustomizeOrchestration: jest.fn(),
  onOpenBudgetPanel: jest.fn(),
  autonomyEnabled: true,
  roleModels: {},
  agentCount: 2,
  onAgentCountChange: jest.fn(),
  userPlan: 'free',
  ...overrides,
});

describe('PromptInputView', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLatestModeBadgesProps = undefined;
    mockLatestMoreOptionsProps = undefined;
    mockLatestModelSelectorProps = undefined;
  });

  it('shows voice input button for empty message and no attachments', async () => {
    const handleVoiceDictation = jest.fn();
    const props = createProps({ handleVoiceDictation });

    const { getByLabelText, queryByLabelText } = await render(<PromptInputView {...props} />);

    await fireEvent.press(getByLabelText('Voice input'));

    expect(handleVoiceDictation).toHaveBeenCalledTimes(1);
    expect(queryByLabelText('Send message')).toBeNull();
  });

  it('shows a separate realtime voice action when provided', async () => {
    const handleVoiceDictation = jest.fn();
    const handleRealtimeVoice = jest.fn();
    const props = createProps({ handleVoiceDictation, handleRealtimeVoice });

    const { getByLabelText } = await render(<PromptInputView {...props} />);

    await fireEvent.press(getByLabelText('Voice input'));
    await fireEvent.press(getByLabelText('Use voice'));

    expect(handleVoiceDictation).toHaveBeenCalledTimes(1);
    expect(handleRealtimeVoice).toHaveBeenCalledTimes(1);
  });

  it('shows private chat disclosure and keeps dictation while hiding realtime voice', async () => {
    const handleVoiceDictation = jest.fn();
    const handleRealtimeVoice = jest.fn();
    const props = createProps({
      handleVoiceDictation,
      handleRealtimeVoice,
      privateChat: true,
    });

    const { getByLabelText, getByText, queryByLabelText } = await render(
      <PromptInputView {...props} />
    );

    expect(
      getByText("This chat won't appear in your history, be added to memory, or be used to train models.")
    ).toBeTruthy();
    await fireEvent.press(getByLabelText('Voice input'));
    expect(handleVoiceDictation).toHaveBeenCalledTimes(1);
    expect(queryByLabelText('Send message')).toBeNull();
    expect(queryByLabelText('Use voice')).toBeNull();
  });

  it('flips the realtime voice action to a stop control while active', async () => {
    const handleRealtimeVoice = jest.fn();
    const props = createProps({ handleRealtimeVoice, realtimeVoiceActive: true });

    const { getByLabelText } = await render(<PromptInputView {...props} />);

    expect(getByLabelText('Voice input').props.disabled).toBe(true);
    await fireEvent.press(getByLabelText('Stop voice conversation'));

    expect(handleRealtimeVoice).toHaveBeenCalledTimes(1);
  });

  it('keeps the prompt field editable while realtime voice is active', async () => {
    const props = createProps({ realtimeVoiceActive: true });

    const { getByTestId } = await render(<PromptInputView {...props} />);

    expect(getByTestId('message-input').props.editable).toBe(true);
  });

  it('shows send button when message has content and triggers send', async () => {
    const handleSend = jest.fn();
    const props = createProps({
      message: 'Run this task',
      handleSend,
    });

    const { getByLabelText } = await render(<PromptInputView {...props} />);

    await fireEvent.press(getByLabelText('Send message'));

    expect(handleSend).toHaveBeenCalledTimes(1);
  });

  it('shows listening and transcription state and disables action buttons', async () => {
    const props = createProps({
      attachments: [
        {
          id: 'a1',
          name: 'photo.png',
          uri: 'file://photo.png',
          size: 100,
          mimeType: 'image/png',
          kind: 'image',
        },
      ],
      isListening: true,
      transcriptionHint: 'Listening to your microphone',
    });

    const { getByLabelText, getByText } = await render(<PromptInputView {...props} />);

    expect(getByText('Listening to your microphone')).toBeTruthy();
    expect(getByText('Recording — cancel or finish dictation')).toBeTruthy();
    expect(getByLabelText('Attach file or image').props.disabled).toBe(true);
    expect(getByLabelText('Cancel dictation')).toBeTruthy();
    expect(getByLabelText('Finish dictation')).toBeTruthy();
  });

  it('opens more options and forwards option toggle handlers', async () => {
    const setIsMoreOptionsOpen = jest.fn();
    const handleQuickModeToggle = jest.fn();
    const handleAutonomousModeToggle = jest.fn();
    const handleComputerUseToggle = jest.fn();

    const props = createProps({
      isMoreOptionsOpen: true,
      setIsMoreOptionsOpen,
      handleQuickModeToggle,
      handleAutonomousModeToggle,
      handleComputerUseToggle,
      userPlan: 'super',
      agentCount: 4,
    });

    const { getByLabelText, getByTestId } = await render(<PromptInputView {...props} />);

    await fireEvent.press(getByLabelText('More options'));
    await fireEvent.press(getByTestId('more-options-toggle-quick'));
    await fireEvent.press(getByTestId('more-options-toggle-autonomous'));
    await fireEvent.press(getByTestId('more-options-toggle-computer'));

    expect(setIsMoreOptionsOpen).toHaveBeenCalledWith(true);
    expect(handleQuickModeToggle).toHaveBeenCalledTimes(1);
    expect(handleAutonomousModeToggle).toHaveBeenCalledTimes(1);
    expect(handleComputerUseToggle).toHaveBeenCalledTimes(1);
    expect(mockLatestMoreOptionsProps).toEqual(
      expect.objectContaining({
        visible: true,
        userPlan: 'super',
        agentCount: 4,
      })
    );
  });

  it('computes mode badge enablement based on quick mode and role models', async () => {
    const { rerender } = await render(
      <PromptInputView
        {...createProps({
          quickModeEnabled: false,
          autonomousModeEnabled: true,
          computerUseEnabled: true,
          roleModels: { planner: 'gpt-4.1' },
        })}
      />
    );

    const enabledById = Object.fromEntries(
      mockLatestModeBadgesProps.badges.map((badge: { id: string; enabled: boolean }) => [badge.id, badge.enabled])
    );

    expect(enabledById.agentTeams).toBe(true);
    expect(enabledById.customOrchestration).toBe(true);
    expect(enabledById.autonomous).toBe(true);
    expect(enabledById.quickMode).toBeUndefined();
    expect(enabledById.computerUse).toBe(true);

    await rerender(
      <PromptInputView
        {...createProps({
          quickModeEnabled: true,
          roleModels: { planner: 'gpt-4.1' },
        })}
      />
    );

    const nextEnabledById = Object.fromEntries(
      mockLatestModeBadgesProps.badges.map((badge: { id: string; enabled: boolean }) => [badge.id, badge.enabled])
    );

    expect(nextEnabledById.agentTeams).toBe(false);
    expect(nextEnabledById.customOrchestration).toBe(false);
    expect(nextEnabledById.quickMode).toBeUndefined();
    expect(mockLatestModelSelectorProps).toEqual(
      expect.objectContaining({
        currentLabel: 'Heavy',
        effectiveModelId: 'heavy',
        reasoningEffortLevels: ['low', 'high'],
        defaultReasoningEffort: 'low',
        selectedReasoningEffort: 'low',
      })
    );
  });

  it('renders mcp tools and inserts an mcp call command when tapped', async () => {
    const setMessage = jest.fn();
    const { getByText, getByLabelText } = await render(
      <PromptInputView
        {...createProps({
          setMessage,
          mcpToolSummary: 'MCP tools available: 1 across 1 server.',
          mcpToolItems: [{ serverName: 'docs', toolName: 'lookup' }],
        })}
      />
    );

    expect(getByText('MCP tools available: 1 across 1 server.')).toBeTruthy();
    await fireEvent.press(getByLabelText('Use MCP tool docs/lookup'));

    expect(setMessage).toHaveBeenCalledWith('/mcp call docs lookup ');
  });
});

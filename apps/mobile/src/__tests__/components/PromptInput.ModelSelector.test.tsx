import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

const reactNative = require('react-native');
const ReactModule = require('react');
if (!reactNative.Modal) {
  reactNative.Modal = ({ children, ...props }: any) =>
    ReactModule.createElement('Modal', props, children);
}

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('../../contexts/ThemeContext', () => ({
  useTheme: () => ({
    theme: {
      colors: {
        overlay: 'rgba(0,0,0,0.7)',
        surface: '#111111',
        cardBackground: '#171717',
        border: '#333333',
        text: '#ffffff',
        primary: '#3b82f6',
        success: '#34d399',
      },
    },
  }),
}));

jest.mock('../../components/Icon', () =>
  require('../helpers/mock-modules').createIconMockModule(),
);

import { PromptInputModelSelector } from '../../components/PromptInput/ModelSelector';

type ModelSelectorProps = React.ComponentProps<typeof PromptInputModelSelector>;

const createProps = (overrides: Partial<ModelSelectorProps> = {}): ModelSelectorProps => ({
  shouldRender: true,
  isLoading: false,
  isDisabled: false,
  isPreparingMessage: false,
  isListening: false,
  isMenuOpen: true,
  setIsMenuOpen: jest.fn(),
  options: [
    { id: 'openai/gpt-5.6-sol', label: 'GPT-5.6 Sol' },
    { id: 'openai/gpt-5.6-terra', label: 'GPT-5.6 Terra' },
  ],
  currentLabel: 'GPT-5.6 Sol',
  effectiveModelId: 'openai/gpt-5.6-sol',
  onSelect: jest.fn(),
  reasoningEffortLevels: ['low', 'medium', 'xhigh'],
  defaultReasoningEffort: 'medium',
  selectedReasoningEffort: 'medium',
  onReasoningEffortChange: jest.fn(),
  quickModeEnabled: true,
  onQuickModeToggle: jest.fn(),
  onCustomizeOrchestration: jest.fn(),
  agentCount: 2,
  onAgentCountChange: jest.fn(),
  ...overrides,
});

describe('PromptInputModelSelector', () => {
  it('shows provider logos beside models', async () => {
    const { getByTestId } = await render(
      <PromptInputModelSelector
        {...createProps({
          options: [
            { id: 'zai/glm-5.2', label: 'Sentinel' },
            { id: 'openai/gpt-5.6-sol', label: 'GPT-5.6 Sol' },
            { id: 'anthropic/claude-sonnet-5', label: 'Claude Sonnet' },
            { id: 'google/gemini-3.5-flash', label: 'Gemini Flash' },
            { id: 'xai/grok-4.5', label: 'Grok 4.5' },
            { id: 'meta/muse-spark-1.1', label: 'Muse Spark' },
            { id: 'custom/unknown', label: 'Unknown' },
          ],
          effectiveModelId: 'zai/glm-5.2',
        })}
      />,
    );

    expect(getByTestId('model-provider-logo-taskforceai')).toBeTruthy();
    expect(getByTestId('model-provider-logo-openai')).toBeTruthy();
    expect(getByTestId('model-provider-logo-anthropic')).toBeTruthy();
    expect(getByTestId('model-provider-logo-google')).toBeTruthy();
    expect(getByTestId('model-provider-logo-xai')).toBeTruthy();
    expect(getByTestId('model-provider-logo-meta')).toBeTruthy();
    expect(() => getByTestId('model-provider-logo-custom')).toThrow();
  });

  it('keeps an effort row at the bottom and opens a dedicated effort view', async () => {
    const onReasoningEffortChange = jest.fn();
    const { getByLabelText, getByText, queryByText } = await render(
      <PromptInputModelSelector
        {...createProps({ onReasoningEffortChange })}
      />,
    );

    expect(getByText('Select Model')).toBeTruthy();
    expect(getByText('Effort')).toBeTruthy();
    expect(getByText('Medium')).toBeTruthy();

    await fireEvent.press(getByLabelText('Effort, Medium'));

    expect(getByText('Effort')).toBeTruthy();
    expect(queryByText('Select Model')).toBeNull();
    expect(getByText('Default')).toBeTruthy();
    expect(getByText('Light, casual tasks.')).toBeTruthy();

    await fireEvent.press(getByLabelText('Extra high reasoning effort'));

    expect(onReasoningEffortChange).toHaveBeenCalledWith('xhigh');
    expect(queryByText('Select Model')).toBeNull();

    await fireEvent.press(getByLabelText('Back to models'));

    expect(getByText('Select Model')).toBeTruthy();
  });

  it('hides the effort footer for models without reasoning-effort support', async () => {
    const { queryByLabelText, queryByText } = await render(
      <PromptInputModelSelector
        {...createProps({
          reasoningEffortLevels: [],
          defaultReasoningEffort: null,
          selectedReasoningEffort: null,
        })}
      />,
    );

    expect(queryByText('Effort')).toBeNull();
    expect(queryByLabelText('Reasoning effort')).toBeNull();
  });

  it('moves single-agent and agent-team configuration into the model selector', async () => {
    jest.useFakeTimers();
    const onQuickModeToggle = jest.fn();
    const onAgentCountChange = jest.fn();
    const onCustomizeOrchestration = jest.fn();
    const setIsMenuOpen = jest.fn();
    const { getByLabelText, getByText } = await render(
      <PromptInputModelSelector
        {...createProps({
          quickModeEnabled: false,
          onQuickModeToggle,
          onAgentCountChange,
          onCustomizeOrchestration,
          setIsMenuOpen,
          agentCount: 2,
          userPlan: 'free',
        })}
      />,
    );

    await fireEvent.press(getByLabelText('Agent mode, Agent Teams'));

    expect(getByText('Single Agent')).toBeTruthy();
    expect(getByText('Agent Teams')).toBeTruthy();
    expect(getByText('Parallel Agents')).toBeTruthy();
    expect(getByText('Custom Models')).toBeTruthy();

    await fireEvent.press(getByLabelText('Single Agent'));
    expect(onQuickModeToggle).toHaveBeenCalledTimes(1);

    await fireEvent.press(getByLabelText('1 parallel agents'));
    expect(onAgentCountChange).toHaveBeenCalledWith(1);

    await fireEvent.press(getByLabelText('Custom Models'));
    expect(setIsMenuOpen).toHaveBeenCalledWith(false);
    expect(onCustomizeOrchestration).not.toHaveBeenCalled();
    jest.runAllTimers();
    expect(onCustomizeOrchestration).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  it('hides team-only configuration in single-agent mode', async () => {
    const { getByLabelText, queryByText } = await render(
      <PromptInputModelSelector {...createProps({ quickModeEnabled: true })} />,
    );

    await fireEvent.press(getByLabelText('Agent mode, Single Agent'));

    expect(queryByText('Parallel Agents')).toBeNull();
    expect(queryByText('Custom Models')).toBeNull();
  });

  it('shows paid models as locked for free users', async () => {
    const onSelect = jest.fn();
    const { getByLabelText, getByText } = await render(
      <PromptInputModelSelector
        {...createProps({
          userPlan: 'free',
          onSelect,
          options: [
            { id: 'google/gemini-3.5-flash', label: 'Gemini Flash', usageMultiple: 1.5 },
            { id: 'anthropic/claude-sonnet-5', label: 'Claude Sonnet', usageMultiple: 2 },
          ],
          effectiveModelId: 'google/gemini-3.5-flash',
        })}
      />,
    );

    await fireEvent.press(getByLabelText('Claude Sonnet, Pro subscription required'));

    expect(getByText('Pro')).toBeTruthy();
    expect(onSelect).not.toHaveBeenCalled();
  });
});

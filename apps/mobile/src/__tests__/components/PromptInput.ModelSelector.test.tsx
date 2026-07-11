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
      },
    },
  }),
}));

jest.mock('../../components/Icon', () =>
  require('../helpers/mock-modules').createIconMockModule(),
);

import { PromptInputModelSelector } from '../../components/PromptInput.ModelSelector';

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
  ...overrides,
});

describe('PromptInputModelSelector', () => {
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
});

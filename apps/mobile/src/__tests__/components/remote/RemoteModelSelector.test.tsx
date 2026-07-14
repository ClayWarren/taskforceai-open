import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';

import { RemoteModelSelector } from '../../../features/desktop-work/components/RemoteModelSelector';

jest.mock('../../../contexts/ThemeContext', () => ({
  useTheme: () => ({
    theme: {
      colors: {
        background: '#0f172a',
        border: '#334155',
        cardBackground: '#111827',
        primary: '#3b82f6',
        text: '#f8fafc',
        textMuted: '#94a3b8',
      },
    },
  }),
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: React.PropsWithChildren) => children,
}));

jest.mock('../../../components/Icon', () => {
  const react = require('react');
  const { Text } = require('react-native');
  return {
    Icon: ({ name }: { name: string }) => react.createElement(Text, null, `icon-${name}`),
  };
});

const options = [
  {
    id: 'openai/gpt-5.6-sol',
    label: '5.6 Sol',
    description: 'Deep coding model',
    reasoningEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
    defaultReasoningEffort: 'high',
  },
  {
    id: 'openai/gpt-5.6',
    label: '5.6',
    description: 'General model',
    reasoningEffortLevels: ['low', 'high'],
    defaultReasoningEffort: 'low',
  },
] as const;

describe('RemoteModelSelector', () => {
  it('shows a disabled loading state while model options are loading', async () => {
    const { getByLabelText } = await render(
      <RemoteModelSelector
        options={[]}
        loading
        selectedModelId={null}
        selectedEffort={null}
        onModelChange={jest.fn()}
        onEffortChange={jest.fn()}
      />
    );

    expect(getByLabelText('Select Remote model').props.disabled).toBe(true);
  });

  it('opens from the compact model and effort label and emits model and slider selections', async () => {
    const onModelChange = jest.fn();
    const onEffortChange = jest.fn();
    const { getAllByText, getByLabelText } = await render(
      <RemoteModelSelector
        options={[...options]}
        loading={false}
        selectedModelId="openai/gpt-5.6-sol"
        selectedEffort="high"
        onModelChange={onModelChange}
        onEffortChange={onEffortChange}
      />
    );

    expect(getAllByText('5.6 Sol High').length).toBeGreaterThan(0);
    await fireEvent.press(getByLabelText('Select Remote model'));
    await fireEvent.press(getByLabelText('Remote model: 5.6'));
    await fireEvent.press(getByLabelText('Remote reasoning effort: Max'));

    expect(onModelChange).toHaveBeenCalledWith('openai/gpt-5.6');
    expect(onEffortChange).toHaveBeenCalledWith('max');
  });
});

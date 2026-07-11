import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

const reactNative = require('react-native');
const ReactModule = require('react');
if (!reactNative.Switch) {
  reactNative.Switch = ({ value, onValueChange, ...props }: any) =>
    ReactModule.createElement('Switch', { ...props, value, onValueChange });
}
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
        border: '#333333',
        text: '#ffffff',
        primary: '#3b82f6',
      },
    },
  }),
}));

jest.mock('../../components/Icon', () => require('../helpers/mock-modules').createIconMockModule());

import { MoreOptionsSheet } from '../../components/PromptInput.MoreOptionsSheet';

type MoreOptionsSheetProps = React.ComponentProps<typeof MoreOptionsSheet>;

const createProps = (
  overrides: Partial<MoreOptionsSheetProps> = {}
): MoreOptionsSheetProps => ({
  visible: true,
  onClose: jest.fn(),
  quickModeEnabled: false,
  onQuickModeToggle: jest.fn(),
  autonomousModeEnabled: false,
  onAutonomousModeToggle: jest.fn(),
  computerUseEnabled: false,
  onComputerUseToggle: jest.fn(),
  onCustomizeOrchestration: jest.fn(),
  onSetBudget: jest.fn(),
  autonomyEnabled: true,
  agentCount: 2,
  onAgentCountChange: jest.fn(),
  userPlan: 'free',
  ...overrides,
});

describe('MoreOptionsSheet', () => {
  it('calls mode toggle handlers from option rows', async () => {
    const onQuickModeToggle = jest.fn();
    const onAutonomousModeToggle = jest.fn();
    const onComputerUseToggle = jest.fn();

    const props = createProps({
      onQuickModeToggle,
      onAutonomousModeToggle,
      onComputerUseToggle,
    });

    const { getByLabelText } = await render(<MoreOptionsSheet {...props} />);

    await fireEvent.press(getByLabelText('Autonomous. Self-directed task execution'));
    await fireEvent.press(getByLabelText('Direct Chat. Standard single-assistant responses'));
    await fireEvent.press(getByLabelText('Computer Use. Enable desktop automation'));

    expect(onAutonomousModeToggle).toHaveBeenCalledTimes(1);
    expect(onQuickModeToggle).toHaveBeenCalledTimes(1);
    expect(onComputerUseToggle).toHaveBeenCalledTimes(1);
  });

  it('renders free-plan agent count options and applies selection', async () => {
    const onAgentCountChange = jest.fn();

    const { getByText, queryByText } = await render(
      <MoreOptionsSheet
        {...createProps({
          agentCount: 2,
          onAgentCountChange,
          userPlan: 'free',
          quickModeEnabled: false,
        })}
      />
    );

    expect(getByText('Parallel Agents: 2')).toBeTruthy();
    expect(getByText('1')).toBeTruthy();
    expect(getByText('2')).toBeTruthy();
    expect(queryByText('4')).toBeNull();
    expect(queryByText('6')).toBeNull();

    await fireEvent.press(getByText('1'));

    expect(onAgentCountChange).toHaveBeenCalledWith(1);
  });

  it('renders extended agent count options for super plan', async () => {
    const { getByText } = await render(
      <MoreOptionsSheet
        {...createProps({
          userPlan: 'super',
          quickModeEnabled: false,
          agentCount: 8,
        })}
      />
    );

    expect(getByText('16')).toBeTruthy();
  });

  it('invokes delayed custom models and budget actions after closing', async () => {
    jest.useFakeTimers();

    const onClose = jest.fn();
    const onCustomizeOrchestration = jest.fn();
    const onSetBudget = jest.fn();

    const { getByLabelText } = await render(
      <MoreOptionsSheet
        {...createProps({
          onClose,
          autonomousModeEnabled: true,
          onCustomizeOrchestration,
          onSetBudget,
        })}
      />
    );

    await fireEvent.press(getByLabelText('Custom Models - Assign models to agent roles'));
    await fireEvent.press(getByLabelText('Set Budget - Configure autonomous spending limit'));

    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onCustomizeOrchestration).not.toHaveBeenCalled();
    expect(onSetBudget).not.toHaveBeenCalled();

    jest.runAllTimers();

    expect(onCustomizeOrchestration).toHaveBeenCalledTimes(1);
    expect(onSetBudget).toHaveBeenCalledTimes(1);

    jest.useRealTimers();
  });

  it('hides optional rows when feature callbacks are not provided', async () => {
    const { queryByLabelText, queryByText } = await render(
      <MoreOptionsSheet
        {...createProps({
          onCustomizeOrchestration: undefined,
          onSetBudget: undefined,
          autonomousModeEnabled: false,
          quickModeEnabled: true,
        })}
      />
    );

    expect(queryByLabelText('Custom Models - Assign models to agent roles')).toBeNull();
    expect(queryByLabelText('Set Budget - Configure autonomous spending limit')).toBeNull();
    expect(queryByText('Parallel Agents:')).toBeNull();
  });
});

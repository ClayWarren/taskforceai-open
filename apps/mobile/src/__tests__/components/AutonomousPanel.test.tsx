import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { AutonomousPanel } from '../../components/AutonomousPanel';

jest.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, bottom: 20, left: 0, right: 0 }),
}));

jest.mock('../../contexts/ThemeContext', () => ({
    useTheme: () => ({
        theme: {
            colors: {
                overlay: 'rgba(0,0,0,0.5)',
                background: '#000000',
                text: '#ffffff',
            },
        },
    }),
}));

const defaultProps = {
    visible: true,
    onClose: jest.fn(),
    onBudgetChange: jest.fn(),
};

describe('AutonomousPanel', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('renders base content and current budget value', async () => {
        const { getAllByText, getByDisplayValue, getByText } = await render(
            <AutonomousPanel {...defaultProps} budget={123.45} />
        );
        expect(getAllByText('Autonomous Mode').length).toBeGreaterThan(0);
        expect(getByText('Set a budget limit for autonomous task execution.')).toBeTruthy();
        expect(getByText('BUDGET LIMIT')).toBeTruthy();
        expect(getByDisplayValue('123.45')).toBeTruthy();
    });

    it('calls onClose when close button is pressed', async () => {
        const onCloseMock = jest.fn();
        const { getByTestId } = await render(<AutonomousPanel {...defaultProps} onClose={onCloseMock} />);
        await fireEvent.press(getByTestId('close-panel-btn'));
        expect(onCloseMock).toHaveBeenCalledTimes(1);
    });

    it('handles budget input correctly', async () => {
        const onBudgetChangeMock = jest.fn();
        const { getByPlaceholderText } = await render(
            <AutonomousPanel {...defaultProps} onBudgetChange={onBudgetChangeMock} />
        );

        const input = getByPlaceholderText('No limit');

        await fireEvent.changeText(input, '50');
        expect(onBudgetChangeMock).toHaveBeenCalledWith(50);

        await fireEvent.changeText(input, '');
        expect(onBudgetChangeMock).toHaveBeenCalledWith(undefined);

        onBudgetChangeMock.mockClear();
        await fireEvent.changeText(input, 'abc');
        expect(onBudgetChangeMock).not.toHaveBeenCalled();

        await fireEvent.changeText(input, '-10');
        expect(onBudgetChangeMock).not.toHaveBeenCalled();
    });

    it('displays spend progress while streaming with the effective budget', async () => {
        const { getByText, rerender } = await render(
            <AutonomousPanel
                {...defaultProps}
                budget={100}
                currentSpend={25}
                isStreaming={true}
            />
        );

        expect(getByText('CURRENT SPEND')).toBeTruthy();
        expect(getByText('$25.00')).toBeTruthy();
        expect(getByText('$25.00 spent')).toBeTruthy();
        expect(getByText('$75.00 remaining')).toBeTruthy();

        await rerender(<AutonomousPanel {...defaultProps} currentSpend={15} isStreaming={true} />);
        expect(getByText('$15.00')).toBeTruthy();
        expect(getByText('No budget limit set. Running until task completes.')).toBeTruthy();

        await rerender(
            <AutonomousPanel
                {...defaultProps}
                budget={100}
                budgetLimit={200}
                currentSpend={50}
                isStreaming={true}
            />
        );

        expect(getByText('$150.00 remaining')).toBeTruthy();
    });
});

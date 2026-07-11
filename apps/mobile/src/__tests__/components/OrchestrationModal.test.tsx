import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { OrchestrationModal } from '../../components/OrchestrationModal';

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

const mockModels = [
    { id: 'model-a', label: 'Model A', badge: 'fast' },
    { id: 'model-b', label: 'Model B' },
];

const defaultProps = {
    visible: true,
    onClose: jest.fn(),
    models: mockModels,
    roleModels: {} as Record<string, string>,
    onRoleModelChange: jest.fn(),
    onBudgetChange: jest.fn(),
    autonomyEnabled: false,
    defaultModelId: 'model-a',
    defaultModelLabel: 'Model A',
};

describe('OrchestrationModal', () => {
    beforeEach(() => jest.clearAllMocks());

    it('renders header, descriptions, default model, and all roles', async () => {
        const { getAllByText, getByText, rerender } = await render(<OrchestrationModal {...defaultProps} />);
        expect(getByText('Custom Orchestration')).toBeTruthy();
        expect(getByText('Assign specialized models to each agent role.')).toBeTruthy();
        expect(getAllByText('Model A').length).toBeGreaterThanOrEqual(2);
        expect(getByText('Researcher')).toBeTruthy();
        expect(getByText('Analyst')).toBeTruthy();
        expect(getByText('Skeptic')).toBeTruthy();
        expect(getByText('Pragmatist')).toBeTruthy();

        await rerender(<OrchestrationModal {...defaultProps} autonomyEnabled={true} />);
        expect(getByText('Assign specialized models and set a mission budget.')).toBeTruthy();
    });

    it('expands a role when pressed and shows model options', async () => {
        const { getByText, queryByText } = await render(<OrchestrationModal {...defaultProps} />);
        await fireEvent.press(getByText('Researcher'));
        expect(queryByText('Model B')).toBeTruthy();
    });

    it('calls onRoleModelChange and collapses when model selected', async () => {
        const onRoleModelChange = jest.fn();
        const { getByText, getAllByText } = await render(
            <OrchestrationModal {...defaultProps} onRoleModelChange={onRoleModelChange} />
        );
        await fireEvent.press(getByText('Researcher'));
        const modelBButtons = getAllByText('Model B');
        await fireEvent.press(modelBButtons[modelBButtons.length - 1]);
        expect(onRoleModelChange).toHaveBeenCalledWith('Researcher', 'model-b');
    });

    it('shows budget input when autonomy is enabled', async () => {
        const { getByText, getByPlaceholderText } = await render(
            <OrchestrationModal {...defaultProps} autonomyEnabled={true} budget={50} />
        );
        expect(getByText('ORGANIZATION BUDGET')).toBeTruthy();
        expect(getByPlaceholderText('Auto')).toBeTruthy();
    });

    it('shows role slots for the selected agent count', async () => {
        const { getByText, queryByText } = await render(
            <OrchestrationModal {...defaultProps} agentCount={2} />
        );
        expect(getByText('Researcher')).toBeTruthy();
        expect(getByText('Analyst')).toBeTruthy();
        expect(queryByText('Skeptic')).toBeNull();
        expect(queryByText('Pragmatist')).toBeNull();
    });

    it('handles budget input changes', async () => {
        const onBudgetChange = jest.fn();
        const { getByPlaceholderText } = await render(
            <OrchestrationModal
                {...defaultProps}
                autonomyEnabled={true}
                onBudgetChange={onBudgetChange}
            />
        );
        const input = getByPlaceholderText('Auto');
        await fireEvent.changeText(input, '100');
        expect(onBudgetChange).toHaveBeenCalledWith(100);

        await fireEvent.changeText(input, '');
        expect(onBudgetChange).toHaveBeenCalledWith(undefined);

        onBudgetChange.mockClear();
        await fireEvent.changeText(input, 'abc');
        expect(onBudgetChange).not.toHaveBeenCalled();

        await fireEvent.changeText(input, '-5');
        expect(onBudgetChange).not.toHaveBeenCalled();
    });

    it('shows "Default" when no defaultModelLabel', async () => {
        const { getAllByText } = await render(
            <OrchestrationModal {...defaultProps} defaultModelLabel={null} />
        );
        expect(getAllByText('Default').length).toBeGreaterThanOrEqual(2);
    });
});

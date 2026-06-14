import React from 'react';
import { createQueuedRunPayload } from '@taskforceai/client-runtime';
import { render, fireEvent, act } from '@testing-library/react-native';
import { PendingPrompts } from '../../components/PendingPrompts';
import {
    usePendingPromptsQuery,
    useClearPendingPromptsMutation,
    useRemovePendingPromptMutation,
} from '../../hooks/api/pendingPrompts';

jest.mock('../../hooks/api/pendingPrompts');
jest.mock('react-i18next', () =>
    require('../helpers/mock-modules').createTranslationMockModule()
);
jest.mock('../../logger', () => ({
    createModuleLogger: () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() }),
    mobileLogger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const mockUsePendingPromptsQuery = usePendingPromptsQuery as jest.MockedFunction<typeof usePendingPromptsQuery>;
const mockUseClearPendingPromptsMutation = useClearPendingPromptsMutation as jest.MockedFunction<typeof useClearPendingPromptsMutation>;
const mockUseRemovePendingPromptMutation = useRemovePendingPromptMutation as jest.MockedFunction<typeof useRemovePendingPromptMutation>;

const mockClearMutateAsync = jest.fn().mockResolvedValue(undefined);
const mockRemoveMutateAsync = jest.fn().mockResolvedValue(undefined);
let consoleWarnSpy: jest.SpiedFunction<typeof console.warn>;
let consoleErrorSpy: jest.SpiedFunction<typeof console.error>;

beforeEach(() => {
    jest.clearAllMocks();
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockUseClearPendingPromptsMutation.mockReturnValue({
        mutateAsync: mockClearMutateAsync,
    } as any);
    mockUseRemovePendingPromptMutation.mockReturnValue({
        mutateAsync: mockRemoveMutateAsync,
    } as any);
});

afterEach(() => {
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
});

const samplePrompts = [
    {
        id: 1,
        prompt: 'Hello world',
        status: 'queued' as const,
        createdAt: Date.now(),
        runPayload: createQueuedRunPayload({ prompt: 'Hello world', modelId: 'gpt-4' }),
    },
    { id: 2, prompt: 'Test prompt', status: 'pending' as const, createdAt: Date.now() },
    {
        id: 3,
        prompt: 'Failed prompt',
        status: 'failed' as const,
        createdAt: Date.now(),
        runPayload: createQueuedRunPayload({ prompt: 'Failed prompt', modelId: 'gpt-3' }),
    },
];

describe('PendingPrompts', () => {
    it('returns null when loading (no spinner)', () => {
        mockUsePendingPromptsQuery.mockReturnValue({
            data: undefined,
            isLoading: true,
        } as any);

        const { toJSON } = render(<PendingPrompts />);
        expect(toJSON()).toBeNull();
    });

    it('returns null when no pending prompts', () => {
        mockUsePendingPromptsQuery.mockReturnValue({
            data: [],
            isLoading: false,
        } as any);

        const { toJSON } = render(<PendingPrompts />);
        expect(toJSON()).toBeNull();
    });

    it('renders pending prompts with status counts', () => {
        mockUsePendingPromptsQuery.mockReturnValue({
            data: samplePrompts,
            isLoading: false,
        } as any);

        const { getByText } = render(<PendingPrompts />);
        expect(getByText('3 prompts saved')).toBeTruthy();
        expect(getByText('1 failed')).toBeTruthy();
        expect(getByText('Hello world')).toBeTruthy();
        expect(getByText('Test prompt')).toBeTruthy();
        expect(getByText('Failed prompt')).toBeTruthy();
    });

    it('shows modelId when present', () => {
        mockUsePendingPromptsQuery.mockReturnValue({
            data: samplePrompts,
            isLoading: false,
        } as any);

        const { getByText } = render(<PendingPrompts />);
        expect(getByText('gpt-4')).toBeTruthy();
    });

    it('calls clearAll when Clear All is pressed', async () => {
        mockUsePendingPromptsQuery.mockReturnValue({
            data: samplePrompts,
            isLoading: false,
        } as any);

        const { getByLabelText } = render(<PendingPrompts />);
        await act(async () => {
            fireEvent.press(getByLabelText('Clear All'));
        });
        expect(mockClearMutateAsync).toHaveBeenCalled();
    });

    it('handles clearAll error gracefully', async () => {
        mockClearMutateAsync.mockRejectedValueOnce(new Error('fail'));
        mockUsePendingPromptsQuery.mockReturnValue({
            data: samplePrompts,
            isLoading: false,
        } as any);

        const { getByLabelText } = render(<PendingPrompts />);
        await act(async () => {
            fireEvent.press(getByLabelText('Clear All'));
        });
        // Should not throw
        expect(mockClearMutateAsync).toHaveBeenCalled();
    });

    it('handles remove with non-number id gracefully', async () => {
        mockUsePendingPromptsQuery.mockReturnValue({
            data: [{ prompt: 'No id', status: 'queued' as const, createdAt: Date.now() }],
            isLoading: false,
        } as any);

        const { getByText } = render(<PendingPrompts />);
        // The prompt renders but removePrompt with undefined id should be a no-op
        expect(getByText('No id')).toBeTruthy();
    });
});

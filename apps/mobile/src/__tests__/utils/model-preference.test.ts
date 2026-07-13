import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { loadModelPreference, storeModelPreference } from '../../utils/model-preference';

const mockAsyncStorage = require('@react-native-async-storage/async-storage');

describe('model-preference', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('loadModelPreference', () => {
        it('returns stored model id', async () => {
            mockAsyncStorage.getItem.mockResolvedValueOnce(JSON.stringify({ id: 'gpt-4', label: null }));
            const result = await loadModelPreference();
            expect(result).toEqual({ id: 'gpt-4', label: null });
            expect(mockAsyncStorage.getItem).toHaveBeenCalledWith('@taskforceai:model-selection');
        });

        it('returns null when no preference stored', async () => {
            mockAsyncStorage.getItem.mockResolvedValueOnce(null);
            const result = await loadModelPreference();
            expect(result).toBeNull();
        });

        it('returns null on error', async () => {
            mockAsyncStorage.getItem.mockRejectedValueOnce(new Error('storage error'));
            const result = await loadModelPreference();
            expect(result).toBeNull();
        });
    });

    describe('storeModelPreference', () => {
        it('persists model id to async storage', async () => {
            await storeModelPreference({ id: 'claude-3', label: 'Claude 3' });
            expect(mockAsyncStorage.setItem).toHaveBeenCalledWith(
                '@taskforceai:model-selection',
                JSON.stringify({ id: 'claude-3', label: 'Claude 3' })
            );
        });

        it('removes stored model selection when cleared', async () => {
            await storeModelPreference(null);
            expect(mockAsyncStorage.removeItem).toHaveBeenCalledWith('@taskforceai:model-selection');
        });

        it('does not throw on storage error', async () => {
            mockAsyncStorage.setItem.mockRejectedValueOnce(new Error('write error'));
            await expect(storeModelPreference({ id: 'gpt-4', label: null })).resolves.toBeUndefined();
        });
    });
});

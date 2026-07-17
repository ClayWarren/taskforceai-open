import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import React from 'react';
import { renderHook } from '@testing-library/react-native';

const mockFontsLoaded = { current: true };

jest.mock('expo-font', () => ({
    useFonts: jest.fn(() => [mockFontsLoaded.current]),
}));

// We need to test the exported pure functions as well
// Since flattenStyle and withFontFamily are module-scoped, we test them
// indirectly through useTypography and the Text patching behavior

import { useTypography } from '../../theme/useTypography';

describe('useTypography', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockFontsLoaded.current = true;
    });

    it('returns true when fonts are loaded', async () => {
        const { result } = await renderHook(() => useTypography());
        expect(result.current).toBe(true);
    });

    it('returns false when fonts are not loaded', async () => {
        mockFontsLoaded.current = false;
        const { result } = await renderHook(() => useTypography());
        expect(result.current).toBe(false);
    });

    it('returns consistent value across re-renders', async () => {
        const { result, rerender } = await renderHook(() => useTypography());
        expect(result.current).toBe(true);
        await rerender({});
        expect(result.current).toBe(true);
    });
});

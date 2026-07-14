import '../../../../../../../tests/setup/dom';

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'bun:test';

import { useReasoningEffort } from './useReasoningEffort';

describe('useReasoningEffort', () => {
  it('stores a supported effort for the selected model', () => {
    const modelOptions = [
      {
        id: 'reasoning-model',
        reasoningEffortLevels: ['low', 'high'],
        defaultReasoningEffort: 'low',
      },
    ];
    const { result } = renderHook(() =>
      useReasoningEffort({
        modelOptions: modelOptions as never,
        selectedModelId: 'reasoning-model',
      })
    );

    expect(result.current.selectedEffort).toBe('low');
    act(() => result.current.setSelectedEffort('high'));
    expect(result.current.selectedEffort).toBe('high');
  });
});

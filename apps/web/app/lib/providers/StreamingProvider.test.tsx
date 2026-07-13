import { cleanup, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'bun:test';
import type { ReactNode } from 'react';

import '../../../../../tests/setup/dom';

import type { StreamingStoreState } from '../streaming/useStreamingStore';

const streamingStore = { marker: 'streaming-store' } as unknown as StreamingStoreState;
const useStreamingStoreMock = vi.fn(() => streamingStore);

vi.mock('../streaming/useStreamingStore', () => ({
  useStreamingStore: useStreamingStoreMock,
}));

import { StreamingProvider, useStreaming } from './StreamingProvider';

const wrapper = ({ children }: { children: ReactNode }) => (
  <StreamingProvider>{children}</StreamingProvider>
);

describe('StreamingProvider', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('provides the streaming store value', () => {
    const { result } = renderHook(() => useStreaming(), { wrapper });

    expect(result.current).toBe(streamingStore);
    expect(useStreamingStoreMock).toHaveBeenCalledTimes(1);
  });

  it('rejects consumers outside the provider', () => {
    expect(() => renderHook(() => useStreaming())).toThrow(
      'useStreaming must be used within a StreamingProvider'
    );
  });

  it('renders its children', () => {
    render(
      <StreamingProvider>
        <span>streaming child</span>
      </StreamingProvider>
    );

    expect(screen.getByText('streaming child')).toBeInTheDocument();
  });
});

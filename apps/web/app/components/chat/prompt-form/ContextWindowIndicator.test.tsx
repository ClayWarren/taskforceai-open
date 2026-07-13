import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import path from 'path';

import '../../../../../../tests/setup/dom';

const appPath = (value: string) => path.resolve(process.cwd(), 'apps/web/app', value);
const getDesktopAppServerContextSummary = vi.fn(async () => ({
  maxTokens: 258_000,
  estimatedTokens: 134_000,
  items: [],
  suggestions: [],
}));

vi.mock(appPath('lib/platform/desktop/app-server'), () => ({
  getDesktopAppServerContextSummary,
}));

import { ContextWindowIndicator } from './ContextWindowIndicator';

describe('ContextWindowIndicator', () => {
  beforeEach(() => {
    getDesktopAppServerContextSummary.mockReset();
    getDesktopAppServerContextSummary.mockResolvedValue({
      maxTokens: 258_000,
      estimatedTokens: 134_000,
      items: [],
      suggestions: [],
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows the estimated context usage on hover', async () => {
    render(<ContextWindowIndicator />);

    const trigger = await screen.findByRole('button', { name: 'Context window 52% full' });
    fireEvent.focus(trigger);

    await waitFor(() => expect(screen.getAllByText('52% full').length).toBeGreaterThan(0));
    expect(screen.getAllByText('~134k / 258k tokens used').length).toBeGreaterThan(0);
  });

  it('stays hidden when the context summary cannot be loaded', async () => {
    getDesktopAppServerContextSummary.mockRejectedValueOnce(new Error('App server unavailable'));
    render(<ContextWindowIndicator />);

    await waitFor(() => expect(getDesktopAppServerContextSummary).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('button')).toBeNull();
  });
});

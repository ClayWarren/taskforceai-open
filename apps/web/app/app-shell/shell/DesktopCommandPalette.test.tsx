import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'bun:test';

import '../../../../../tests/setup/dom';

const invokeTauri = vi.fn();
const loggerError = vi.fn();
vi.mock('../../lib/platform/desktop-api', () => ({ invokeTauri }));
vi.mock('../../lib/logger', () => ({ logger: { error: loggerError } }));

import { DesktopCommandPalette } from './DesktopCommandPalette';

afterEach(() => cleanup());

describe('DesktopCommandPalette', () => {
  it('searches and opens task entities alongside commands', async () => {
    const onTaskSelect = vi.fn();
    const onClose = vi.fn();
    render(
      <DesktopCommandPalette
        open
        commands={[]}
        includeFiles={false}
        loadTasks={async () => [
          {
            conversationId: 'conversation-1',
            title: 'Fix desktop terminal',
            createdAt: 1,
            updatedAt: 2,
            lastMessagePreview: 'Wire the PTY backend',
          },
        ]}
        onTaskSelect={onTaskSelect}
        onFileSelect={() => undefined}
        onClose={onClose}
      />
    );

    expect(await screen.findByText('Fix desktop terminal')).toBeTruthy();
    fireEvent.click(screen.getByText('Fix desktop terminal'));
    expect(onTaskSelect).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conversation-1' })
    );

    fireEvent.mouseDown(screen.getByRole('presentation'));
    fireEvent.keyDown(screen.getByPlaceholderText('Search commands and tasks'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('includes workspace files in Code mode', async () => {
    invokeTauri.mockResolvedValueOnce({
      root: '/workspace',
      roots: ['/workspace'],
      entries: [{ path: 'src/app.ts', name: 'app.ts', depth: 1, isDirectory: false }],
      truncated: false,
    });
    const onFileSelect = vi.fn();
    render(
      <DesktopCommandPalette
        open
        commands={[]}
        includeFiles
        loadTasks={async () => []}
        onTaskSelect={() => undefined}
        onFileSelect={onFileSelect}
        onClose={() => undefined}
      />
    );

    await waitFor(() => expect(screen.getByText('app.ts')).toBeTruthy());
    fireEvent.click(screen.getByText('app.ts'));
    expect(onFileSelect).toHaveBeenCalledWith('src/app.ts');
  });

  it('keeps the palette open when entity loading fails', async () => {
    const error = new Error('entities unavailable');
    render(
      <DesktopCommandPalette
        open
        commands={[]}
        includeFiles={false}
        loadTasks={() => Promise.reject(error)}
        onTaskSelect={() => undefined}
        onFileSelect={() => undefined}
        onClose={() => undefined}
      />
    );

    await waitFor(() =>
      expect(loggerError).toHaveBeenCalledWith('Failed to load command palette entities', {
        error,
      })
    );
    expect(screen.getByPlaceholderText('Search commands and tasks')).toBeTruthy();
  });
});

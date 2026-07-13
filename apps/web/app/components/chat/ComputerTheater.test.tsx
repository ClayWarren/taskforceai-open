import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'bun:test';

import '../../../../../tests/setup/dom';

vi.mock('../../lib/prompt/prompt-icons', () => ({
  MonitorIcon: () => <div data-testid="monitor-icon" />,
  MaximizeIcon: () => <div data-testid="maximize-icon" />,
  MinimizeIcon: () => <div data-testid="minimize-icon" />,
  ActivityIcon: () => <div data-testid="activity-icon" />,
}));

const createDesktopRecordReplaySkill = vi.fn();
vi.mock('../../lib/platform/desktop/app-server', () => ({
  createDesktopRecordReplaySkill,
}));

import { ComputerTheater } from './ComputerTheater';

describe('ComputerTheater', () => {
  beforeEach(() => {
    cleanup();
  });

  const baseProps = {
    toolEvents: [],
    isStreaming: false,
  };

  it('returns null when no computer_use events', () => {
    const { container } = render(<ComputerTheater {...baseProps} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders compact view when computer_use events exist', () => {
    const props = {
      ...baseProps,
      toolEvents: [
        {
          agentLabel: 'Agent',
          toolName: 'computer_use',
          timestamp: '2024-01-01T00:00:00Z',
          arguments: {},
          success: true,
          durationMs: 100,
        },
      ],
    };
    const { container } = render(<ComputerTheater {...props} />);
    expect(container.firstChild).not.toBeNull();
    expect(screen.getByText(/agent is using computer/i)).toBeTruthy();
  });

  it('shows View Live button', () => {
    const props = {
      ...baseProps,
      toolEvents: [
        {
          agentLabel: 'Agent',
          toolName: 'computer_use',
          timestamp: '2024-01-01T00:00:00Z',
          arguments: {},
          success: true,
          durationMs: 100,
        },
      ],
    };
    render(<ComputerTheater {...props} />);
    expect(screen.getByRole('button', { name: /view live/i })).toBeTruthy();
  });

  it('turns a completed Computer Use demonstration into a reusable skill', async () => {
    createDesktopRecordReplaySkill.mockResolvedValue({
      name: 'Weekly report',
      path: '/skills/weekly-report',
      stepCount: 1,
      scope: 'user',
    });
    render(
      <ComputerTheater
        {...baseProps}
        recordReplayEnabled
        toolEvents={[
          {
            agentLabel: 'Agent',
            toolName: 'computer_use',
            timestamp: '2024-01-01T00:00:00Z',
            arguments: { action: 'type', text: 'private value' },
            success: true,
            durationMs: 100,
          },
        ]}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save as skill' }));
    const user = userEvent.setup({ document: globalThis.document });
    await user.type(screen.getByLabelText('Recorded skill name'), 'Weekly report');
    await user.type(
      screen.getByLabelText('Recorded skill description'),
      'Submit the weekly report safely'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Create skill' }));

    await waitFor(() =>
      expect(createDesktopRecordReplaySkill).toHaveBeenCalledWith({
        name: 'Weekly report',
        description: 'Submit the weekly report safely',
        scope: 'user',
        steps: [
          {
            toolName: 'computer_use',
            arguments: { action: 'type', text: 'private value' },
            success: true,
            durationMs: 100,
            resultPreview: null,
          },
        ],
      })
    );
    expect(await screen.findByText('Saved Weekly report with 1 replay steps.')).toBeTruthy();
  });

  it('shows streaming indicator when streaming', () => {
    const props = {
      ...baseProps,
      toolEvents: [
        {
          agentLabel: 'Agent',
          toolName: 'computer_use',
          timestamp: '2024-01-01T00:00:00Z',
          arguments: {},
          success: true,
          durationMs: 100,
        },
      ],
      isStreaming: true,
    };
    render(<ComputerTheater {...props} />);
    expect(screen.getByText(/agent is using computer/i)).toBeTruthy();
  });

  it('uses custom agent label when provided', () => {
    const props = {
      ...baseProps,
      toolEvents: [
        {
          agentLabel: 'Agent',
          toolName: 'computer_use',
          timestamp: '2024-01-01T00:00:00Z',
          arguments: {},
          success: true,
          durationMs: 100,
        },
      ],
      agentLabel: 'TestAgent',
    };
    render(<ComputerTheater {...props} />);
    expect(screen.getByText(/testagent is using computer/i)).toBeTruthy();
  });

  it('keeps the latest available screenshot when newest event has no image', () => {
    const props = {
      ...baseProps,
      toolEvents: [
        {
          agentLabel: 'Agent',
          toolName: 'computer_use',
          timestamp: '2024-01-01T00:00:00Z',
          arguments: {},
          success: true,
          durationMs: 100,
          image_base64: 'abc123',
        },
        {
          agentLabel: 'Agent',
          toolName: 'computer_use',
          timestamp: '2024-01-01T00:00:01Z',
          arguments: { action: 'click' },
          success: true,
          durationMs: 120,
        },
      ],
    };

    render(<ComputerTheater {...props} />);
    const screenshot = screen.getByAltText('Computer Screenshot');
    expect(screenshot.getAttribute('src')).toBe('data:image/png;base64,abc123');
  });

  it('safely handles toolEvents with null or missing arguments (Hardening TF-0187)', () => {
    const props = {
      ...baseProps,
      toolEvents: [
        {
          agentLabel: 'Agent',
          toolName: 'computer_use',
          timestamp: '2024-01-01T00:00:00Z',
          arguments: null as any,
          success: true,
          durationMs: 100,
        },
      ],
    };

    // Should not crash during render
    const { container } = render(<ComputerTheater {...props} />);
    expect(container.firstChild).not.toBeNull();
  });

  it('shows computer-use failure details when no screenshot is available', () => {
    render(
      <ComputerTheater
        {...baseProps}
        toolEvents={[
          {
            agentLabel: 'Agent',
            toolName: 'computer_use',
            timestamp: '2024-01-01T00:00:00Z',
            arguments: {},
            success: false,
            status: 'failed',
            durationMs: 100,
            error: 'failed to start computer use',
          },
        ]}
      />
    );

    expect(screen.getByText('failed to start computer use')).toBeTruthy();
    expect(screen.queryByText('Waiting for screen update...')).toBeNull();
  });

  it('renders a waiting state when computer use is active before events arrive', () => {
    render(<ComputerTheater {...baseProps} showWhenEmpty={true} isStreaming={true} />);

    expect(screen.getByText('Computer Use Active')).toBeTruthy();
    expect(screen.getByText('Connecting to desktop environment...')).toBeTruthy();
  });

  it('shows agent progress while waiting for the first computer event', () => {
    render(
      <ComputerTheater
        {...baseProps}
        showWhenEmpty={true}
        isStreaming={true}
        preScreenStatus="Synthesizing findings and checking the answer..."
      />
    );

    expect(screen.getByText('Computer Use Active')).toBeTruthy();
    expect(screen.getByText('Synthesizing findings and checking the answer...')).toBeTruthy();
    expect(screen.queryByText('Connecting to desktop environment...')).toBeNull();
  });

  it('opens the live theater with screenshot, cursor, and action history', () => {
    const props = {
      ...baseProps,
      isStreaming: true,
      useLoggedInServices: true,
      toolEvents: [
        {
          agentLabel: 'Agent',
          toolName: 'computer_use',
          timestamp: '2024-01-01T00:00:00Z',
          arguments: { action: 'open' },
          success: true,
          durationMs: 100,
          image_base64: 'first',
        },
        {
          agentLabel: 'Agent',
          toolName: 'computer_use',
          timestamp: '2024-01-01T00:00:01Z',
          arguments: { action: 'click', coordinate_x: 50, coordinate_y: 25 },
          success: true,
          durationMs: 120,
          image_base64: 'data:image/png;base64,latest',
        },
      ],
    };

    render(<ComputerTheater {...props} />);

    fireEvent.click(screen.getByRole('button', { name: /view live/i }));

    expect(screen.getByText('Computer Use Mode')).toBeTruthy();
    expect(screen.getByText('Live Follow')).toBeTruthy();
    expect(screen.getByAltText('Live Desktop View').getAttribute('src')).toBe(
      'data:image/png;base64,latest'
    );
    expect(screen.getByText('Recent Actions')).toBeTruthy();
    expect(screen.getByText('click (50, 25)')).toBeTruthy();
    expect(screen.getByText('This change applies on the next computer-use run.')).toBeTruthy();

    expect(screen.getByTitle('Close Theater')).toBeTruthy();
  });

  it('opens the theater from the screenshot area and persists session mode changes', () => {
    const props = {
      ...baseProps,
      autoExpand: false,
      toolEvents: [
        {
          agentLabel: 'Agent',
          toolName: 'computer_use',
          timestamp: '',
          arguments: { action: 'wait' },
          success: false,
          durationMs: 100,
        },
      ],
    };

    render(<ComputerTheater {...props} />);

    fireEvent.click(screen.getByText('Action failed'));
    expect(
      screen.getAllByText((content) => content.includes('Action failed')).length
    ).toBeGreaterThan(1);
    expect(screen.queryByText('Initializing desktop stream...')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Logged In' }));
    expect(localStorage.getItem('taskforceai:computer-use-session-mode')).toBe('logged_in');

    fireEvent.click(screen.getByTitle('Close Theater'));
    expect(screen.queryByText('Computer Use Mode')).toBeNull();
  });
});

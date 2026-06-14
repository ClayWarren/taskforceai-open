import { describe, expect, it } from 'bun:test';

import {
  COMPUTER_USE_TOOL_NAME,
  COMPUTER_THEATER_COPY,
  calculateCursorPosition,
  createComputerTheaterAgentLabel,
  createComputerTheaterPreScreenStatus,
  createComputerTheaterViewModel,
  extractScreenshot,
  filterComputerEvents,
  toComputerScreenshotSource,
} from './computer-use';
import type { ToolUsageEvent } from '../types';

const createToolEvent = (toolName: string, imageBase64?: string): ToolUsageEvent => ({
  agentLabel: 'agent',
  toolName,
  arguments: {},
  success: true,
  durationMs: 1,
  ...(imageBase64 ? { image_base64: imageBase64 } : {}),
});

describe('utils/computer-use', () => {
  it('filters tool events down to computer use entries', () => {
    const events = [
      createToolEvent(COMPUTER_USE_TOOL_NAME, 'screen-a'),
      createToolEvent('shell', 'ignored'),
      createToolEvent(COMPUTER_USE_TOOL_NAME, 'screen-b'),
    ];

    expect(filterComputerEvents(events)).toEqual([events[0]!, events[2]!]);
  });

  it('extracts screenshots from optional tool events', () => {
    expect(extractScreenshot()).toBeNull();
    expect(extractScreenshot(createToolEvent(COMPUTER_USE_TOOL_NAME))).toBeNull();
    expect(extractScreenshot(createToolEvent(COMPUTER_USE_TOOL_NAME, 'encoded-image'))).toBe(
      'encoded-image'
    );
  });

  it('calculates cursor positions as percentages', () => {
    expect(calculateCursorPosition(512, 384)).toEqual({
      left: '50%',
      top: '50%',
    });
    expect(calculateCursorPosition(25, 75, 100, 300)).toEqual({
      left: '25%',
      top: '25%',
    });
  });

  it('normalizes screenshot sources', () => {
    expect(toComputerScreenshotSource(null)).toBeNull();
    expect(toComputerScreenshotSource('data:image/png;base64,abc')).toBe(
      'data:image/png;base64,abc'
    );
    expect(toComputerScreenshotSource('abc')).toBe('data:image/png;base64,abc');
  });

  it('normalizes theater labels and shared copy', () => {
    expect(createComputerTheaterAgentLabel()).toBe('Agent');
    expect(createComputerTheaterAgentLabel('  Worker  ')).toBe('Worker');
    expect(COMPUTER_THEATER_COPY.modeTitle).toBe('Computer Use Mode');
    expect(COMPUTER_THEATER_COPY.waitingForScreen).toBe('Waiting for screen update...');
  });

  it('creates theater view models with latest screenshot, cursor, status, and logs', () => {
    const viewModel = createComputerTheaterViewModel(
      [
        createToolEvent(COMPUTER_USE_TOOL_NAME, 'screen-a'),
        {
          ...createToolEvent(COMPUTER_USE_TOOL_NAME),
          arguments: { coordinate_x: 512, coordinate_y: 396 },
          timestamp: '2026-05-24T20:00:00.000Z',
        },
      ],
      { isStreaming: true, logLimit: 1 }
    );

    expect(viewModel.computerEvents).toHaveLength(2);
    expect(viewModel.screenshot).toBe('screen-a');
    expect(viewModel.imageSource).toBe('data:image/png;base64,screen-a');
    expect(viewModel.cursor).toEqual({ left: '50%', top: '50%' });
    expect(viewModel.statusText).toBe('Executing action...');
    expect(viewModel.actionLogs).toEqual([
      {
        timestamp: expect.any(String),
        toolName: COMPUTER_USE_TOOL_NAME,
        argumentsText: '(512, 396)',
      },
    ]);
  });

  it('parses JSON-string computer action arguments for live cursor and action history', () => {
    const viewModel = createComputerTheaterViewModel(
      [
        {
          ...createToolEvent(COMPUTER_USE_TOOL_NAME, 'screen-a'),
          arguments: '{"action":"click","coordinate_x":256,"coordinate_y":210}',
        },
      ],
      { isStreaming: true }
    );

    expect(viewModel.cursor).toEqual({ left: '25%', top: '25%' });
    expect(viewModel.actionLogs[0]?.argumentsText).toBe('click (256, 210)');
  });

  it('uses computer-use error details as the no-screen message', () => {
    const viewModel = createComputerTheaterViewModel(
      [
        {
          ...createToolEvent(COMPUTER_USE_TOOL_NAME),
          success: false,
          status: 'failed',
          error: 'failed to start computer use',
        },
      ],
      { isStreaming: true }
    );

    expect(viewModel.statusText).toBe('Action failed');
    expect(viewModel.screenMessage).toBe('failed to start computer use');
  });

  it('uses active agent status while waiting for the first computer event', () => {
    const preScreenStatus = createComputerTheaterPreScreenStatus([
      {
        status: 'PROCESSING...',
        progress: 0.83,
        result: 'Synthesizing findings and checking the answer...',
      },
    ]);

    const viewModel = createComputerTheaterViewModel([], {
      isStreaming: true,
      preScreenStatus,
    });

    expect(preScreenStatus).toBe('Synthesizing findings and checking the answer...');
    expect(viewModel.screenMessage).toBe('Synthesizing findings and checking the answer...');
  });
});

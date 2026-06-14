import type { ToolUsageEvent } from '../types';
import type { AgentStatusLike } from './agent-progress';

export const COMPUTER_USE_TOOL_NAME = 'computer_use';

// Default virtual desktop resolution. These should match the sandbox provider configuration.
export const DEFAULT_SCREEN_WIDTH = 1024;
export const DEFAULT_SCREEN_HEIGHT = 768;
export const SCREEN_CHROME_CROP_TOP_PX = 24;

/**
 * Extracts computer use events from a list of tool events.
 */
export const filterComputerEvents = (toolEvents: ToolUsageEvent[]): ToolUsageEvent[] => {
  return toolEvents.filter((e) => e.toolName === COMPUTER_USE_TOOL_NAME);
};

/**
 * Extracts the base64 screenshot from a tool event.
 */
export const extractScreenshot = (event?: ToolUsageEvent): string | null => {
  if (!event) return null;
  return event.image_base64 ?? null;
};

/**
 * Calculates the percentage-based position for the cursor overlay.
 */
export const calculateCursorPosition = (
  coordX: number,
  coordY: number,
  screenWidth: number = DEFAULT_SCREEN_WIDTH,
  screenHeight: number = DEFAULT_SCREEN_HEIGHT,
  cropTopPx: number = 0
): { left: string; top: string } => {
  const visibleHeight = Math.max(1, screenHeight - cropTopPx);
  const visibleY = Math.min(visibleHeight, Math.max(0, coordY - cropTopPx));
  return {
    left: `${(coordX / screenWidth) * 100}%`,
    top: `${(visibleY / visibleHeight) * 100}%`,
  };
};

export interface ComputerTheaterActionLog {
  timestamp: string;
  toolName: string;
  argumentsText: string;
}

export const COMPUTER_THEATER_COPY = {
  activeTitle: 'Computer Use Active',
  modeTitle: 'Computer Use Mode',
  liveFollow: 'Live Follow',
  recentActions: 'Recent Actions',
  waitingForScreen: 'Waiting for screen update...',
  connecting: 'Connecting to desktop environment...',
  initializing: 'Initializing desktop stream...',
  browserSessionTitle: 'Browser Session',
  browserSessionDescription: 'Choose whether computer use should run with logged-in services.',
  pendingModeChange: 'This change applies on the next computer-use run.',
  preparingDesktop: 'Agent is preparing the desktop...',
} as const;

export interface ComputerTheaterViewModel {
  computerEvents: ToolUsageEvent[];
  latestEvent: ToolUsageEvent | undefined;
  screenshot: string | null;
  imageSource: string | null;
  cursor: { left: string; top: string } | null;
  statusText: string;
  screenMessage: string;
  actionLogs: ComputerTheaterActionLog[];
}

const stringifyComputerActionArguments = (value: unknown): string => {
  const args = parseComputerActionArguments(value);
  if (args) {
    const action = typeof args['action'] === 'string' ? args['action'] : undefined;
    const parts = [
      action,
      formatCoordinate(args['coordinate_x'], args['coordinate_y']),
      formatScroll(args['scroll_direction'], args['scroll_amount']),
      typeof args['text'] === 'string' && args['text'].length > 0 ? `"${args['text']}"` : null,
    ].filter((part): part is string => Boolean(part));
    if (parts.length > 0) {
      return parts.join(' ');
    }
  }

  try {
    return JSON.stringify(value);
  } catch {
    return '[unserializable arguments]';
  }
};

const parseComputerActionArguments = (value: unknown): Record<string, unknown> | null => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
};

const formatCoordinate = (x: unknown, y: unknown): string | null =>
  typeof x === 'number' && typeof y === 'number' ? `(${x}, ${y})` : null;

const formatScroll = (direction: unknown, amount: unknown): string | null =>
  typeof direction === 'string' && typeof amount === 'number' && amount > 0
    ? `${direction} ${amount}`
    : null;

const extractComputerFailureMessage = (event?: ToolUsageEvent): string | null => {
  if (!event || event.success) {
    return null;
  }
  if (typeof event.error === 'string' && event.error.trim().length > 0) {
    return event.error.trim();
  }
  if (typeof event.resultPreview === 'string') {
    try {
      const parsed = JSON.parse(event.resultPreview);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const key of ['errors', 'error', 'screenshot_error']) {
          const value = (parsed as Record<string, unknown>)[key];
          if (typeof value === 'string' && value.trim().length > 0) {
            return value.trim();
          }
        }
      }
    } catch {
      return event.resultPreview.trim().length > 0 ? event.resultPreview.trim() : null;
    }
  }
  return null;
};

export const toComputerScreenshotSource = (screenshot: string | null): string | null => {
  if (!screenshot) {
    return null;
  }
  return screenshot.startsWith('data:') ? screenshot : `data:image/png;base64,${screenshot}`;
};

export const createComputerTheaterViewModel = (
  toolEvents: ToolUsageEvent[],
  options: {
    isStreaming: boolean;
    logLimit?: number;
    preScreenStatus?: string | null;
  }
): ComputerTheaterViewModel => {
  const computerEvents = filterComputerEvents(toolEvents);
  const latestEvent = computerEvents[computerEvents.length - 1];
  let screenshot: string | null = null;
  for (let i = computerEvents.length - 1; i >= 0; i -= 1) {
    const next = extractScreenshot(computerEvents[i]);
    if (next) {
      screenshot = next;
      break;
    }
  }

  let cursor: { left: string; top: string } | null = null;
  const latestArgs = parseComputerActionArguments(latestEvent?.arguments);
  if (latestArgs) {
    const args = latestArgs;
    const coordX = args['coordinate_x'];
    const coordY = args['coordinate_y'];
    if (typeof coordX === 'number' && typeof coordY === 'number') {
      cursor = calculateCursorPosition(
        coordX,
        coordY,
        DEFAULT_SCREEN_WIDTH,
        DEFAULT_SCREEN_HEIGHT,
        SCREEN_CHROME_CROP_TOP_PX
      );
    }
  }

  const statusText = latestEvent
    ? latestEvent.success
      ? options.isStreaming
        ? 'Executing action...'
        : 'Action complete'
      : 'Action failed'
    : 'Waiting for first action...';
  const failureMessage = extractComputerFailureMessage(latestEvent);
  const screenMessage =
    failureMessage ??
    (latestEvent && !latestEvent.success ? 'Action failed' : null) ??
    (computerEvents.length > 0
      ? COMPUTER_THEATER_COPY.waitingForScreen
      : options.preScreenStatus || COMPUTER_THEATER_COPY.connecting);

  const logLimit = options.logLimit ?? 5;
  const latestEvents = computerEvents.slice(-logLimit);
  const actionLogs = Array.from({ length: latestEvents.length }, (_, index) => {
    const event = latestEvents[latestEvents.length - index - 1];
    if (!event) {
      return null;
    }
    return {
      timestamp: event.timestamp ? new Date(event.timestamp).toLocaleTimeString() : '...',
      toolName: event.toolName,
      argumentsText: stringifyComputerActionArguments(event.arguments),
    };
  }).filter((event): event is NonNullable<typeof event> => event !== null);

  return {
    computerEvents,
    latestEvent,
    screenshot,
    imageSource: toComputerScreenshotSource(screenshot),
    cursor,
    statusText,
    screenMessage,
    actionLogs,
  };
};

export const createComputerTheaterPreScreenStatus = (
  agents: AgentStatusLike[] | undefined
): string | null => {
  const activeAgent = agents?.find((agent) => {
    const status = agent.status?.toLowerCase() ?? '';
    return status !== 'completed' && status !== 'failed';
  });
  if (!activeAgent) {
    return null;
  }

  const message = activeAgent.result?.trim() || activeAgent.reasoning?.trim();
  if (message) {
    return message;
  }

  const status = activeAgent.status?.toLowerCase() ?? '';
  if (status.includes('queued')) {
    return 'Waiting for the agent to start...';
  }
  return COMPUTER_THEATER_COPY.preparingDesktop;
};

export const createComputerTheaterAgentLabel = (agentLabel?: string): string => {
  return agentLabel?.trim() || 'Agent';
};

import { assertNever } from '../utils';

/**
 * UI lifecycle status for a streaming AI message.
 * Manages the transition from thinking/placeholder state to active streaming and finalization.
 */
export type StreamingLifecycleState =
  | { state: 'idle' }
  | {
      state: 'awaitingPlaceholder';
      statusMessageId: string | null;
      contentMessageId: string | null;
      bufferedContent: string | null;
    }
  | {
      state: 'streaming';
      statusMessageId: string;
      contentMessageId: string;
      bufferedContent: string | null;
    }
  | {
      state: 'finalizing';
      statusMessageId: string | null;
      contentMessageId: string | null;
      finalResponse: string;
    }
  | {
      state: 'error';
      statusMessageId: string | null;
      contentMessageId: string | null;
      message: string;
    };

export type StreamingLifecycleAction =
  | { type: 'START_STREAM' }
  | { type: 'BUFFER_CONTENT'; content: string }
  | { type: 'PLACEHOLDERS_READY'; statusMessageId: string; contentMessageId: string }
  | { type: 'APPEND_CONTENT'; content: string }
  | { type: 'FINAL_RESPONSE'; finalResponse: string }
  | { type: 'ERROR'; message: string }
  | { type: 'RESET' };

export const initialStreamingLifecycleState: StreamingLifecycleState = { state: 'idle' };

const streamingMessageIds = (state: StreamingLifecycleState) =>
  state.state === 'streaming'
    ? { statusMessageId: state.statusMessageId, contentMessageId: state.contentMessageId }
    : { statusMessageId: null, contentMessageId: null };

/**
 * Reducer for managing the UI state of a streaming message.
 * This pattern correctly handles the separation of "Thinking" (Status) bubbles
 * and "Responding" (Content) bubbles.
 */
export function streamingLifecycleReducer(
  state: StreamingLifecycleState,
  action: StreamingLifecycleAction
): StreamingLifecycleState {
  switch (action.type) {
    case 'START_STREAM':
      if (state.state === 'idle') {
        return {
          state: 'awaitingPlaceholder',
          statusMessageId: null,
          contentMessageId: null,
          bufferedContent: null,
        };
      }
      return state;

    case 'BUFFER_CONTENT':
      if (state.state === 'awaitingPlaceholder' || state.state === 'streaming') {
        if (state.bufferedContent === action.content) {
          return state;
        }
        return { ...state, bufferedContent: action.content };
      }
      return state;

    case 'PLACEHOLDERS_READY':
      if (state.state === 'awaitingPlaceholder') {
        return {
          state: 'streaming',
          statusMessageId: action.statusMessageId,
          contentMessageId: action.contentMessageId,
          bufferedContent: state.bufferedContent,
        };
      }
      return state;

    case 'APPEND_CONTENT':
      if (state.state === 'streaming') {
        if (state.bufferedContent === action.content) {
          return state;
        }
        return { ...state, bufferedContent: action.content };
      }
      return state;

    case 'FINAL_RESPONSE':
      if (state.state === 'streaming' || state.state === 'awaitingPlaceholder') {
        return {
          state: 'finalizing',
          ...streamingMessageIds(state),
          finalResponse: action.finalResponse,
        };
      }
      return state;

    case 'ERROR':
      return {
        state: 'error',
        ...streamingMessageIds(state),
        message: action.message,
      };

    case 'RESET':
      return initialStreamingLifecycleState;

    default:
      return assertNever(action);
  }
}

/**
 * Selector to get the ID of the message currently receiving content.
 */
export const selectStreamingContentId = (state: StreamingLifecycleState): string | null =>
  state.state === 'streaming' || state.state === 'finalizing' || state.state === 'error'
    ? state.contentMessageId
    : null;

/**
 * Selector to get the ID of the status (thinking) message.
 */
export const selectStreamingStatusId = (state: StreamingLifecycleState): string | null =>
  state.state === 'streaming' || state.state === 'finalizing' || state.state === 'error'
    ? state.statusMessageId
    : null;

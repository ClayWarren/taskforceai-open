import { parseRealtimeVoiceServerEvent, type RealtimeVoiceServerEvent } from './realtime-voice';

export interface AttachRealtimeVoiceSocketHandlersOptions {
  socket: WebSocket;
  getCurrentSocket: () => WebSocket | null;
  onOpen: () => void;
  onServerEvent: (event: RealtimeVoiceServerEvent) => void;
  onError: (event: Event) => void;
  onClose: () => void;
  parseServerEvent?: typeof parseRealtimeVoiceServerEvent;
}

export type RealtimeVoiceSocketControllerBindOptions = Omit<
  AttachRealtimeVoiceSocketHandlersOptions,
  'socket' | 'getCurrentSocket'
>;

export const attachRealtimeVoiceSocketHandlers = ({
  socket,
  getCurrentSocket,
  onOpen,
  onServerEvent,
  onError,
  onClose,
  parseServerEvent = parseRealtimeVoiceServerEvent,
}: AttachRealtimeVoiceSocketHandlersOptions): (() => void) => {
  const handleOpen = () => {
    if (getCurrentSocket() !== socket) {
      return;
    }
    onOpen();
  };

  const handleMessage = (event: MessageEvent) => {
    void parseServerEvent(event.data).then((serverEvent) => {
      if (getCurrentSocket() !== socket || !serverEvent) {
        return;
      }
      onServerEvent(serverEvent);
    });
  };

  socket.addEventListener('open', handleOpen);
  socket.addEventListener('message', handleMessage);
  socket.addEventListener('error', onError);
  socket.addEventListener('close', onClose);

  return () => {
    socket.removeEventListener('open', handleOpen);
    socket.removeEventListener('message', handleMessage);
    socket.removeEventListener('error', onError);
    socket.removeEventListener('close', onClose);
  };
};

export class RealtimeVoiceSocketController {
  private socket: WebSocket | null = null;
  private cleanupHandlers: (() => void) | null = null;

  get current(): WebSocket | null {
    return this.socket;
  }

  bind(socket: WebSocket, options: RealtimeVoiceSocketControllerBindOptions): void {
    this.cleanupHandlers?.();
    this.socket = socket;
    this.cleanupHandlers = attachRealtimeVoiceSocketHandlers({
      socket,
      getCurrentSocket: () => this.socket,
      ...options,
    });
  }

  isCurrent(socket: WebSocket): boolean {
    return this.socket === socket;
  }

  clear(socket?: WebSocket): boolean {
    if (socket && this.socket !== socket) {
      return false;
    }

    this.cleanupHandlers?.();
    this.cleanupHandlers = null;
    this.socket = null;
    return true;
  }

  closeCurrent(onCloseError?: (error: unknown) => void): void {
    const socket = this.socket;
    this.clear();
    if (!socket) {
      return;
    }

    try {
      socket.close();
    } catch (error) {
      onCloseError?.(error);
    }
  }
}

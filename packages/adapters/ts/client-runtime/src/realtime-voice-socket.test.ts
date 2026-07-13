import { describe, expect, it } from 'bun:test';

import {
  attachRealtimeVoiceSocketHandlers,
  RealtimeVoiceSocketController,
  type AttachRealtimeVoiceSocketHandlersOptions,
} from './realtime-voice-socket';

type FakeListener = (event: unknown) => void;

class FakeSocket {
  private readonly listeners = new Map<string, Set<FakeListener>>();
  closeCalls = 0;
  closeError: unknown = null;

  addEventListener(type: string, listener: FakeListener): void {
    const listeners = this.listeners.get(type) ?? new Set<FakeListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: FakeListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string, event: unknown = {}): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }

  close(): void {
    this.closeCalls += 1;
    if (this.closeError) {
      throw this.closeError;
    }
  }
}

const asSocket = (socket: FakeSocket): WebSocket => socket as unknown as WebSocket;

describe('attachRealtimeVoiceSocketHandlers', () => {
  it('wires lifecycle listeners, guards stale open/message events, and cleans up', async () => {
    const socket = new FakeSocket();
    let currentSocket: WebSocket | null = asSocket(socket);
    let openCalls = 0;
    let errorCalls = 0;
    let closeCalls = 0;
    const serverEvents: string[] = [];

    const options: AttachRealtimeVoiceSocketHandlersOptions = {
      socket: asSocket(socket),
      getCurrentSocket: () => currentSocket,
      onOpen: () => {
        openCalls += 1;
      },
      onServerEvent: (event) => {
        serverEvents.push(event.type);
      },
      onError: () => {
        errorCalls += 1;
      },
      onClose: () => {
        closeCalls += 1;
      },
      parseServerEvent: async (data) =>
        data === 'skip' ? null : { type: String(data) || 'session-created' },
    };

    const cleanup = attachRealtimeVoiceSocketHandlers(options);

    socket.emit('open');
    socket.emit('message', { data: 'session-created' });
    await Promise.resolve();

    expect(openCalls).toBe(1);
    expect(serverEvents).toEqual(['session-created']);

    currentSocket = null;
    socket.emit('open');
    socket.emit('message', { data: 'session-updated' });
    socket.emit('message', { data: 'skip' });
    await Promise.resolve();

    expect(openCalls).toBe(1);
    expect(serverEvents).toEqual(['session-created']);

    socket.emit('error');
    socket.emit('close');
    expect(errorCalls).toBe(1);
    expect(closeCalls).toBe(1);

    cleanup();
    socket.emit('error');
    socket.emit('close');
    expect(errorCalls).toBe(1);
    expect(closeCalls).toBe(1);
  });
});

describe('RealtimeVoiceSocketController', () => {
  it('tracks the current socket, clears stale sockets safely, and closes the current socket', () => {
    const firstSocket = new FakeSocket();
    const secondSocket = new FakeSocket();
    const controller = new RealtimeVoiceSocketController();
    let firstCloseCalls = 0;
    let secondCloseCalls = 0;

    controller.bind(asSocket(firstSocket), {
      onOpen: () => undefined,
      onServerEvent: () => undefined,
      onError: () => undefined,
      onClose: () => {
        firstCloseCalls += 1;
      },
    });
    expect(controller.current).toBe(asSocket(firstSocket));
    expect(controller.isCurrent(asSocket(firstSocket))).toBe(true);

    controller.bind(asSocket(secondSocket), {
      onOpen: () => undefined,
      onServerEvent: () => undefined,
      onError: () => undefined,
      onClose: () => {
        secondCloseCalls += 1;
      },
    });
    firstSocket.emit('close');
    expect(firstCloseCalls).toBe(0);
    expect(controller.clear(asSocket(firstSocket))).toBe(false);
    expect(controller.current).toBe(asSocket(secondSocket));

    secondSocket.emit('close');
    expect(secondCloseCalls).toBe(1);

    controller.closeCurrent();
    expect(secondSocket.closeCalls).toBe(1);
    expect(controller.current).toBeNull();

    secondSocket.emit('close');
    expect(secondCloseCalls).toBe(1);
  });

  it('reports close errors without leaving a stale current socket', () => {
    const socket = new FakeSocket();
    const controller = new RealtimeVoiceSocketController();
    const closeError = new Error('close failed');
    let observedError: unknown = null;
    socket.closeError = closeError;

    controller.bind(asSocket(socket), {
      onOpen: () => undefined,
      onServerEvent: () => undefined,
      onError: () => undefined,
      onClose: () => undefined,
    });

    controller.closeCurrent((error) => {
      observedError = error;
    });

    expect(observedError).toBe(closeError);
    expect(controller.current).toBeNull();
  });
});

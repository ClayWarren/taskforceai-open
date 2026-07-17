import {
    isTerminalTaskStreamPayload,
    startTaskStream,
    type TaskStreamTransport,
} from '@taskforceai/client-runtime';
import { StreamingStoreAdapter } from '@taskforceai/react-core';
import EventSource, {
    type ErrorEvent,
    type ExceptionEvent,
    type MessageEvent as SSEMessageEvent,
    type TimeoutEvent,
} from 'react-native-sse';
import { getMobileAuthClient } from '../api/client';
import { getMobileBaseUrl } from '../config/base-url';
import { mobileEnv } from '../config/env';
import { createModuleLogger } from '../logger';
import { mobileMetrics } from '../observability/metrics';
import { reportOptionalLatencyMark } from '../observability/latency';
import {
    assertProductionDomain,
    assertProductionPinConfiguration,
} from '../security/certificate-pinning';

const logger = createModuleLogger('MobileStreamingAdapter');
const STALE_STREAM_TIMEOUT_MS = 60_000;

const clearTimer = (timer: ReturnType<typeof setTimeout>) => {
    if (typeof globalThis.clearTimeout === 'function') {
        globalThis.clearTimeout(timer);
    }
};

const createReactNativeSseTaskStreamTransport = (): TaskStreamTransport => ({
    connect: ({ url, signal, headers, onOpen, onMessage, onRecoverableError, onTerminalError, onClose }) => {
        const eventSource = new EventSource(url, { headers });
        let opened = false;
        let closed = false;
        let terminalMessageSeen = false;

        const closeSource = (reason: 'closed' | 'aborted') => {
            if (closed) return;
            closed = true;
            const closeReason = reason === 'aborted' && terminalMessageSeen ? 'closed' : reason;
            if (opened && terminalMessageSeen) {
                mobileMetrics.incrementCounter('streaming.sse.connection.closed', {
                    transport: 'sse',
                    outcome: 'terminal_message',
                });
            }
            eventSource.close();
            onClose({ reason: closeReason });
        };

        signal.addEventListener(
            'abort',
            () => {
                closeSource('aborted');
            },
            { once: true }
        );

        eventSource.addEventListener('open', () => {
            opened = true;
            onOpen();
        });

        eventSource.addEventListener('message', (event: SSEMessageEvent) => {
            if (!event?.data) return;
            terminalMessageSeen = terminalMessageSeen || isTerminalTaskStreamPayload(event.data);
            onMessage(event.data);
        });

        eventSource.addEventListener('error', (event: ErrorEvent | TimeoutEvent | ExceptionEvent) => {
            if (closed || signal.aborted) return;

            const readyState = 'readyState' in eventSource ? (eventSource as { readyState?: number }).readyState : undefined;
            const isClosed = readyState === 2; // EventSource.CLOSED is 2
            const isStartupFailure = !opened;
            const isTimeout = event.type === 'timeout';

            if (isClosed || isStartupFailure || isTimeout) {
                logger.error('Terminal streaming error', {
                    type: event.type,
                    message: 'message' in event ? event.message : undefined,
                    isClosed,
                    isStartupFailure,
                });
                onTerminalError(event);
                closeSource('closed');
                return;
            }

            logger.debug('Non-terminal streaming error, EventSource will retry', { type: event.type });
            onRecoverableError(event);
        });
    },
});

export const createMobileStreamingAdapter = (): StreamingStoreAdapter => {
    return {
        debug: __DEV__ && mobileEnv.flags.verboseStreaming,
        logger,
        reportLatencyMark: reportOptionalLatencyMark,
        connect: async (taskId, onMessage, onError, onOpen) => {
            const tokenRes = await getMobileAuthClient().getToken();
            const token = tokenRes.ok ? tokenRes.value : null;
            const baseUrl = getMobileBaseUrl();

            const url = `${baseUrl}/api/v1/stream/${taskId}`;
            assertProductionPinConfiguration();
            assertProductionDomain(url);
            const headers: Record<string, string> = {};
            if (token) {
                headers.Authorization = `Bearer ${token}`;
            }

            let staleTimer: ReturnType<typeof setTimeout> | null = null;
            const controller = new AbortController();

            const resetStaleTimer = () => {
                if (staleTimer) clearTimer(staleTimer);
                staleTimer = setTimeout(() => {
                    mobileMetrics.incrementCounter('streaming.sse.watchdog.timeout', {
                        transport: 'sse',
                        outcome: 'failed',
                    });
                    logger.warn('Stream stalled — no events received for 60s');
                    onError(new Error('Response interrupted — connection timed out'));
                    controller.abort();
                }, STALE_STREAM_TIMEOUT_MS);
            };

            resetStaleTimer();
            await startTaskStream({
                taskId,
                url,
                controller,
                transport: createReactNativeSseTaskStreamTransport(),
                handlers: { onMessage, onError, onOpen },
                metrics: mobileMetrics,
                headers,
                onMessageReceived: resetStaleTimer,
            });

            return () => {
                if (staleTimer) clearTimer(staleTimer);
                controller.abort();
                mobileMetrics.incrementCounter('streaming.sse.connection.closed', {
                    transport: 'sse',
                    outcome: 'client_disconnect',
                });
            };
        }
    }
}

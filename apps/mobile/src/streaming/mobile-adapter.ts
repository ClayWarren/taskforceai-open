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

const isTerminalStreamPayload = (data: string): boolean => {
    try {
        const payload = JSON.parse(data) as { type?: unknown };
        return payload.type === 'complete' || payload.type === 'error';
    } catch {
        return false;
    }
};

export const createMobileStreamingAdapter = (): StreamingStoreAdapter => {
    return {
        debug: __DEV__ && mobileEnv.flags.verboseStreaming,
        logger,
        connect: async (taskId, onMessage, onError, onOpen) => {
            const metricTags = { transport: 'sse' };
            mobileMetrics.incrementCounter('streaming.sse.connection.total', metricTags);
            const stopConnectionTimer = mobileMetrics.startTimer('streaming.sse.connection.duration', metricTags);
            let connectionFinished = false;
            const finishConnection = () => {
                if (connectionFinished) return;
                connectionFinished = true;
                stopConnectionTimer();
            };
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

            const eventSource = new EventSource(url, { headers });
            let staleTimer: ReturnType<typeof setTimeout> | null = null;
            let opened = false;
            let terminalMessageSeen = false;

            const resetStaleTimer = () => {
                if (staleTimer) clearTimer(staleTimer);
                staleTimer = setTimeout(() => {
                    mobileMetrics.incrementCounter('streaming.sse.watchdog.timeout', {
                        ...metricTags,
                        outcome: 'failed',
                    });
                    logger.warn('Stream stalled — no events received for 60s');
                    onError(new Error('Response interrupted — connection timed out'));
                    eventSource.close();
                    finishConnection();
                }, STALE_STREAM_TIMEOUT_MS);
            };

            eventSource.addEventListener('open', () => {
                opened = true;
                mobileMetrics.incrementCounter('streaming.sse.connection.opened', metricTags);
                onOpen?.();
                resetStaleTimer();
            });

            eventSource.addEventListener('message', (event: SSEMessageEvent) => {
                if (!event?.data) return;
                resetStaleTimer();
                mobileMetrics.incrementCounter('streaming.sse.message.received', metricTags);
                terminalMessageSeen = terminalMessageSeen || isTerminalStreamPayload(event.data);
                onMessage(event.data);
            });

            eventSource.addEventListener('error', (event: ErrorEvent | TimeoutEvent | ExceptionEvent) => {
                const readyState = 'readyState' in eventSource ? (eventSource as { readyState?: number }).readyState : undefined;
                const isClosed = readyState === 2; // EventSource.CLOSED is 2
                const isStartupFailure = !opened;
                const isTimeout = event.type === 'timeout';

                if (isClosed && opened && terminalMessageSeen) {
                    if (staleTimer) clearTimer(staleTimer);
                    mobileMetrics.incrementCounter('streaming.sse.connection.closed', {
                        ...metricTags,
                        outcome: 'terminal_message',
                    });
                    logger.debug('Ignoring close after terminal stream event', { type: event.type });
                    finishConnection();
                    return;
                }

                if (isClosed || isStartupFailure || isTimeout) {
                    if (staleTimer) clearTimer(staleTimer);
                    mobileMetrics.incrementCounter('streaming.sse.connection.failure', {
                        ...metricTags,
                        phase: isStartupFailure ? 'startup' : 'active',
                        type: event.type,
                    });
                    logger.error('Terminal streaming error', {
                        type: event.type,
                        message: 'message' in event ? event.message : undefined,
                        isClosed,
                        isStartupFailure
                    });
                    onError(event);
                    finishConnection();
                } else {
                    mobileMetrics.incrementCounter('streaming.sse.connection.lost', {
                        ...metricTags,
                        type: event.type,
                    });
                    logger.debug('Non-terminal streaming error, EventSource will retry', { type: event.type });
                }
            });

            resetStaleTimer();

            return () => {
                if (staleTimer) clearTimer(staleTimer);
                eventSource.close();
                mobileMetrics.incrementCounter('streaming.sse.connection.closed', {
                    ...metricTags,
                    outcome: 'client_disconnect',
                });
                finishConnection();
            };
        }
    }
}

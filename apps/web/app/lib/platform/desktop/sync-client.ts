'use client';

import {
  type BroadcastEvent,
  type ConversationSyncPayload,
  type DeletionRecord,
  type HttpSyncClientOptions,
  type MessageSyncPayload,
  type SyncClient,
  type SyncPullResponse,
  type SyncPushResponse,
  type SyncRequestOptions,
  createHttpSyncClient,
} from '@taskforceai/sync-client';

import { logger } from '../../logger';
import { invokeTauri } from './bridge';

type HttpSyncClient = ReturnType<typeof createHttpSyncClient>;

const forwardRealtime = (httpClient: HttpSyncClient, onEvent: (event: BroadcastEvent) => void) =>
  httpClient.connectRealtime(onEvent);

export const createDesktopSyncClient = (
  baseUrl: string,
  getToken: () => string | null,
  options: Pick<HttpSyncClientOptions, 'onUnauthorized' | 'getCsrfToken' | 'metrics'> = {}
): SyncClient => {
  const httpOptions: HttpSyncClientOptions = {};
  if (options.onUnauthorized) {
    httpOptions.onUnauthorized = options.onUnauthorized;
  }
  if (options.getCsrfToken) {
    httpOptions.getCsrfToken = options.getCsrfToken;
  }
  if (options.metrics) {
    httpOptions.metrics = options.metrics;
  }
  const httpClient = createHttpSyncClient(baseUrl, getToken, httpOptions);

  const invokeWithFallback = async <T>(
    command: string,
    payload: Record<string, unknown>,
    fallback: () => Promise<T>
  ): Promise<T> => {
    try {
      return await invokeTauri<T>(command, payload);
    } catch (error) {
      logger.warn('[desktop-sync] Falling back to HTTP sync - Tauri IPC failed', {
        command,
        error,
      });
      return fallback();
    }
  };

  return {
    pull(
      lastSyncVersion: number,
      deviceId: string,
      requestOptions?: SyncRequestOptions
    ): Promise<SyncPullResponse> {
      return invokeWithFallback('app_server_desktop_sync_pull', { lastSyncVersion, deviceId }, () =>
        httpClient.pull(lastSyncVersion, deviceId, requestOptions)
      );
    },

    push(
      conversations: ConversationSyncPayload[],
      messages: MessageSyncPayload[],
      deletions: DeletionRecord[],
      deviceId: string,
      requestOptions?: SyncRequestOptions
    ): Promise<SyncPushResponse> {
      return invokeWithFallback(
        'app_server_desktop_sync_push',
        { conversations, messages, deletions, deviceId },
        () => httpClient.push(conversations, messages, deletions, deviceId, requestOptions)
      );
    },

    getStatus(requestOptions?: SyncRequestOptions) {
      return httpClient.getStatus(requestOptions);
    },

    connectRealtime(onEvent: (event: BroadcastEvent) => void) {
      return forwardRealtime(httpClient, onEvent);
    },
  };
};

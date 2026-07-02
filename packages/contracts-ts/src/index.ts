/**
 * API Client Exports
 * Centralized exports for all API-related functionality
 */

// Core client
export { createApiClient, ApiClientError } from './client';
export type { ApiClient, ApiClientOptions } from './client';
export type { RunTaskAttachment } from './client';
export { getBrowserClient, setBrowserClient, clearBrowserClientCache } from './browserClient';
export type { AuthTokenPayload, MetricsCollector, TokenError, TokenResult } from './request';

// Auth
export * from './auth';

// Utilities
export { type Result, ok, err, isOk, isErr } from './utils/result';
export { parseJsonSchema, parseJsonValueSchema } from './utils/json';
export type { JsonParseError } from './utils/json';

// Type definitions & Schemas
export * from './contracts';

// React hooks (when using React)
export {
  useApi,
  useMutation,
  useConversations,
  useCurrentUser,
  useSubscription,
  useProducts,
  useRunTask,
  useDeleteConversation,
  useUpdateTheme,
  useCreateSubscription,
  useCancelSubscription,
  getErrorMessage,
  isApiError,
} from './hooks';
export type { UseApiState, UseApiResult, UseMutationResult } from './hooks';
export * from './auth/auth-client';
export * from './auth/auth-service';
export * from './auth/auth-storage';
export * from './auth/csrf';
export * from './api/status';
export * from './mocks';
export * from './services/issue-report';

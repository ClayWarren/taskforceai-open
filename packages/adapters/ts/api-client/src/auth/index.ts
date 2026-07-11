/**
 * Shared Auth Module
 *
 * Cross-platform authentication types, utilities, and client
 */

// Types
export * from './types';

// Utils
export * from './utils';

// Storage
export * from './storage';

// Client
export * from './client';
export * from './auth-client';
export * from './session-expiry';
export { configureAuthLogger } from './logger';

// Result
export * from '@taskforceai/client-core/result';

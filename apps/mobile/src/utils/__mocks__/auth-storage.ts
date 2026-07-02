import { jest } from '@jest/globals';
import type { AuthenticatedUser, SessionData } from '@taskforceai/contracts/auth';
import type { Result } from '@taskforceai/shared/result';

export const loadAuthSession = jest.fn<() => Promise<Result<SessionData>>>();
export const loadAuthToken = jest.fn<() => Promise<Result<string>>>();
export const loadStoredUser = jest.fn<() => Promise<Result<AuthenticatedUser | null>>>();
export const storeAuthSession = jest.fn<(session: SessionData) => Promise<Result<void>>>();
export const storeAuthToken = jest.fn<(token: string) => Promise<Result<void>>>();
export const storeUser = jest.fn<(user: AuthenticatedUser) => Promise<Result<void>>>();
export const clearAuthSession = jest.fn<() => Promise<Result<void>>>();
export const clearStoredUser = jest.fn<() => Promise<Result<void>>>();
export const clearAllAuthData = jest.fn<() => Promise<Result<void>>>();
export const clearAuthToken = jest.fn<() => Promise<void>>();

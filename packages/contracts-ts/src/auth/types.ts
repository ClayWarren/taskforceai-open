/**
 * Shared Auth Types
 *
 * Re-exports auth types from @taskforceai/contracts and adds auth-specific types
 */

// Re-export auth types from contracts
export type { AuthToken, AuthenticatedUser, Plan, Theme, Disabled } from '../contracts';

/**
 * Login response with user data
 */
export interface LoginSuccess {
  user: {
    id: string | number;
    email: string;
    fullName: string | null;
  };
}

/**
 * OAuth user data
 */
export interface OAuthUserData {
  email: string;
  displayName?: string | null;
  provider: 'google' | 'apple';
}

/**
 * Session data stored across platforms
 */
export interface SessionData {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number; // Unix timestamp
  user: {
    id: string | number;
    email: string;
    plan: 'free' | 'pro' | 'super' | 'admin';
  };
}

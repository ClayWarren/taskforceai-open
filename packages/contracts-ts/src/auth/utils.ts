import { emailSchema } from '@taskforceai/shared/validation';

export function isValidEmail(email: string): boolean {
  return emailSchema.safeParse(email).success;
}

/**
 * Check if token is expired
 */
export function isTokenExpired(expiresAt: number): boolean {
  return Date.now() >= expiresAt;
}

/**
 * Calculate token expiration time
 */
export function calculateTokenExpiry(expiresIn: number): number {
  return Date.now() + expiresIn * 1000;
}

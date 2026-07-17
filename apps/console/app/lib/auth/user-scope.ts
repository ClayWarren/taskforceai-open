import type { AuthenticatedUser } from '@taskforceai/contracts/contracts';
import { resolveUserCacheScope } from '@taskforceai/persistence/storage/cache-scope';

export const resolveConsoleUserScope = (
  user: Pick<AuthenticatedUser, 'email' | 'id'> | null | undefined
): string => resolveUserCacheScope(user ? { ok: true, value: user } : { ok: false });

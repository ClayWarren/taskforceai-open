import { desc } from 'drizzle-orm';
import { type Result, err, ok } from '@taskforceai/shared/result';
import type { SessionData } from '@taskforceai/contracts/auth';
import { clearAuthToken, getAuthToken, setAuthToken } from '../../auth/token-store';
import { resolveSessionExpiryMs } from '../../auth/token-expiry';
import { dbManager } from '../database-manager';
import { authSessions } from '../schema';
import type { ISessionStore } from '../storage-adapter';
import { withRepoResult } from '../utils';

export class SessionRepository implements ISessionStore {
  async getSession(): Promise<Result<SessionData>> {
    return withRepoResult('SessionRepository.getSession', async () => {
      const [db, token] = await Promise.all([
        dbManager.ensureOrm(),
        getAuthToken(),
      ]);

      const rows = await db
        .select()
        .from(authSessions)
        .orderBy(desc(authSessions.createdAt))
        .limit(1);

      const row = rows[0];

      if (!row || !token) {
        return err(new Error('No session found'));
      }

      const effectiveExpiresAt = resolveSessionExpiryMs(token, row.expiresAt);
      if (effectiveExpiresAt < Date.now()) {
        await this.clearSession();
        return err(new Error('Session expired'));
      }

      return ok({
        accessToken: token,
        expiresAt: effectiveExpiresAt,
        user: {
          id: row.userId,
          email: row.email,
          plan: (['admin', 'pro', 'super'].includes(row.plan) ? row.plan : 'free') as
            | 'admin'
            | 'free'
            | 'pro'
            | 'super',
        },
      });
    });
  }

  async setSession(session: SessionData): Promise<Result<void>> {
    return withRepoResult('SessionRepository.setSession', async () => {
      const db = await dbManager.ensureOrm();
      const resolvedExpiresAt = resolveSessionExpiryMs(session.accessToken, session.expiresAt);

      await db.transaction(async (tx) => {
        await tx.delete(authSessions);
        await tx.insert(authSessions).values({
          accessToken: 'KEYCHAIN_ONLY', // Placeholder to satisfy schema
          expiresAt: resolvedExpiresAt,
          userId: String(session.user.id ?? ''),
          email: session.user.email ?? '',
          plan: session.user.plan ?? 'free',
          createdAt: Date.now(),
        });
      });

      await setAuthToken(session.accessToken);

      return ok(undefined);
    });
  }

  async clearSession(): Promise<Result<void>> {
    return withRepoResult('SessionRepository.clearSession', async () => {
      const db = await dbManager.ensureOrm();
      await db.delete(authSessions);
      await clearAuthToken();
      return ok(undefined);
    });
  }
}

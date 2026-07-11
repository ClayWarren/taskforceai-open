/**
 * User Repository - Handles user profile storage in SQLite
 */
import { type Result, err, ok } from '@taskforceai/client-core/result';
import { parseJsonSchema } from '@taskforceai/client-core/json/parse';
import type { AuthenticatedUser } from '@taskforceai/contracts/contracts';
import { authenticatedUserSchema, planSchema } from '@taskforceai/contracts/contracts';
import { desc } from 'drizzle-orm';
import { z } from 'zod';
import { dbManager } from '../database-manager';
import { userProfiles } from '@taskforceai/db-sync/drizzle/schema';
import type { IUserProfileStore } from '../storage-adapter';
import { withRepoResult } from '../utils';
import { mobileLogger } from '../../logger';

const userExtraDataSchema = z.record(z.string(), z.unknown());

export class UserRepository implements IUserProfileStore {
  async loadProfile(): Promise<Result<AuthenticatedUser | null>> {
    return withRepoResult('UserRepository.loadProfile', async () => {
      const db = await dbManager.ensureOrm();
      const rows = await db
        .select()
        .from(userProfiles)
        .orderBy(desc(userProfiles.updatedAt))
        .limit(1);

      const row = rows[0];

      if (!row) {
        return ok(null);
      }

      const extraData = row.data
        ? parseJsonSchema(row.data, userExtraDataSchema)
        : ok<Record<string, unknown>>({});
      if (!extraData.ok) {
        return err(new Error('Stored user profile JSON is invalid'));
      }

      const planResult = planSchema.safeParse(row.plan);
      const validatedPlan = planResult.success ? planResult.data : 'free';

      const rawUser: any = {
        ...extraData.value,
        id: row.id,
        email: row.email,
        full_name: row.fullName,
        avatar_url: row.avatarUrl,
        plan: validatedPlan,
        subscription_status: row.subscriptionStatus,
        current_period_end: row.currentPeriodEnd,
        message_count: row.messageCount ?? 0,
        last_message_timestamp: row.lastMessageTimestamp,
      };

      // Normalize legacy persisted string flags at the storage adapter boundary.
      if (typeof rawUser.disabled === 'boolean') {
        rawUser.disabled = String(rawUser.disabled);
      }
      if (rawUser.is_admin === 'true' || rawUser.is_admin === 'false') {
        rawUser.is_admin = rawUser.is_admin === 'true';
      }

      const userResult = authenticatedUserSchema.safeParse(rawUser);
      if (!userResult.success) {
        mobileLogger.warn('Stored user profile failed validation, using defaults', {
          error: userResult.error.flatten(),
        });
        return ok(null);
      }

      return ok(userResult.data);
    });
  }

  async saveProfile(user: AuthenticatedUser): Promise<Result<void>> {
    return withRepoResult('UserRepository.saveProfile', async () => {
      const db = await dbManager.ensureOrm();

      // Separate known fields from extra data (avatar_url may come from API as extra)
      const {
        id,
        email,
        full_name,
        plan,
        subscription_status,
        current_period_end,
        message_count,
        last_message_timestamp,
        ...rest
      } = user;
      const avatarUrl =
        typeof rest === 'object' && rest !== null && 'avatar_url' in rest
          ? (rest as { avatar_url?: string | null }).avatar_url ?? null
          : null;

      await db
        .insert(userProfiles)
        .values({
          id,
          email,
          fullName: full_name ?? null,
          avatarUrl,
          plan: plan ?? 'free',
          subscriptionStatus: subscription_status ?? null,
          currentPeriodEnd: current_period_end ?? null,
          messageCount: message_count ?? 0,
          lastMessageTimestamp: last_message_timestamp ?? null,
          data: JSON.stringify(rest),
          updatedAt: Date.now(),
        })
        .onConflictDoUpdate({
          target: userProfiles.email,
          set: {
            id,
            fullName: full_name ?? null,
            avatarUrl,
            plan: plan ?? 'free',
            subscriptionStatus: subscription_status ?? null,
            currentPeriodEnd: current_period_end ?? null,
            messageCount: message_count ?? 0,
            lastMessageTimestamp: last_message_timestamp ?? null,
            data: JSON.stringify(rest),
            updatedAt: Date.now(),
          },
        });

      return ok(undefined);
    });
  }

  async clearProfile(): Promise<Result<void>> {
    return withRepoResult('UserRepository.clearProfile', async () => {
      const db = await dbManager.ensureOrm();
      await db.delete(userProfiles);
      return ok(undefined);
    });
  }
}

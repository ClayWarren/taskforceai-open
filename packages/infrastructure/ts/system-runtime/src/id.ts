import {
  toConversationId,
  toDeviceId,
  toMessageId,
  toSessionId,
  toTaskId,
} from '@taskforceai/client-core/branded';
import { createId as createCoreId } from '@taskforceai/client-core/utils/id';
import type { RNG } from '@taskforceai/client-core/random/rng';

import { systemRNG } from './rng';

export const createId = (prefix: string, rng: RNG = systemRNG): string => createCoreId(prefix, rng);

export const createConversationId = (rng: RNG = systemRNG) =>
  toConversationId(createId('conv', rng));
export const createMessageId = (role = 'msg', rng: RNG = systemRNG) =>
  toMessageId(createId(role, rng));
export const createDeviceId = (rng: RNG = systemRNG) => toDeviceId(createId('device', rng));
export const createTaskId = (rng: RNG = systemRNG) => toTaskId(createId('task', rng));
export const createSessionId = (rng: RNG = systemRNG) => toSessionId(createId('session', rng));

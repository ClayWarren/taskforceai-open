import { createPersistentConversationStore } from '@taskforceai/client-runtime';

import { logger } from '../../logger';
import { dexieStorage } from '../../storage/dexie-adapter';
import type { ConversationStore } from '../platform-interfaces';

export const createBrowserConversationStore = (): ConversationStore =>
  createPersistentConversationStore({
    adapter: dexieStorage,
    logger,
  });

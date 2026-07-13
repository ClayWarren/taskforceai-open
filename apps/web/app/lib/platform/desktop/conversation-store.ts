import { createPersistentConversationStore } from '@taskforceai/client-runtime';

import { logger } from '../../logger';
import { tauriStorage } from '../../storage/tauri-adapter';
import type { ConversationStore } from '../platform-interfaces';

export const createDesktopConversationStore = (): ConversationStore =>
  createPersistentConversationStore({
    adapter: tauriStorage,
    logger,
  });

import { createPersistentConversationStore } from '@taskforceai/client-runtime';

import { logger } from '@taskforceai/web/app/lib/logger';
import { tauriStorage } from '../storage/tauri-adapter';
import type { ConversationStore } from '@taskforceai/web/app/lib/platform/platform-interfaces';

export const createDesktopConversationStore = (): ConversationStore =>
  createPersistentConversationStore({
    adapter: tauriStorage,
    logger,
  });

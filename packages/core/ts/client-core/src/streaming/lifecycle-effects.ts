export interface StreamingLifecycleScope {
  isActive: () => boolean;
  resolveConversationId: () => Promise<string | null>;
}

export interface MessagePairIds {
  statusMessageId: string;
  contentMessageId: string;
}

export interface CreateStreamingPairOptions {
  scope: StreamingLifecycleScope;
  createIds: () => MessagePairIds;
  insertLocalPlaceholders: (ids: MessagePairIds) => void;
  persistPlaceholderPair: (conversationId: string, ids: MessagePairIds) => Promise<void>;
  rollbackLocalPlaceholders?: (
    ids: MessagePairIds,
    conversationId: string | null
  ) => void | Promise<void>;
  onReady: (ids: MessagePairIds) => void;
}

export async function createStreamingPair({
  scope,
  createIds,
  insertLocalPlaceholders,
  persistPlaceholderPair,
  rollbackLocalPlaceholders,
  onReady,
}: CreateStreamingPairOptions): Promise<MessagePairIds | null> {
  const ids = createIds();
  let conversationId: string | null = null;

  insertLocalPlaceholders(ids);

  try {
    conversationId = await scope.resolveConversationId();
    if (!scope.isActive() || !conversationId) {
      await rollbackLocalPlaceholders?.(ids, conversationId);
      return null;
    }

    await persistPlaceholderPair(conversationId, ids);

    if (!scope.isActive()) {
      await rollbackLocalPlaceholders?.(ids, conversationId);
      return null;
    }

    onReady(ids);
    return ids;
  } catch (error) {
    await rollbackLocalPlaceholders?.(ids, conversationId);
    throw error;
  }
}

export interface FinalizeStreamingPairOptions<TPayload> {
  scope: StreamingLifecycleScope;
  ids: MessagePairIds;
  payload: TPayload;
  applyLocalFinalState: (ids: MessagePairIds, payload: TPayload) => void;
  persistFinalState: (
    conversationId: string,
    ids: MessagePairIds,
    payload: TPayload
  ) => Promise<void>;
  onDone?: () => void | Promise<void>;
}

const persistWhileActive = async (
  scope: StreamingLifecycleScope,
  applyLocalState: (_conversationId: string) => void,
  persistState: (_conversationId: string) => Promise<void>,
  onDone?: () => void | Promise<void>
): Promise<boolean> => {
  const conversationId = await scope.resolveConversationId();
  if (!scope.isActive() || !conversationId) return false;

  applyLocalState(conversationId);
  if (!scope.isActive()) return false;

  await persistState(conversationId);
  if (!scope.isActive()) return false;

  await onDone?.();
  return true;
};

export async function finalizeStreamingPair<TPayload>({
  scope,
  ids,
  payload,
  applyLocalFinalState,
  persistFinalState,
  onDone,
}: FinalizeStreamingPairOptions<TPayload>): Promise<boolean> {
  return persistWhileActive(
    scope,
    () => applyLocalFinalState(ids, payload),
    (conversationId) => persistFinalState(conversationId, ids, payload),
    onDone
  );
}

export interface PersistStreamingErrorOptions {
  scope: StreamingLifecycleScope;
  contentMessageId: string;
  message: string;
  applyLocalError: (contentMessageId: string, message: string) => void;
  persistErrorState: (
    conversationId: string,
    contentMessageId: string,
    message: string
  ) => Promise<void>;
  onDone?: () => void | Promise<void>;
}

export async function persistStreamingError({
  scope,
  contentMessageId,
  message,
  applyLocalError,
  persistErrorState,
  onDone,
}: PersistStreamingErrorOptions): Promise<boolean> {
  return persistWhileActive(
    scope,
    () => applyLocalError(contentMessageId, message),
    (conversationId) => persistErrorState(conversationId, contentMessageId, message),
    onDone
  );
}

import type { MessageRole } from '@taskforceai/client-core/chat/types';
import type {
  AgentStatusSnapshot,
  SourceReference,
  ToolUsageEvent,
} from '@taskforceai/client-core/types';
import { sortedCopy } from '@taskforceai/client-core/utils/collection';
import type { ConflictInfo } from './manager-types';
import type { PendingChange } from '@taskforceai/persistence';
import type { SyncStorage } from '@taskforceai/persistence';
import type {
  ConversationSyncPayload,
  DeletionRecord,
  MessageSyncPayload,
  SyncPullResponse,
  SyncPushResponse,
} from './types';
import { getSyncLogger } from './logger';

const ts = (value: string): number => {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
};

const STORAGE_WRITE_BATCH_SIZE = 25;

const processInBatches = async <T>(
  items: readonly T[],
  batchSize: number,
  work: (item: T) => Promise<void>
): Promise<void> => {
  const runBatch = async (start: number): Promise<void> => {
    if (start >= items.length) {
      return;
    }

    const batch = items.slice(start, start + batchSize);
    await Promise.all(batch.map((item) => work(item)));
    await runBatch(start + batchSize);
  };

  await runBatch(0);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const readAliasedField = <T>(
  value: unknown,
  snakeCaseKey: string,
  camelCaseKey: string
): T | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  const snakeCaseValue = value[snakeCaseKey];
  if (snakeCaseValue !== undefined) {
    return snakeCaseValue as T;
  }
  const camelCaseValue = value[camelCaseKey];
  return camelCaseValue !== undefined ? (camelCaseValue as T) : undefined;
};

const toSyncVersion = (value: unknown): number => (typeof value === 'number' ? value : 0);

const toNonNegativeInteger = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.trunc(value));
};

const parseRemoteConversationID = (value: string): number | null => {
  const normalized = value.trim();
  if (normalized.length === 0) {
    return null;
  }
  if (/^\d+$/.test(normalized)) {
    return Number.parseInt(normalized, 10);
  }
  const remoteMatch = /^remote-(\d+)$/.exec(normalized);
  if (!remoteMatch) {
    return null;
  }
  return Number.parseInt(remoteMatch[1]!, 10);
};

const normalizeConversationEntityID = (entityID: string): string => {
  const remoteID = parseRemoteConversationID(entityID);
  if (remoteID !== null) {
    return String(remoteID);
  }
  return entityID;
};

const toIsoTimestamp = (value: unknown, fallback: number): string => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return new Date(parsed).toISOString();
    }
  }
  return new Date(fallback).toISOString();
};

const toNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const normalized = value.trim();
    if (/^\d+$/.test(normalized)) {
      const directParsed = Number.parseInt(normalized, 10);
      return directParsed;
    }
    const remoteMatch = /^remote-(\d+)$/.exec(normalized);
    if (remoteMatch) {
      return Number.parseInt(remoteMatch[1]!, 10);
    }
  }
  return null;
};

type InvalidPendingChangeReason =
  | 'invalid_message_data'
  | 'missing_message_id'
  | 'empty_message_content'
  | 'invalid_conversation_id';

export type InvalidPendingChange = {
  id: number;
  type: PendingChange['type'];
  entityId: string;
  reason: InvalidPendingChangeReason;
};

type MessagePayloadResult =
  | { ok: true; payload: MessageSyncPayload }
  | { ok: false; reason: InvalidPendingChangeReason };

const addOptionalMessagePayloadFields = (
  payload: MessageSyncPayload,
  fields: {
    conversation_local_id?: string;
    elapsed_seconds?: number;
    error?: string;
    sources?: unknown;
    tool_events?: unknown;
    agent_statuses?: unknown;
    trace?: unknown;
  }
): MessageSyncPayload => {
  if (fields.conversation_local_id !== undefined)
    payload.conversation_local_id = fields.conversation_local_id;
  if (fields.elapsed_seconds !== undefined) payload.elapsed_seconds = fields.elapsed_seconds;
  if (fields.error !== undefined) payload.error = fields.error;
  if (fields.sources !== undefined) payload.sources = fields.sources;
  if (fields.tool_events !== undefined) payload.tool_events = fields.tool_events;
  if (fields.agent_statuses !== undefined) payload.agent_statuses = fields.agent_statuses;
  if (fields.trace !== undefined) payload.trace = fields.trace;
  return payload;
};

const toDeletionType = (change: PendingChange): 'conversation' | 'message' => {
  if (change.type === 'message') {
    return 'message';
  }
  if (change.type === 'conversation') {
    return 'conversation';
  }
  if (!isRecord(change.data)) {
    return 'conversation';
  }
  const typeValue = change.data['type'];
  if (typeValue === 'message' || typeValue === 'conversation') {
    return typeValue;
  }
  const entityTypeValue = change.data['entityType'];
  if (entityTypeValue === 'message' || entityTypeValue === 'conversation') {
    return entityTypeValue;
  }
  return 'conversation';
};

const readBooleanAlias = (
  data: Record<string, unknown>,
  camelCaseKey: string,
  snakeCaseKey: string
): boolean => data[camelCaseKey] === true || data[snakeCaseKey] === true;

const toMessagePayload = (change: PendingChange, deviceId: string): MessagePayloadResult => {
  if (!isRecord(change.data)) {
    return { ok: false, reason: 'invalid_message_data' };
  }
  const messageIdRaw = change.data['messageId'];
  const message_id =
    typeof messageIdRaw === 'string' && messageIdRaw.length > 0 ? messageIdRaw : change.entityId;
  if (!message_id) {
    return { ok: false, reason: 'missing_message_id' };
  }
  const content = typeof change.data['content'] === 'string' ? change.data['content'] : '';
  const role = typeof change.data['role'] === 'string' ? change.data['role'] : 'assistant';
  const is_agent_status = readBooleanAlias(change.data, 'isAgentStatus', 'is_agent_status');
  const is_deleted = readBooleanAlias(change.data, 'isDeleted', 'is_deleted');
  if (!content && !is_agent_status && !is_deleted) {
    return { ok: false, reason: 'empty_message_content' };
  }
  const conversationRaw = change.data['conversationId'];
  const conversation_id = toNumber(conversationRaw);
  if (conversation_id === null || conversation_id <= 0) {
    return { ok: false, reason: 'invalid_conversation_id' };
  }
  const conversationLocalIdValue = change.data['conversationLocalId'];
  const conversation_local_id =
    typeof conversationLocalIdValue === 'string' && conversationLocalIdValue.length > 0
      ? conversationLocalIdValue
      : undefined;
  const now = Date.now();
  const created_at = toIsoTimestamp(change.data['createdAt'], change.createdAt);
  const updated_at = toIsoTimestamp(change.data['updatedAt'], now);
  const last_synced_at = toIsoTimestamp(change.data['lastSyncedAt'], now);
  const syncVersionRaw = change.data['syncVersion'];
  const sync_version = typeof syncVersionRaw === 'number' ? syncVersionRaw : 0;
  const is_streaming = readBooleanAlias(change.data, 'isStreaming', 'is_streaming');
  const elapsedSecondsRaw = change.data['elapsedSeconds'];
  const elapsed_seconds = typeof elapsedSecondsRaw === 'number' ? elapsedSecondsRaw : undefined;
  const errorRaw = change.data['error'];
  const error = typeof errorRaw === 'string' ? errorRaw : undefined;
  const sources = change.data['sources'];
  const tool_events = change.data['toolEvents'];
  const agent_statuses = change.data['agentStatuses'];
  const trace = change.data['traceId'] ?? change.data['trace_id'];
  const payload: MessageSyncPayload = {
    message_id,
    conversation_id,
    role,
    content,
    is_streaming,
    is_agent_status,
    created_at,
    sync_version,
    last_synced_at,
    device_id: deviceId,
    is_deleted,
    updated_at,
  };
  return {
    ok: true,
    payload: addOptionalMessagePayloadFields(payload, {
      conversation_local_id,
      elapsed_seconds,
      error,
      sources,
      tool_events,
      agent_statuses,
      trace,
    }),
  };
};

const toMessageRole = (role: string): MessageRole =>
  role === 'user' || role === 'assistant' || role === 'system' ? role : 'assistant';

const toSourceReferences = (value: unknown): SourceReference[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const items: SourceReference[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const url = typeof entry['url'] === 'string' ? entry['url'] : undefined;
    if (!url) continue;
    const title = typeof entry['title'] === 'string' ? entry['title'] : undefined;
    const snippet = typeof entry['snippet'] === 'string' ? entry['snippet'] : undefined;
    const next: SourceReference = { url };
    if (title !== undefined) next.title = title;
    if (snippet !== undefined) next.snippet = snippet;
    items.push(next);
  }
  return items.length > 0 ? items : undefined;
};

const toToolUsageEvents = (value: unknown): ToolUsageEvent[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const items: ToolUsageEvent[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const agentLabel = typeof entry['agentLabel'] === 'string' ? entry['agentLabel'] : undefined;
    const toolName = typeof entry['toolName'] === 'string' ? entry['toolName'] : undefined;
    const success = typeof entry['success'] === 'boolean' ? entry['success'] : undefined;
    const durationMs = typeof entry['durationMs'] === 'number' ? entry['durationMs'] : undefined;
    const argumentsValue = entry['arguments'];
    if (!agentLabel || !toolName || success === undefined || durationMs === undefined) continue;
    const next: ToolUsageEvent = {
      agentLabel,
      toolName,
      success,
      durationMs,
      arguments: argumentsValue,
    };
    if (typeof entry['timestamp'] === 'string') next.timestamp = entry['timestamp'];
    if (typeof entry['agentId'] === 'number') next.agentId = entry['agentId'];
    if (typeof entry['resultPreview'] === 'string') next.resultPreview = entry['resultPreview'];
    if (typeof entry['error'] === 'string') next.error = entry['error'];
    const sources = toSourceReferences(entry['sources']);
    if (sources !== undefined) next.sources = sources;
    items.push(next);
  }
  return items.length > 0 ? items : undefined;
};

const toAgentStatusSnapshots = (value: unknown): AgentStatusSnapshot[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const items: AgentStatusSnapshot[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const status = typeof entry['status'] === 'string' ? entry['status'] : undefined;
    if (!status) continue;
    const next: AgentStatusSnapshot = { status };
    if (typeof entry['agent_id'] === 'number') next.agent_id = entry['agent_id'];
    if (typeof entry['progress'] === 'number') next.progress = entry['progress'];
    if (typeof entry['result'] === 'string') next.result = entry['result'];
    if (typeof entry['reasoning'] === 'string') next.reasoning = entry['reasoning'];
    if (typeof entry['model'] === 'string') next.model = entry['model'];
    items.push(next);
  }
  return items.length > 0 ? items : undefined;
};

const hasTruncatedContent = (value: unknown): boolean =>
  isRecord(value) && (value['content_truncated'] === true || value['contentTruncated'] === true);

const hasLocalRecord = async <T>(load: () => Promise<{ ok: true; value: T } | { ok: false }>) => {
  try {
    const result = await load();
    return result.ok;
  } catch {
    return false;
  }
};

const stringOrEmpty = (value: unknown): string => (typeof value === 'string' ? value : '');

const pullTraceId = (trace: unknown): string | undefined => {
  if (typeof trace === 'string') return trace;
  return isRecord(trace) && typeof trace['id'] === 'string' ? trace['id'] : undefined;
};

export async function applyPullResponse(s: SyncStorage, r: SyncPullResponse) {
  const rawConversations = Array.isArray(r.conversations) ? r.conversations : [];
  const rawMessages = Array.isArray(r.messages) ? r.messages : [];
  const deletions = Array.isArray(r.deletions) ? r.deletions : [];
  let appliedConversations = 0;
  let appliedMessages = 0;
  let skippedExistingTruncatedConversations = 0;
  let skippedExistingTruncatedMessages = 0;

  const toConversationStorageId = (value: unknown): string => {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return `remote-${Math.trunc(value)}`;
    }
    if (typeof value !== 'string') {
      return '';
    }
    const normalized = value.trim();
    if (normalized.length === 0) {
      return '';
    }
    if (normalized.startsWith('remote-') || normalized.startsWith('local-')) {
      return normalized;
    }
    if (/^\d+$/.test(normalized)) {
      return `remote-${normalized}`;
    }
    return normalized;
  };

  await processInBatches(rawConversations, STORAGE_WRITE_BATCH_SIZE, async (c) => {
    const conversationId = readAliasedField<number | string>(c, 'id', 'id');
    const isDeleted = readAliasedField<boolean>(c, 'is_deleted', 'isDeleted') === true;
    if (isDeleted) {
      const deletionId = toConversationStorageId(conversationId);
      if (deletionId.length > 0) {
        await s.deleteConversation(deletionId);
      }
      return;
    }
    const storageConversationId = toConversationStorageId(conversationId);
    if (storageConversationId.length === 0) {
      return;
    }
    if (
      hasTruncatedContent(c) &&
      (await hasLocalRecord(() => s.getConversation(storageConversationId)))
    ) {
      skippedExistingTruncatedConversations += 1;
      return;
    }
    const userInput = readAliasedField<string>(c, 'user_input', 'userInput');
    const timestamp = readAliasedField<string>(c, 'timestamp', 'timestamp');
    const updatedAt = readAliasedField<string>(c, 'updated_at', 'updatedAt');
    const syncVersion = toSyncVersion(readAliasedField<number>(c, 'sync_version', 'syncVersion'));
    const lastSyncedAt = readAliasedField<string>(c, 'last_synced_at', 'lastSyncedAt');
    const result = readAliasedField<string>(c, 'result', 'result');
    const deviceId = readAliasedField<string>(c, 'device_id', 'deviceId');
    const isArchived = readAliasedField<boolean>(c, 'is_archived', 'isArchived') === true;
    await s.upsertConversation({
      conversationId: storageConversationId,
      title:
        typeof userInput === 'string' && userInput.length > 0
          ? userInput.slice(0, 120)
          : 'Remote Conversation',
      createdAt: ts(typeof timestamp === 'string' ? timestamp : ''),
      updatedAt: ts(typeof updatedAt === 'string' ? updatedAt : ''),
      syncVersion,
      lastSyncedAt: ts(typeof lastSyncedAt === 'string' ? lastSyncedAt : ''),
      isDeleted,
      isArchived,
      ...(typeof result === 'string' && {
        lastMessagePreview: result.slice(0, 240),
      }),
      ...(typeof deviceId === 'string' && deviceId.length > 0 && { deviceId }),
    });
    appliedConversations += 1;
  });

  await processInBatches(rawMessages, STORAGE_WRITE_BATCH_SIZE, async (m) => {
    const messageId = readAliasedField<string>(m, 'message_id', 'messageId');
    if (!messageId) {
      return;
    }
    const isDeleted = readAliasedField<boolean>(m, 'is_deleted', 'isDeleted') === true;
    if (isDeleted) {
      await s.deleteMessage(messageId);
      return;
    }
    const conversationId = readAliasedField<number>(m, 'conversation_id', 'conversationId');
    if (typeof conversationId !== 'number') {
      return;
    }
    if (hasTruncatedContent(m) && (await hasLocalRecord(() => s.getMessage(messageId)))) {
      skippedExistingTruncatedMessages += 1;
      return;
    }
    const sources = toSourceReferences(readAliasedField<unknown>(m, 'sources', 'sources'));
    const toolEvents = toToolUsageEvents(readAliasedField<unknown>(m, 'tool_events', 'toolEvents'));
    const agentStatuses = toAgentStatusSnapshots(
      readAliasedField<unknown>(m, 'agent_statuses', 'agentStatuses')
    );
    const content = readAliasedField<string>(m, 'content', 'content');
    const role = readAliasedField<string>(m, 'role', 'role');
    const isStreaming = readAliasedField<boolean>(m, 'is_streaming', 'isStreaming') === true;
    const isAgentStatus = readAliasedField<boolean>(m, 'is_agent_status', 'isAgentStatus') === true;
    const createdAt = readAliasedField<string>(m, 'created_at', 'createdAt');
    const updatedAt = readAliasedField<string>(m, 'updated_at', 'updatedAt');
    const syncVersion = toSyncVersion(readAliasedField<number>(m, 'sync_version', 'syncVersion'));
    const lastSyncedAt = readAliasedField<string>(m, 'last_synced_at', 'lastSyncedAt');
    const elapsedSeconds = readAliasedField<number>(m, 'elapsed_seconds', 'elapsedSeconds');
    const error = readAliasedField<string>(m, 'error', 'error');
    const deviceId = readAliasedField<string>(m, 'device_id', 'deviceId');
    const trace = readAliasedField<unknown>(m, 'trace', 'trace');
    const traceId = pullTraceId(trace);

    await s.upsertMessage({
      messageId,
      conversationId: `remote-${conversationId}`,
      content: stringOrEmpty(content),
      role: toMessageRole(typeof role === 'string' ? role : 'assistant'),
      isStreaming,
      isAgentStatus,
      createdAt: ts(stringOrEmpty(createdAt)),
      updatedAt: ts(stringOrEmpty(updatedAt)),
      ...(sources && { sources }),
      ...(toolEvents && { toolEvents }),
      ...(agentStatuses && { agentStatuses }),
      syncVersion,
      lastSyncedAt: ts(stringOrEmpty(lastSyncedAt)),
      isDeleted,
      ...(typeof elapsedSeconds === 'number' && { elapsedSeconds }),
      ...(typeof error === 'string' && error.length > 0 && { error }),
      ...(typeof deviceId === 'string' && deviceId.length > 0 && { deviceId }),
      ...(traceId !== undefined && { traceId }),
    });
    appliedMessages += 1;
  });

  if (skippedExistingTruncatedConversations > 0 || skippedExistingTruncatedMessages > 0) {
    getSyncLogger().warn('Skipped existing compacted sync pull records', {
      conversations: skippedExistingTruncatedConversations,
      messages: skippedExistingTruncatedMessages,
      latestVersion:
        readAliasedField<number>(r, 'latest_version', 'latestVersion') ?? r.latest_version,
    });
  }

  await processInBatches(deletions, STORAGE_WRITE_BATCH_SIZE, async (d) => {
    if (d.type === 'conversation') {
      const deletionId = toConversationStorageId(d.id);
      if (deletionId.length > 0) {
        await s.deleteConversation(deletionId);
      }
      return;
    }
    if (d.type === 'message') {
      await s.deleteMessage(d.id);
    }
  });
  const latestVersionValue = toNonNegativeInteger(
    readAliasedField<number>(r, 'latest_version', 'latestVersion') ?? r.latest_version
  );
  const currentVersion = toNonNegativeInteger(await s.getLastSyncVersion());
  await s.setLastSyncVersion(Math.max(currentVersion, latestVersionValue));
  return {
    conversations: appliedConversations,
    messages: appliedMessages,
    deletions: deletions.length,
  };
}

const toInvalidPendingChange = (
  change: PendingChange,
  reason: InvalidPendingChangeReason
): InvalidPendingChange | null => {
  if (typeof change.id !== 'number') {
    return null;
  }
  return {
    id: change.id,
    type: change.type,
    entityId: change.entityId,
    reason,
  };
};

export async function buildPushPayload(p: PendingChange[], devId: string) {
  const c: ConversationSyncPayload[] = [],
    m: MessageSyncPayload[] = [],
    d: DeletionRecord[] = [];
  const invalidPendingChanges: InvalidPendingChange[] = [];
  const syncTimestamp = new Date().toISOString();
  for (const ch of p) {
    if (ch.type === 'prompt') {
      continue;
    }
    if (ch.type === 'deletion' || ch.operation === 'delete') {
      d.push({
        type: toDeletionType(ch),
        id: ch.entityId,
        deleted_at: new Date(ch.createdAt).toISOString(),
      });
      continue;
    }
    if (ch.type === 'conversation') {
      const remoteConversationID = parseRemoteConversationID(ch.entityId);
      const conversationData = isRecord(ch.data) ? ch.data : {};
      const prompt =
        typeof conversationData['prompt'] === 'string' ? conversationData['prompt'] : '';
      c.push({
        timestamp: new Date(ch.createdAt).toISOString(),
        user_input: prompt,
        sync_version: 0,
        last_synced_at: syncTimestamp,
        device_id: devId,
        is_deleted: false,
        ...(conversationData['isArchived'] === true || conversationData['is_archived'] === true
          ? { is_archived: true }
          : {}),
        updated_at: syncTimestamp,
        ...(remoteConversationID !== null
          ? { id: remoteConversationID }
          : { local_id: ch.entityId }),
      });
      continue;
    }
    if (ch.type === 'message') {
      const result = toMessagePayload(ch, devId);
      if (result.ok) {
        m.push(result.payload);
      } else {
        const invalid = toInvalidPendingChange(ch, result.reason);
        if (invalid) {
          invalidPendingChanges.push(invalid);
        }
      }
    }
  }
  return { conversations: c, messages: m, deletions: d, invalidPendingChanges };
}

export const mapConflicts = (r: SyncPushResponse): ConflictInfo[] =>
  r.conflicts.map((c) => ({
    type: c.type,
    id: c.id,
    localVersion:
      readAliasedField<number>(c, 'client_version', 'clientVersion') ?? c.client_version ?? 0,
    serverVersion:
      readAliasedField<number>(c, 'server_version', 'serverVersion') ?? c.server_version ?? 0,
    reason: c.reason ?? '',
  }));

export async function applyConversationIdMappings(
  s: SyncStorage,
  m: Record<string, number | string> | null | undefined
) {
  const entries = m && typeof m === 'object' ? Object.entries(m) : [];
  await processInBatches(entries, STORAGE_WRITE_BATCH_SIZE, async ([localId, serverIdRaw]) => {
    if (typeof serverIdRaw !== 'number' && typeof serverIdRaw !== 'string') {
      return;
    }
    const serverId = String(serverIdRaw);
    const remoteId = `remote-${serverId}`;
    if (localId === remoteId) {
      return;
    }
    if (localId.startsWith('remote-')) {
      return;
    }
    await s.replaceConversationId(localId, remoteId);
  });
}

export async function applyPendingMessageConversationMappings(
  s: SyncStorage,
  p: PendingChange[],
  m: Record<string, number | string> | null | undefined
): Promise<Set<number>> {
  const mappings = m && typeof m === 'object' ? m : {};
  const updatedIDs = new Set<number>();

  await processInBatches(p, STORAGE_WRITE_BATCH_SIZE, async (change) => {
    if (change.type !== 'message' || typeof change.id !== 'number' || !isRecord(change.data)) {
      return;
    }
    const conversationRaw = change.data['conversationId'];
    if (typeof conversationRaw !== 'string' || toNumber(conversationRaw) !== null) {
      return;
    }
    const serverIdRaw = mappings[conversationRaw];
    if (typeof serverIdRaw !== 'number' && typeof serverIdRaw !== 'string') {
      return;
    }
    const serverId = String(serverIdRaw);
    const nextData = {
      ...change.data,
      conversationId: `remote-${serverId}`,
      conversationLocalId:
        typeof change.data['conversationLocalId'] === 'string' &&
        change.data['conversationLocalId'].length > 0
          ? change.data['conversationLocalId']
          : conversationRaw,
    };
    await s.updatePendingChangeData(change.id, nextData);
    updatedIDs.add(change.id);
  });

  return updatedIDs;
}

export async function clearInvalidPendingChanges(
  s: SyncStorage,
  invalid: InvalidPendingChange[],
  retainedIds: Set<number> = new Set()
) {
  const removedIDs = new Set<number>();

  /* eslint-disable no-await-in-loop -- Pending cleanup needs deterministic ordering and dedupe tracking. */
  for (const change of invalid) {
    if (retainedIds.has(change.id) || removedIDs.has(change.id)) {
      continue;
    }
    await s.removePendingChange(change.id);
    removedIDs.add(change.id);
  }
  /* eslint-enable no-await-in-loop */
}

export async function clearAcceptedPendingChanges(s: SyncStorage, p: PendingChange[], a: string[]) {
  type PendingRemovalCandidate = {
    id: number;
    type: string;
    order: number;
  };

  const conversationCandidates = new Map<string, PendingRemovalCandidate[]>();
  const typedCandidates = new Map<string, PendingRemovalCandidate[]>();
  const untypedCandidates = new Map<string, PendingRemovalCandidate[]>();

  const appendCandidate = (
    index: Map<string, PendingRemovalCandidate[]>,
    key: string,
    candidate: PendingRemovalCandidate
  ): void => {
    const entries = index.get(key);
    if (entries) {
      entries.push(candidate);
      return;
    }
    index.set(key, [candidate]);
  };

  for (const [order, change] of p.entries()) {
    if (change.type === 'prompt' || typeof change.id !== 'number') {
      continue;
    }

    const candidate = {
      id: change.id,
      type: change.type,
      order,
    };
    if (change.type === 'deletion' || change.operation === 'delete') {
      appendCandidate(typedCandidates, `deletion:${change.entityId}`, candidate);
      if (change.type === 'conversation') {
        appendCandidate(
          typedCandidates,
          `deletion:${normalizeConversationEntityID(change.entityId)}`,
          candidate
        );
      }
    }
    if (change.type === 'conversation') {
      const entityKey = normalizeConversationEntityID(change.entityId);
      appendCandidate(conversationCandidates, entityKey, candidate);
      appendCandidate(typedCandidates, `conversation:${entityKey}`, candidate);
      continue;
    }
    appendCandidate(typedCandidates, `${change.type}:${change.entityId}`, candidate);
    appendCandidate(untypedCandidates, change.entityId, candidate);
  }

  const getUntypedCandidates = (entityId: string): PendingRemovalCandidate[] => {
    const conversationMatches = conversationCandidates.get(normalizeConversationEntityID(entityId));
    const directMatches = untypedCandidates.get(entityId);
    if (!conversationMatches) {
      return directMatches ?? [];
    }
    if (!directMatches) {
      return conversationMatches;
    }
    return sortedCopy(
      [...conversationMatches, ...directMatches],
      (left, right) => left.order - right.order
    );
  };

  const hasAmbiguousPendingTypes = (candidates: PendingRemovalCandidate[]): boolean => {
    let firstType: string | null = null;
    for (const candidate of candidates) {
      if (firstType === null) {
        firstType = candidate.type;
        continue;
      }
      if (candidate.type !== firstType) {
        return true;
      }
    }
    return false;
  };

  const removedIDs = new Set<number>();
  /* eslint-disable no-await-in-loop -- Pending cleanup order depends on deterministic iteration with dedupe tracking. */
  for (const acceptedId of a) {
    const separatorIndex = acceptedId.indexOf(':');
    const hasTypePrefix = separatorIndex > 0 && separatorIndex < acceptedId.length - 1;
    const acceptedType = hasTypePrefix ? acceptedId.slice(0, separatorIndex) : '';
    const entityId = hasTypePrefix ? acceptedId.slice(separatorIndex + 1) : acceptedId;

    const candidates = hasTypePrefix
      ? (typedCandidates.get(
          `${acceptedType}:${
            acceptedType === 'conversation' ? normalizeConversationEntityID(entityId) : entityId
          }`
        ) ?? [])
      : getUntypedCandidates(entityId);

    if (!hasTypePrefix && hasAmbiguousPendingTypes(candidates)) {
      continue;
    }

    for (const candidate of candidates) {
      if (removedIDs.has(candidate.id)) {
        continue;
      }
      await s.removePendingChange(candidate.id);
      removedIDs.add(candidate.id);
    }
  }
  /* eslint-enable no-await-in-loop */
}

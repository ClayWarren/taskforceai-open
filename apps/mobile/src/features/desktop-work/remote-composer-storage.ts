import AsyncStorage from '@react-native-async-storage/async-storage';
import * as React from 'react';
import { z } from 'zod';

import { dbManager } from '../../storage/database-manager';

export type RemotePermissionProfile = 'read_only' | 'workspace_write' | 'full_access';

export type RemoteComposerDraft = {
  input: string;
  planMode: boolean;
  permissionProfile: RemotePermissionProfile;
};

export type RemoteTurnOutboxItem = {
  id: string;
  threadId: string;
  input: string;
  modelId: string | null;
  reasoningEffort: string | null;
  attachmentIds: string[];
  planMode: boolean;
  permissionProfile: RemotePermissionProfile;
  createdAt: number;
};

export type RemoteThreadCreationOutboxItem = {
  id: string;
  hostId: string | null;
  input: string;
  taskMode: 'chat' | 'code';
  projectId: number | null;
  workspaceRoot: string | null;
  modelId: string | null;
  reasoningEffort: string | null;
  attachmentIds: string[];
  planMode: boolean;
  permissionProfile: RemotePermissionProfile;
  createdAt: number;
};

const permissionProfileSchema = z.enum(['read_only', 'workspace_write', 'full_access']);
const draftSchema = z.object({
  input: z.string(),
  planMode: z.boolean(),
  permissionProfile: permissionProfileSchema,
});
const outboxItemSchema = z.object({
  id: z.string().min(1),
  threadId: z.string().min(1),
  input: z.string().min(1),
  modelId: z.string().nullable(),
  reasoningEffort: z.string().nullable(),
  attachmentIds: z.array(z.string()),
  planMode: z.boolean(),
  permissionProfile: permissionProfileSchema,
  createdAt: z.number(),
});
const creationOutboxItemSchema = z.object({
  id: z.string().min(1),
  hostId: z.string().nullable(),
  input: z.string().min(1),
  taskMode: z.enum(['chat', 'code']),
  projectId: z.number().int().positive().nullable(),
  workspaceRoot: z.string().nullable(),
  modelId: z.string().nullable(),
  reasoningEffort: z.string().nullable(),
  attachmentIds: z.array(z.string()),
  planMode: z.boolean(),
  permissionProfile: permissionProfileSchema,
  createdAt: z.number(),
});
const stateSchema = z.object({
  version: z.literal(2),
  drafts: z.record(z.string(), draftSchema),
  outbox: z.array(outboxItemSchema),
  creations: z.array(creationOutboxItemSchema),
});
const legacyStateSchema = z.object({
  version: z.literal(1),
  drafts: z.record(z.string(), draftSchema),
  outbox: z.array(outboxItemSchema),
});

type RemoteComposerState = z.infer<typeof stateSchema>;

const ENCRYPTED_STORAGE_KEY = 'remote-composer:v2';
const LEGACY_STORAGE_KEY = '@taskforceai:remote-composer:v1';
export const DEFAULT_REMOTE_COMPOSER_DRAFT: RemoteComposerDraft = {
  input: '',
  planMode: false,
  permissionProfile: 'full_access',
};

const emptyState = (): RemoteComposerState => ({ version: 2, drafts: {}, outbox: [], creations: [] });

let storageQueue: Promise<unknown> = Promise.resolve();

const parseState = (raw: string): RemoteComposerState | null => {
  try {
    const value = JSON.parse(raw);
    const current = stateSchema.safeParse(value);
    if (current.success) return current.data;
    const legacy = legacyStateSchema.safeParse(value);
    return legacy.success ? { ...legacy.data, version: 2, creations: [] } : null;
  } catch {
    return null;
  }
};

const readEncryptedState = async (): Promise<RemoteComposerState | null> => {
  const db = await dbManager.ensureRawDb();
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM metadata WHERE key = ?',
    [ENCRYPTED_STORAGE_KEY]
  );
  return row ? parseState(row.value) : null;
};

const writeEncryptedState = async (state: RemoteComposerState): Promise<void> => {
  const db = await dbManager.ensureRawDb();
  await db.runAsync(
    'INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)',
    [ENCRYPTED_STORAGE_KEY, JSON.stringify(state)]
  );
};

const readState = async (): Promise<RemoteComposerState> => {
  const encrypted = await readEncryptedState();
  if (encrypted) return encrypted;

  const legacyRaw = await AsyncStorage.getItem(LEGACY_STORAGE_KEY);
  if (!legacyRaw) return emptyState();
  const legacy = parseState(legacyRaw);
  if (!legacy) {
    await AsyncStorage.removeItem(LEGACY_STORAGE_KEY);
    return emptyState();
  }

  await writeEncryptedState(legacy);
  await AsyncStorage.removeItem(LEGACY_STORAGE_KEY);
  return legacy;
};

const updateState = async (
  update: (state: RemoteComposerState) => RemoteComposerState
): Promise<RemoteComposerState> => {
  const operation = storageQueue.then(async () => {
    const next = update(await readState());
    await writeEncryptedState(next);
    return next;
  });
  storageQueue = operation.catch(() => undefined);
  return operation;
};

export const readRemoteDraft = async (scope: string): Promise<RemoteComposerDraft> => {
  const draft = (await readState()).drafts[scope];
  return draft ? { ...draft } : { ...DEFAULT_REMOTE_COMPOSER_DRAFT };
};

export const writeRemoteDraft = async (
  scope: string,
  draft: RemoteComposerDraft
): Promise<void> => {
  await updateState((state) => ({
    ...state,
    drafts: { ...state.drafts, [scope]: draftSchema.parse(draft) },
  }));
};

export const removeRemoteDraft = async (scope: string): Promise<void> => {
  await updateState((state) => {
    const drafts = { ...state.drafts };
    delete drafts[scope];
    return { ...state, drafts };
  });
};

export const enqueueRemoteTurn = async (item: RemoteTurnOutboxItem): Promise<void> => {
  await updateState((state) => ({
    ...state,
    outbox: state.outbox.some((candidate) => candidate.id === item.id)
      ? state.outbox
      : [...state.outbox, outboxItemSchema.parse(item)],
  }));
};

export const removeRemoteTurn = async (id: string): Promise<void> => {
  await updateState((state) => ({
    ...state,
    outbox: state.outbox.filter((item) => item.id !== id),
  }));
};

export const readRemoteTurnOutbox = async (
  threadId?: string
): Promise<RemoteTurnOutboxItem[]> => {
  const items = (await readState()).outbox;
  return items
    .filter((item) => !threadId || item.threadId === threadId)
    .toSorted((left, right) => left.createdAt - right.createdAt);
};

export const enqueueRemoteThreadCreation = async (
  item: RemoteThreadCreationOutboxItem
): Promise<void> => {
  await updateState((state) => ({
    ...state,
    creations: state.creations.some((candidate) => candidate.id === item.id)
      ? state.creations
      : [...state.creations, creationOutboxItemSchema.parse(item)],
  }));
};

export const removeRemoteThreadCreation = async (id: string): Promise<void> => {
  await updateState((state) => ({
    ...state,
    creations: state.creations.filter((item) => item.id !== id),
  }));
};

export const readRemoteThreadCreationOutbox = async (
  hostId?: string | null
): Promise<RemoteThreadCreationOutboxItem[]> => {
  const items = (await readState()).creations;
  return items
    .filter((item) => hostId === undefined || item.hostId === hostId)
    .toSorted((left, right) => left.createdAt - right.createdAt);
};

export const createRemoteOutboxId = (): string =>
  `mobile-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

export const REMOTE_PLAN_INSTRUCTION =
  'Planning mode is enabled for this turn. Analyze and propose a concrete plan only. You may inspect or search read-only sources, but do not edit files, run mutating commands, call mutating tools, or make external changes. Ask for approval before implementation.';

export const remoteTurnInput = (input: string, planMode: boolean): string =>
  planMode ? `${REMOTE_PLAN_INSTRUCTION}\n\nUser request:\n${input}` : input;

export function useRemoteComposerDraft(scope: string) {
  const [draft, setDraft] = React.useState<RemoteComposerDraft>(DEFAULT_REMOTE_COMPOSER_DRAFT);
  const [hydrated, setHydrated] = React.useState(false);

  React.useEffect(() => {
    let active = true;
    setHydrated(false);
    setDraft(DEFAULT_REMOTE_COMPOSER_DRAFT);
    void readRemoteDraft(scope).then((stored) => {
      if (!active) return;
      setDraft(stored);
      setHydrated(true);
    }).catch(() => {
      if (active) setHydrated(true);
    });
    return () => {
      active = false;
    };
  }, [scope]);

  React.useEffect(() => {
    if (!hydrated) return;
    const timer = globalThis.setTimeout(() => void writeRemoteDraft(scope, draft), 250);
    return () => globalThis.clearTimeout(timer);
  }, [draft, hydrated, scope]);

  const clear = React.useCallback(() => {
    setDraft(DEFAULT_REMOTE_COMPOSER_DRAFT);
    void removeRemoteDraft(scope);
  }, [scope]);

  const setInput = React.useCallback((value: React.SetStateAction<string>) => {
    setDraft((current) => ({
      ...current,
      input: typeof value === 'function' ? value(current.input) : value,
    }));
  }, []);

  const setPlanMode = React.useCallback((planMode: boolean) => {
    setDraft((current) => ({ ...current, planMode }));
  }, []);

  const setPermissionProfile = React.useCallback(
    (permissionProfile: RemotePermissionProfile) => {
      setDraft((current) => ({ ...current, permissionProfile }));
    },
    []
  );

  return { draft, setInput, setPlanMode, setPermissionProfile, clear, hydrated };
}

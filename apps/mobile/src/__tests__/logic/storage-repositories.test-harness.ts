import { mock } from 'bun:test';

type SelectPlan = {
  rows?: unknown[];
  throwAtWhere?: Error;
  sortByUpdatedAtDesc?: boolean;
};

type SelectRecord = {
  whereCalled: boolean;
  orderByCalled: boolean;
  limit?: number;
  offset?: number;
};

export const ormState = {
  selectPlans: [] as SelectPlan[],
  selectRecords: [] as SelectRecord[],
  insertValues: [] as Array<{ table: unknown; payload: Record<string, unknown> }>,
  insertConflictSets: [] as Array<{ table: unknown; payload: Record<string, unknown> }>,
  insertReturningQueue: [] as unknown[][],
  updateSets: [] as Array<{ table: unknown; payload: Record<string, unknown> }>,
  updateWhereCount: 0,
  deleteTables: [] as unknown[],
  deleteWhereCount: 0,
  transactionCalls: 0,
  queryMessageRow: undefined as unknown,
};

export const dbManagerState = {
  ensureOrmCalls: 0,
};

export const asyncStorageState = {
  values: new Map<string, string>(),
  throwOnGet: null as Error | null,
  setCalls: [] as Array<{ key: string; value: string }>,
};

export const secureStoreState = {
  token: null as string | null,
  throwOnGet: null as Error | null,
  setCalls: [] as Array<{ key: string; value: string }>,
  deleteCalls: [] as string[],
};

export const makeJwtWithExp = (expSeconds: number): string => {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ exp: expSeconds })).toString('base64url');
  return `${header}.${payload}.signature`;
};

const getUpdatedAt = (row: unknown): number =>
  typeof row === 'object' && row !== null && 'updatedAt' in row
    ? (((row as { updatedAt?: unknown }).updatedAt as number | undefined) ?? 0)
    : 0;

const createSelectBuilder = (plan: SelectPlan, record: SelectRecord): any => {
  const resolveRows = async (): Promise<unknown[]> => {
    const rows = plan.rows ?? [];
    return plan.sortByUpdatedAtDesc && record.orderByCalled
      ? rows.toSorted((left, right) => getUpdatedAt(right) - getUpdatedAt(left))
      : rows;
  };
  const builder = Promise.resolve().then(resolveRows) as any;
  builder.from = () => builder;
  builder.where = () => {
    record.whereCalled = true;
    if (plan.throwAtWhere) throw plan.throwAtWhere;
    return builder;
  };
  builder.orderBy = () => {
    record.orderByCalled = true;
    return builder;
  };
  builder.limit = (value: number) => {
    record.limit = value;
    return builder;
  };
  builder.offset = async (value: number) => {
    record.offset = value;
    return resolveRows();
  };
  return builder;
};

const createInsertBuilder = (table: unknown): any => ({
  values: (payload: Record<string, unknown>) => {
    ormState.insertValues.push({ table, payload });
    const chain = Promise.resolve() as any;
    chain.onConflictDoUpdate = ({ set }: { set: Record<string, unknown> }) => {
      ormState.insertConflictSets.push({ table, payload: set });
      return Promise.resolve();
    };
    chain.returning = async () => ormState.insertReturningQueue.shift() ?? [];
    return chain;
  },
});

const createUpdateBuilder = (table: unknown): any => ({
  set: (payload: Record<string, unknown>) => {
    ormState.updateSets.push({ table, payload });
    const chain = Promise.resolve() as any;
    chain.where = async () => {
      ormState.updateWhereCount += 1;
    };
    return chain;
  },
});

const createDeleteBuilder = (table: unknown): any => {
  ormState.deleteTables.push(table);
  const chain = Promise.resolve() as any;
  chain.where = async () => {
    ormState.deleteWhereCount += 1;
  };
  return chain;
};

const orm = {
  select: () => {
    const record: SelectRecord = { whereCalled: false, orderByCalled: false };
    ormState.selectRecords.push(record);
    return createSelectBuilder(ormState.selectPlans.shift() ?? {}, record);
  },
  insert: (table: unknown) => createInsertBuilder(table),
  update: (table: unknown) => createUpdateBuilder(table),
  delete: (table: unknown) => createDeleteBuilder(table),
  transaction: async (callback: (tx: any) => Promise<void>) => {
    ormState.transactionCalls += 1;
    await callback({
      delete: (table: unknown) => createDeleteBuilder(table),
      update: (table: unknown) => createUpdateBuilder(table),
      insert: (table: unknown) => createInsertBuilder(table),
    });
  },
  query: {
    messages: {
      findFirst: async () => ormState.queryMessageRow,
    },
  },
};

export const resetMockState = (): void => {
  Object.assign(ormState, {
    selectPlans: [],
    selectRecords: [],
    insertValues: [],
    insertConflictSets: [],
    insertReturningQueue: [],
    updateSets: [],
    updateWhereCount: 0,
    deleteTables: [],
    deleteWhereCount: 0,
    transactionCalls: 0,
    queryMessageRow: undefined,
  });
  dbManagerState.ensureOrmCalls = 0;
  asyncStorageState.values.clear();
  asyncStorageState.throwOnGet = null;
  asyncStorageState.setCalls = [];
  secureStoreState.token = null;
  secureStoreState.throwOnGet = null;
  secureStoreState.setCalls = [];
  secureStoreState.deleteCalls = [];
};

mock.module('../../storage/database-manager', () => ({
  dbManager: {
    ensureOrm: async () => {
      dbManagerState.ensureOrmCalls += 1;
      return orm as any;
    },
  },
}));

mock.module('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: async (key: string) => {
      if (asyncStorageState.throwOnGet) throw asyncStorageState.throwOnGet;
      return asyncStorageState.values.get(key) ?? null;
    },
    setItem: async (key: string, value: string) => {
      asyncStorageState.values.set(key, value);
      asyncStorageState.setCalls.push({ key, value });
    },
    removeItem: async (key: string) => {
      asyncStorageState.values.delete(key);
    },
  },
}));

mock.module('expo-secure-store', () => ({
  __esModule: true,
  getItemAsync: async (_key: string) => {
    if (secureStoreState.throwOnGet) throw secureStoreState.throwOnGet;
    return secureStoreState.token;
  },
  setItemAsync: async (key: string, value: string) => {
    secureStoreState.token = value;
    secureStoreState.setCalls.push({ key, value });
  },
  deleteItemAsync: async (key: string) => {
    secureStoreState.token = null;
    secureStoreState.deleteCalls.push(key);
  },
}));

export const baseConversationRow = {
  id: 1,
  conversationId: 'conv-1',
  userId: 'local',
  title: 'Title',
  status: 'pending',
  createdAt: 100,
  updatedAt: 120,
  lastMessagePreview: 'preview',
  syncVersion: 3,
  lastSyncedAt: 119,
  deviceId: 'device-1',
  isDeleted: false,
  isArchived: false,
  error: null,
};

export const baseMessageRow = {
  id: 1,
  messageId: 'msg-1',
  conversationId: 'conv-1',
  role: 'unknown-role',
  content: 'hello',
  isStreaming: 1,
  isAgentStatus: 0,
  elapsedSeconds: null,
  createdAt: 100,
  updatedAt: 101,
  error: null,
  sources: 'not-json',
  toolEvents: '{"bad":true}',
  agentStatuses: 'null',
  metadata: null,
  syncVersion: 0,
  lastSyncedAt: 0,
  deviceId: null,
  isDeleted: false,
};

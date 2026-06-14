import { mock, vi } from 'bun:test';

const useRealDb = process.env['USE_REAL_DB'] === 'true';

// Set essential environment variables
if (!useRealDb) {
  process.env['DATABASE_URL'] = process.env['DATABASE_URL'] || 'postgres://mock:5432/mockdb';
}
process.env['REDIS_URL'] = process.env['REDIS_URL'] || 'redis://mock:6379';
process.env['REDIS_KV_URL'] = process.env['REDIS_KV_URL'] || process.env['REDIS_URL'];
process.env['AUTH_SECRET'] =
  process.env['AUTH_SECRET'] || 'mock-secret-at-least-32-chars-long-123456';

if (process.env['NODE_ENV'] !== 'test') {
  Object.defineProperty(process.env, 'NODE_ENV', {
    value: 'test',
    configurable: true,
    writable: true,
  });
}

// Global mocks for heavy/external dependencies

if (!useRealDb) {
  // Prisma Mock
  const prismaMock = {
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      upsert: vi.fn(),
      count: vi.fn(),
    },
    task: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    $connect: vi.fn(),
    $disconnect: vi.fn(),
    $transaction: vi.fn((cb) => (typeof cb === 'function' ? cb(prismaMock) : Promise.resolve([]))),
  };

  mock.module('@taskforceai/prisma', () => ({
    PrismaClient: vi.fn(() => prismaMock),
    prisma: prismaMock,
  }));
}

// Redis Mock
const redisMock = {
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
  scan: vi.fn().mockResolvedValue(['0', []]),
  unlink: vi.fn(),
  getdel: vi.fn(),
  ping: vi.fn().mockResolvedValue('PONG'),
  hget: vi.fn(),
  hset: vi.fn(),
  hdel: vi.fn(),
  incr: vi.fn(),
  decr: vi.fn(),
  sadd: vi.fn(),
  srem: vi.fn(),
  smembers: vi.fn(),
  multi: vi.fn(() => ({
    exec: vi.fn().mockResolvedValue([]),
  })),
};

const MockRedis = vi.fn(() => redisMock);

// Mock @upstash/redis
mock.module('@upstash/redis', () => ({
  Redis: MockRedis,
}));

// Mock stripe to avoid init errors
mock.module('stripe', () => {
  return {
    default: vi.fn(() => ({
      customers: { create: vi.fn(), list: vi.fn(), retrieve: vi.fn() },
      subscriptions: { create: vi.fn(), list: vi.fn(), retrieve: vi.fn() },
      webhooks: { constructEventAsync: vi.fn(), constructEvent: vi.fn() },
    })),
  };
});

if (!useRealDb) {
  // Mock jsonwebtoken
  mock.module('jsonwebtoken', () => ({
    default: {
      sign: vi.fn().mockReturnValue('mock-jwt-token'),
      verify: vi.fn().mockReturnValue({ sub: 'mock-user', userId: 1 }),
      decode: vi.fn().mockReturnValue({ sub: 'mock-user', userId: 1 }),
    },
    sign: vi.fn().mockReturnValue('mock-jwt-token'),
    verify: vi.fn().mockReturnValue({ sub: 'mock-user', userId: 1 }),
    decode: vi.fn().mockReturnValue({ sub: 'mock-user', userId: 1 }),
  }));
}

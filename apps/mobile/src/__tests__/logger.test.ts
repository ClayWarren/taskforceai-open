describe('mobile logger test runtime', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('uses a self-nesting no-op logger under Bun-driven tests', () => {
    jest.doMock('@taskforceai/config/env', () => ({ env: { BUN_TEST: '1' } }));
    jest.doMock('@taskforceai/observability', () => ({
      createAppLogger: jest.fn(),
      createTraceOperation: jest.fn(),
      injectActiveTraceContext: jest.fn(),
    }));
    jest.doMock('@taskforceai/api-client', () => ({
      configureApiTraceContextInjector: jest.fn(),
    }));
    jest.doMock('@taskforceai/api-client/auth/logger', () => ({ configureAuthLogger: jest.fn() }));
    jest.doMock('@taskforceai/persistence', () => ({
      configurePersistenceLogger: jest.fn(),
      configurePersistenceTracing: jest.fn(),
    }));
    jest.doMock('@taskforceai/sync-client/logger', () => ({ configureSyncLogger: jest.fn() }));
    jest.doMock('@taskforceai/voice/logger', () => ({ configureVoiceLogger: jest.fn() }));

    let loggerModule!: typeof import('../logger');
    jest.isolateModules(() => {
      loggerModule = require('../logger');
    });

    expect(loggerModule.mobileLogger.child({ module: 'child' })).toBe(loggerModule.mobileLogger);
    expect(loggerModule.createModuleLogger('feature')).toBe(loggerModule.mobileLogger);
    expect(() => loggerModule.mobileLogger.error('ignored')).not.toThrow();
  });
});

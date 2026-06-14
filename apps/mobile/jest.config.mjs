import path from 'node:path';
import { fileURLToPath } from 'node:url';

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const rootDir = path.dirname(fileURLToPath(import.meta.url));

const shimMappings = {
  [escapeRegExp(path.resolve(rootDir, 'shims/fs'))]: 'fs',
  [escapeRegExp(path.resolve(rootDir, 'shims/path'))]: 'path',
  [escapeRegExp(path.resolve(rootDir, 'shims/url'))]: 'url',
  [escapeRegExp(path.resolve(rootDir, 'shims/async_hooks'))]: 'async_hooks',
  [escapeRegExp(path.resolve(rootDir, 'shims/crypto'))]: 'crypto',
};

const config = {
  preset: 'jest-expo',
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/test/jest.setup.ts'],
  setupFilesAfterEnv: ['@testing-library/jest-native/extend-expect'],
  testMatch: ['**/__tests__/**/*.test.ts', '**/__tests__/**/*.test.tsx'],
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/.expo/', '/__tests__/logic/', '/src/storage/__tests__/', '/src/qa/__tests__/'],
  transformIgnorePatterns: [
    '/node_modules/(?!(\\.bun|.pnpm|react-native|@react-native|@react-native-community|expo|@expo|@expo-google-fonts|react-navigation|@react-navigation|@sentry/react-native|native-base|@taskforceai|react-native-css|cockatiel))',
    '/node_modules/react-native-reanimated/plugin/',
  ],
  moduleNameMapper: {
    '^react$': '<rootDir>/node_modules/react',
    '^react/(.*)$': '<rootDir>/node_modules/react/$1',
    '^react-dom$': '<rootDir>/node_modules/react-dom',
    '^react-dom/(.*)$': '<rootDir>/node_modules/react-dom/$1',
    '^@tanstack/react-query$': '<rootDir>/node_modules/@tanstack/react-query',
    '^@tanstack/react-query/(.*)$': '<rootDir>/node_modules/@tanstack/react-query/$1',
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@shared/(.*)$': '<rootDir>/../../packages/shared-ts/src/$1',
    '^@qa/(.*)$': '<rootDir>/src/qa/$1',
    '^@tanstack/react-start/server$': '<rootDir>/test/mocks/react-start-server.ts',
    '^@taskforceai/logger$': '<rootDir>/../../packages/shared-ts/src/logger',
    '^@taskforceai/logger/(.*)$': '<rootDir>/../../packages/shared-ts/src/logger/$1',
    '^@taskforceai/contracts$': '<rootDir>/../../packages/contracts-ts/src',
    '^@taskforceai/contracts/(.*)$': '<rootDir>/../../packages/contracts-ts/src/$1',
    '^@taskforceai/config$': '<rootDir>/../../packages/shared-ts/src/config',
    '^@taskforceai/config/(.*)$': '<rootDir>/../../packages/shared-ts/src/config/$1',
    '^@taskforceai/validation$': '<rootDir>/../../packages/shared-ts/src/validation',
    '^@taskforceai/validation/(.*)$': '<rootDir>/../../packages/shared-ts/src/validation/$1',
    '^@taskforceai/errors$': '<rootDir>/../../packages/shared-ts/src/errors',
    '^@taskforceai/errors/(.*)$': '<rootDir>/../../packages/shared-ts/src/errors/$1',
    '^@taskforceai/observability$': '<rootDir>/../../packages/observability/src',
    '^@taskforceai/observability/(.*)$': '<rootDir>/../../packages/observability/src/$1',
    '^@taskforceai/voice$': '<rootDir>/../../packages/voice/src',
    '^@taskforceai/voice/(.*)$': '<rootDir>/../../packages/voice/src/$1',
    '^@taskforceai/design-tokens$': '<rootDir>/../../packages/design-tokens/index.js',
    '^@babel/runtime/(.*)$': '<rootDir>/node_modules/@babel/runtime/$1',
    '^expo$': '<rootDir>/test/mocks/expo.ts',
    '^expo/(.*)$': '<rootDir>/test/mocks/expo.ts',
    '^react-native-css$': '<rootDir>/test/mocks/react-native-css.tsx',
    '^react-native-css/(.*)$': '<rootDir>/test/mocks/react-native-css.tsx',
    '^expo-modules-core/src/polyfill/dangerous-internal$':
      '<rootDir>/test/mocks/expo-modules-core-polyfill.ts',
    '^expo-modules-core$': '<rootDir>/test/mocks/expo-modules-core.ts',
    ...Object.fromEntries(
      Object.entries(shimMappings).map(([pattern, target]) => [`^${pattern}\\.ts$`, target])
    ),
  },
  reporters: [['default', { summaryOnly: true }]],
  coverageProvider: 'v8',
  collectCoverageFrom: [
    '<rootDir>/src/**/*.tsx',
    '<rootDir>/src/**/*.ts',
    '!<rootDir>/src/__tests__/**/*',
    '!<rootDir>/src/theme/colors.ts',
    '!<rootDir>/src/types/**/*',
    // Screens — integration-level, not unit-testable
    '!<rootDir>/src/screens/**/*',
    // Providers — app wiring
    '!<rootDir>/src/providers/**/*',
    // Native SDK integrations
    '!<rootDir>/src/auth/token-exchange.ts',
    '!<rootDir>/src/utils/apple-oauth.ts',
    '!<rootDir>/src/utils/google-oauth.ts',
    '!<rootDir>/src/utils/network-test.ts',
    '!<rootDir>/src/auth/token-store.ts',
    '!<rootDir>/src/voice/mobileAdapter.ts',
    '!<rootDir>/src/sync/mobileSyncClient.ts',
    '!<rootDir>/src/observability/sentry.ts',
    '!<rootDir>/src/billing/**/*',
    '!<rootDir>/src/notifications/**/*',
    '!<rootDir>/src/hooks/useNotificationsBootstrap.ts',
    '!<rootDir>/src/hooks/usePurchases.ts',
    '!<rootDir>/src/theme/useTypography.ts',
    '!<rootDir>/src/components/PromptInput.internal.ts',
    // Already covered by logic test suite
    '!<rootDir>/src/storage/SqlitePersister.ts',
    '!<rootDir>/src/storage/storage-adapter.ts',
    '!<rootDir>/src/storage/chat-local-mobile.internal.ts',
    '!<rootDir>/src/storage/sqlite-adapter.internal.ts',
    '!<rootDir>/src/storage/encryption.ts',
    '!<rootDir>/src/storage/encryption-migration.ts',
    '!<rootDir>/src/storage/database-manager.ts',
    '!<rootDir>/src/storage/migration-runner.ts',
    '!<rootDir>/src/storage/schema-patches.ts',
    '!<rootDir>/src/utils/status-parser.ts',
    '!<rootDir>/src/security/certificate-pinning.ts',
    '!<rootDir>/src/api/client.ts',
    '!<rootDir>/src/config/base-url.ts',
    '!<rootDir>/src/streaming/streaming-store.internal.ts',
    '!<rootDir>/src/streaming/useStreamingStore.ts',
    '!<rootDir>/src/mcp/approval.ts',
    '!<rootDir>/src/mcp/local-command.ts',
    // Integration-level components (compose many hooks, not unit-testable)
    '!<rootDir>/src/components/Sidebar.tsx',
    '!<rootDir>/src/components/Sidebar.view.tsx',
    '!<rootDir>/src/components/ProfileModal.tsx',
    '!<rootDir>/src/screens/ProjectsScreen.tsx',
    '!<rootDir>/src/components/AgentExecutionPanel.tsx',
    '!<rootDir>/src/components/PromptInput.ModelSelector.tsx',
    '!<rootDir>/src/components/PromptInput.MoreOptionsSheet.tsx',
    '!<rootDir>/src/hooks/useChatCoordinator.ts',
  ],
  coverageThreshold: {
    global: {
      statements: 80,
      lines: 80,
      functions: 80,
      branches: 80,
    },
  },
};

export default config;

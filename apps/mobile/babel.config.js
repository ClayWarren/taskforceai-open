const path = require('path');

module.exports = function (api) {
  api.cache(
    () => `${process.env.NODE_ENV ?? 'development'}-${process.env.USE_RN_SHIMS ?? 'default'}`
  );
  const useRnShims = process.env.USE_RN_SHIMS !== 'false';

  const alias = {
    react: path.resolve(__dirname, 'node_modules/react'),
    'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
    '@tanstack/react-query': path.resolve(__dirname, 'node_modules/@tanstack/react-query'),
    '@shared': path.resolve(__dirname, '../../packages/shared-ts/src'),
    '@qa': path.resolve(__dirname, 'src/qa'),
    '@taskforceai/logger': path.resolve(__dirname, '../../packages/shared-ts/src/logger'),
    '@taskforceai/design-tokens': path.resolve(__dirname, '../../packages/design-tokens'),
    '@taskforceai/contracts': path.resolve(__dirname, '../../packages/contracts-ts/src'),
    '@taskforceai/config': path.resolve(__dirname, '../../packages/shared-ts/src/config'),
    '@taskforceai/validation': path.resolve(__dirname, '../../packages/shared-ts/src/validation'),
    '@taskforceai/errors': path.resolve(__dirname, '../../packages/shared-ts/src/errors'),
    '@taskforceai/observability': path.resolve(__dirname, '../../packages/observability/src'),
    '@taskforceai/locales': path.resolve(__dirname, '../../packages/locales'),
    '@tauri-apps/api/core': path.resolve(__dirname, 'shims/tauri-core'),
    'node:fs': useRnShims ? path.resolve(__dirname, 'shims/fs') : 'fs',
    'node:path': useRnShims ? path.resolve(__dirname, 'shims/path') : 'path',
    'node:url': useRnShims ? path.resolve(__dirname, 'shims/url') : 'url',
    'node:async_hooks': useRnShims ? path.resolve(__dirname, 'shims/async_hooks') : 'async_hooks',
    'node:crypto': useRnShims ? path.resolve(__dirname, 'shims/crypto') : 'crypto',
  };

  const presets = [
    ['babel-preset-expo', { unstable_transformImportMeta: true }],
    'nativewind/babel',
  ];

  const plugins = [
    [
      'module-resolver',
      {
        extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
        alias,
      },
    ],
    'react-native-reanimated/plugin',
  ];

  return {
    presets,
    plugins,
  };
};

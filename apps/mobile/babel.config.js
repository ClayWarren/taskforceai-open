const path = require('path');

const packageRoot = (packageName) =>
  path.dirname(require.resolve(`${packageName}/package.json`, { paths: [__dirname] }));

module.exports = function (api) {
  api.cache(() => process.env.NODE_ENV ?? 'development');

  const alias = {
    react: packageRoot('react'),
    'react-dom': packageRoot('react-dom'),
    '@tanstack/react-query': packageRoot('@tanstack/react-query'),
    '@client-core': path.resolve(__dirname, '../../packages/core/ts/client-core/src'),
    '@qa': path.resolve(__dirname, 'src/qa'),
    '@taskforceai/logger': path.resolve(__dirname, '../../packages/core/ts/client-core/src/logger'),
    '@taskforceai/design-tokens': path.resolve(
      __dirname,
      '../../packages/ui/ts/design-tokens'
    ),
    '@taskforceai/api-client': path.resolve(__dirname, '../../packages/adapters/ts/api-client/src'),
    '@taskforceai/contracts': path.resolve(__dirname, '../../packages/contracts/typescript/src'),
    '@taskforceai/config': path.resolve(__dirname, '../../packages/infrastructure/ts/config/src'),
    '@taskforceai/validation': path.resolve(
      __dirname,
      '../../packages/core/ts/client-core/src/validation'
    ),
    '@taskforceai/errors': path.resolve(__dirname, '../../packages/core/ts/client-core/src/errors'),
    '@taskforceai/observability': path.resolve(
      __dirname,
      '../../packages/infrastructure/ts/observability/src'
    ),
    '@taskforceai/locales': path.resolve(__dirname, '../../packages/ui/ts/locales'),
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

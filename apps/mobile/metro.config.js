const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');
const { withNativewind } = require('nativewind/metro');
const fs = require('fs');
const { resolve: resolveModule } = require('metro-resolver');

const enableCustomResolver = process.env.METRO_DISABLE_CUSTOM_RESOLVER !== '1';
const debugLog = (...args) => {
  if (process.env.METRO_CONFIG_DEBUG === '1') {
    process.stdout.write(`${args.map(String).join(' ')}
`);
  }
};

const exclusionList = (() => {
  try {
    return require('metro-config/src/defaults/exclusionList');
  } catch {
    return (patterns = []) =>
      new RegExp(
        patterns
          .filter(Boolean)
          .map((pattern) => pattern.source)
          .join('|')
      );
  }
})();

const config = getDefaultConfig(__dirname);

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..');
const repoRoot = path.resolve(workspaceRoot, '..');
debugLog('[metro] projectRoot', projectRoot);
debugLog('[metro] repoRoot', repoRoot);
const bunModulesPath = path.resolve(repoRoot, 'node_modules', '.bun');

const sharedPath = path.resolve(repoRoot, 'packages', 'shared-ts', 'src');
const qaPath = path.resolve(repoRoot, 'qa');
const designTokensPath = path.resolve(repoRoot, 'packages/design-tokens');
const loggerPath = path.resolve(repoRoot, 'packages/shared-ts/src/logger');
const contractsPath = path.resolve(repoRoot, 'packages', 'contracts-ts', 'src');
debugLog('[metro] contractsPath', contractsPath);
const configPackagePath = path.resolve(repoRoot, 'packages', 'shared-ts', 'src', 'config');
const validationPath = path.resolve(repoRoot, 'packages/shared-ts/src/validation');
const errorsPath = path.resolve(repoRoot, 'packages/shared-ts/src/errors');
const observabilityPath = path.resolve(repoRoot, 'packages/observability/src');
const localesPath = path.resolve(repoRoot, 'packages', 'locales');
const reactNativeCssComponentsPath = (() => {
  try {
    const packageJsonPath = require.resolve('react-native-css/package.json', {
      paths: [projectRoot, workspaceRoot, repoRoot],
    });
    return path.join(path.dirname(packageJsonPath), 'dist', 'commonjs', 'components');
  } catch {
    return null;
  }
})();

const existingPaths = (...paths) => paths.filter((folder) => folder && fs.existsSync(folder));

const resolveWithExtensions = (basePath) => {
  const extensions = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json'];
  for (const ext of extensions) {
    const candidate = `${basePath}${ext}`;
    if (fs.existsSync(candidate)) {
      const stat = fs.lstatSync(candidate);
      if (stat.isFile()) {
        return fs.realpathSync.native(candidate);
      }
      if (stat.isDirectory()) {
        for (const indexExt of extensions.filter(e => e !== '')) {
          const indexCandidate = path.join(candidate, `index${indexExt}`);
          if (fs.existsSync(indexCandidate) && fs.lstatSync(indexCandidate).isFile()) {
            return fs.realpathSync.native(indexCandidate);
          }
        }
      }
    }
  }
  return null;
};

const bunStoreEntries = fs.existsSync(bunModulesPath) ? fs.readdirSync(bunModulesPath) : [];

const splitModuleSpecifier = (specifier) => {
  if (specifier.startsWith('@')) {
    const [scope, pkg, ...rest] = specifier.split('/');
    return { packageName: `${scope}/${pkg}`, subPath: rest.join('/') };
  }
  const [pkg, ...rest] = specifier.split('/');
  return { packageName: pkg, subPath: rest.join('/') };
};

const resolvePackageRootFromMobile = (moduleName) => {
  const { packageName } = splitModuleSpecifier(moduleName);
  const searchRoots = [projectRoot, workspaceRoot, repoRoot];
  for (const basePath of searchRoots) {
    try {
      const packageJsonPath = require.resolve(`${packageName}/package.json`, { paths: [basePath] });
      return fs.realpathSync.native(path.dirname(packageJsonPath));
    } catch {
      // Continue searching
    }
  }

  if (bunStoreEntries.length) {
    const sanitizedName = packageName.startsWith('@') ? packageName.replace('/', '+') : packageName;
    const bunEntry = bunStoreEntries.find((entry) => entry.startsWith(`${sanitizedName}@`));
    if (bunEntry) {
      const bunBase = path.join(bunModulesPath, bunEntry, 'node_modules', packageName);
      if (fs.existsSync(bunBase)) {
        return fs.realpathSync.native(bunBase);
      }
    }
  }

  return null;
};

const resolveModuleSpecifierFromMobile = (moduleName) => {
  if (moduleName.startsWith('.') || moduleName.startsWith('/')) {
    return null;
  }

  const searchRoots = [projectRoot, workspaceRoot, repoRoot];
  for (const basePath of searchRoots) {
    try {
      return fs.realpathSync.native(require.resolve(moduleName, { paths: [basePath] }));
    } catch {
      // Continue searching
    }
  }

  return null;
};

config.transformer = {
  ...config.transformer,
  inlineRequires: true,
};

config.watchFolders = existingPaths(
  ...(Array.isArray(config.watchFolders) ? config.watchFolders : []),
  sharedPath,
  qaPath,
  designTokensPath,
  loggerPath,
  contractsPath,
  configPackagePath,
  validationPath,
  errorsPath,
  observabilityPath,
  bunModulesPath,
  localesPath
).filter((value, index, self) => self.indexOf(value) === index);

const nodeModuleRoots = existingPaths(
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
  path.resolve(repoRoot, 'node_modules'),
  bunModulesPath
);

config.resolver.nodeModulesPaths = [
  ...new Set([...config.resolver.nodeModulesPaths, ...nodeModuleRoots]),
];
config.resolver.assetExts = [...new Set([...(config.resolver.assetExts || []), 'wasm'])];

function fallbackResolve(context, moduleName, platform) {
  if (!context || context.resolveRequest === resolveModule) {
    return resolveModule(context, moduleName, platform);
  }
  const clonedContext = Object.create(Object.getPrototypeOf(context) ?? Object.prototype);
  Object.defineProperties(clonedContext, Object.getOwnPropertyDescriptors(context));
  clonedContext.resolveRequest = resolveModule;
  return resolveModule(clonedContext, moduleName, platform);
}

function patchedResolver(context, moduleName, platform) {
  debugLog('[metro] resolving', moduleName);

  // Force fix for the incorrect absolute path that keeps appearing
  if (moduleName.includes('packages/contracts/src')) {
    const fixedPath = moduleName.replace('packages/contracts/src', 'packages/contracts-ts/src');
    debugLog('[metro] fixing path', moduleName, '->', fixedPath);
    const target = resolveWithExtensions(fixedPath);
    if (target) return { type: 'sourceFile', filePath: target };
  }

  if (moduleName.includes('packages/shared/src')) {
    const fixedPath = moduleName.replace('packages/shared/src', 'packages/shared-ts/src');
    debugLog('[metro] fixing path', moduleName, '->', fixedPath);
    const target = resolveWithExtensions(fixedPath);
    if (target) return { type: 'sourceFile', filePath: target };
  }

  if (moduleName === '@tauri-apps/api/core') {
    return {
      type: 'sourceFile',
      filePath: path.resolve(projectRoot, 'shims/tauri-core.js'),
    };
  }

  if (
    moduleName === 'react-native/Libraries/PushNotificationIOS/PushNotificationIOS' ||
    moduleName.endsWith('/Libraries/PushNotificationIOS/PushNotificationIOS')
  ) {
    return {
      type: 'sourceFile',
      filePath: path.resolve(projectRoot, 'shims/push-notification-ios.js'),
    };
  }

  if (moduleName === '@expo/metro-runtime') {
    const target = resolveWithExtensions(
      path.join(projectRoot, 'node_modules', '@expo', 'metro-runtime', 'build', 'index')
    );
    if (target) return { type: 'sourceFile', filePath: target };
  }

  if (moduleName === 'react-native') {
    const packageName = platform === 'web' ? 'react-native-web' : 'react-native';
    const target = resolveWithExtensions(path.join(projectRoot, 'node_modules', packageName, 'index'));
    if (target) return { type: 'sourceFile', filePath: target };
  }

  if (moduleName === 'react-native-css/components') {
    const target =
      reactNativeCssComponentsPath && resolveWithExtensions(reactNativeCssComponentsPath);
    if (target) return { type: 'sourceFile', filePath: target };
  }

  if (moduleName.startsWith('react-native-css/components/')) {
    const relativePath = moduleName.replace('react-native-css/components/', '');
    const target =
      reactNativeCssComponentsPath &&
      resolveWithExtensions(path.join(reactNativeCssComponentsPath, relativePath));
    if (target) return { type: 'sourceFile', filePath: target };
  }

  if (moduleName === 'expo-router') {
    const target = resolveWithExtensions(path.join(projectRoot, 'node_modules', 'expo-router', 'build', 'index'));
    if (target) return { type: 'sourceFile', filePath: target };
  }

  if (moduleName.startsWith('expo/src/')) {
    const relativePath = moduleName.replace('expo/src/', '');
    const target = resolveWithExtensions(path.join(projectRoot, 'node_modules', 'expo', 'src', relativePath));
    if (target) return { type: 'sourceFile', filePath: target };
  }

  if (moduleName.startsWith('expo/internal/')) {
    const relativePath = moduleName.replace('expo/internal/', '');
    const target = resolveWithExtensions(
      path.join(projectRoot, 'node_modules', 'expo', 'internal', relativePath)
    );
    if (target) return { type: 'sourceFile', filePath: target };
  }

  if (moduleName.startsWith('expo-router/')) {
    const relativePath = moduleName.replace('expo-router/', '');
    const target = resolveWithExtensions(path.join(projectRoot, 'node_modules', 'expo-router', relativePath));
    if (target) return { type: 'sourceFile', filePath: target };
  }

  // Explicitly handle @taskforceai/contracts and @shared
  if (moduleName.startsWith('@taskforceai/contracts')) {
    const subPath = moduleName.substring('@taskforceai/contracts'.length).replace(/^\//, '') || 'index';
    const target = resolveWithExtensions(path.join(contractsPath, subPath));
    if (target) return { type: 'sourceFile', filePath: target };
  }

  if (moduleName.startsWith('@shared/')) {
    const subPath = moduleName.replace('@shared/', '');
    const target = resolveWithExtensions(path.join(sharedPath, subPath));
    if (target) return { type: 'sourceFile', filePath: target };
  }

  if (context?.resolveRequest && context.resolveRequest !== patchedResolver) {
    try {
      return context.resolveRequest(context, moduleName, platform);
    } catch (error) {
      debugLog('[metro] parent resolver failed for', moduleName, error?.message ?? error);
    }
  }

  const resolvedPackageModule = resolveModuleSpecifierFromMobile(moduleName);
  if (resolvedPackageModule) {
    return { type: 'sourceFile', filePath: resolvedPackageModule };
  }

  return fallbackResolve(context, moduleName, platform);
}

if (enableCustomResolver) {
  config.resolver.resolveRequest = patchedResolver;
}

const extraNodeModules = {
  ...config.resolver?.extraNodeModules,
  '@shared': sharedPath,
  '@qa': qaPath,
  '@taskforceai/design-tokens': designTokensPath,
  '@taskforceai/logger': loggerPath,
  '@taskforceai/contracts': contractsPath,
  '@taskforceai/config': configPackagePath,
  '@taskforceai/validation': validationPath,
  '@taskforceai/errors': errorsPath,
  '@taskforceai/observability': observabilityPath,
  '@taskforceai/locales': localesPath,
  '@tanstack/react-query': path.resolve(projectRoot, 'node_modules', '@tanstack', 'react-query'),
  '@tauri-apps/api/core': path.resolve(projectRoot, 'shims/tauri-core.js'),
};

[
  'expo',
  '@expo/metro-runtime',
  'react',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
  'react-dom',
  'expo-status-bar',
  '@tanstack/react-query',
  'react-native',
  'expo-router',
  '@shopify/flash-list',
].forEach((moduleName) => {
  const resolved = resolvePackageRootFromMobile(moduleName);
  if (resolved) {
    extraNodeModules[moduleName] = resolved;
  }
});

config.resolver.extraNodeModules = extraNodeModules;

const escapePath = (dir) => dir.replace(/[/\\]/g, '\\/');
const repoPathPattern = escapePath(repoRoot);

config.resolver.blockList = exclusionList([
  new RegExp(`${repoPathPattern}/dist/.*`),
  new RegExp(`${repoPathPattern}/build/.*`),
  new RegExp(`${repoPathPattern}/coverage/.*`),
  new RegExp(`${repoPathPattern}/.git/.*`),
  new RegExp(`${repoPathPattern}/.turbo/.*`),
]);

module.exports = withNativewind(config, { globalClassNamePolyfill: false });

import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';

type JsonValue = string | number | boolean | null | JsonObject | JsonArray;
type JsonArray = JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

export interface BuildOutputOptions {
  appName: string;
  clientCandidates: string[];
  serverCandidates: string[];
  outputConfig: JsonObject;
  functionPackageJSON?: JsonObject;
  functionHandler?: string;
  logBuildOutput?: boolean;
}

export interface StaticSpaOutputOptions {
  appName: string;
  outputConfig: JsonObject;
  clientDir?: string;
  shellFile?: string;
}

const ICON_SOURCE =
  '/(favicon-32x32.png|icon.png|icon-48.webp|favicon-16x16.png|apple-touch-icon.png|favicon.ico|manifest.json)';

const DEFAULT_CONTENT_SECURITY_POLICY = "frame-ancestors 'none'";

const ICON_RESPONSE_HEADERS = [
  { key: 'Access-Control-Allow-Origin', value: '*' },
  { key: 'Access-Control-Allow-Methods', value: 'GET, OPTIONS' },
  { key: 'Cache-Control', value: 'public, max-age=3600' },
];

export const iconResponseHeader = (): JsonObject => ({
  source: ICON_SOURCE,
  headers: ICON_RESPONSE_HEADERS,
});

type SecurityHeaderRouteOptions = {
  cors?: boolean;
  contentSecurityPolicy?: string | false;
  frameOptions?: string | false;
  source?: string;
};

const normalizeSecurityHeaderOptions = (
  options: boolean | SecurityHeaderRouteOptions = {}
): SecurityHeaderRouteOptions => (typeof options === 'boolean' ? { cors: options } : options);

export const responseHeaderRoute = (src: string, headers: Record<string, string>): JsonObject => ({
  src,
  headers,
  continue: true,
});

export const securityHeaderRoute = (
  options: boolean | SecurityHeaderRouteOptions = {}
): JsonObject => {
  const {
    contentSecurityPolicy = DEFAULT_CONTENT_SECURITY_POLICY,
    cors = false,
    frameOptions = 'DENY',
    source = '/(.*)',
  } = normalizeSecurityHeaderOptions(options);
  return {
    src: source,
    headers: {
      ...(cors
        ? {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers':
              'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization',
          }
        : {}),
      ...(contentSecurityPolicy ? { 'Content-Security-Policy': contentSecurityPolicy } : {}),
      ...(frameOptions ? { 'X-Frame-Options': frameOptions } : {}),
      'X-Content-Type-Options': 'nosniff',
      'X-XSS-Protection': '0',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(self), geolocation=()',
      'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
    },
    continue: true,
  };
};

export const staticAssetRoutes = (): JsonObject[] => [
  {
    src: '/assets/(.*)',
    headers: { 'Cache-Control': 'public, max-age=31536000, immutable' },
    continue: true,
  },
  {
    src: '/_build/(.*)',
    headers: { 'Cache-Control': 'public, max-age=31536000, immutable' },
    continue: true,
  },
];

export const iconCacheRoute = (cors = false): JsonObject => ({
  src: ICON_SOURCE,
  headers: {
    ...(cors
      ? {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
        }
      : {}),
    'Cache-Control': 'public, max-age=3600',
  },
  continue: true,
});

export const route = (src: string, dest: string): JsonObject => ({ src, dest });

export const temporaryRedirectRoute = (src: string, location: string): JsonObject => ({
  src,
  status: 307,
  headers: { Location: location },
});

export const permanentRedirectRoute = (src: string, location: string): JsonObject => ({
  src,
  status: 308,
  headers: { Location: location },
});

export const filesystemRoute = (): JsonObject => ({ handle: 'filesystem' });

export const serverlessFallbackRoute = (): JsonObject => ({ src: '/(.*)', dest: '/index' });

export const reactFunctionPackageJSON = (): JsonObject => ({
  type: 'module',
  dependencies: {
    react: '^19.1.0',
    'react-dom': '^19.1.0',
  },
});

export const handleBuildFailure = (error: unknown): never => {
  process.stderr.write(
    `${JSON.stringify({ level: 'error', message: 'Build failed', error: String(error) })}\n`
  );
  process.exit(1);
};

const writeLog = (
  level: 'info' | 'error',
  message: string,
  fields: Record<string, unknown> = {}
): void => {
  const payload = JSON.stringify({ level, message, ...fields });
  const stream = level === 'error' ? process.stderr : process.stdout;
  stream.write(`${payload}\n`);
};

const resolveDirectory = (root: string, candidates: string[]): string => {
  for (const candidate of candidates) {
    const absolute = join(root, candidate);
    if (existsSync(absolute)) {
      return absolute;
    }
  }
  throw new Error(`Missing expected build directory. Checked: ${candidates.join(', ')}`);
};

const cleanViteOutput = (root: string): void => {
  for (const dir of ['dist', '.output']) {
    rmSync(join(root, dir), { recursive: true, force: true });
  }
};

const GENERATED_TEXT_EXTENSIONS = new Set(['.html', '.js', '.mjs', '.cjs', '.json']);
const GLOBAL_CSS_ASSET_PATTERN = /\/assets\/globals-[A-Za-z0-9_-]+\.css/g;

const getExtension = (filePath: string): string => {
  const basename = filePath.split('/').pop() ?? filePath;
  const dotIndex = basename.lastIndexOf('.');
  return dotIndex === -1 ? '' : basename.slice(dotIndex);
};

const rewriteGeneratedGlobalCssReferences = (dir: string): void => {
  if (!existsSync(dir)) {
    return;
  }

  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      rewriteGeneratedGlobalCssReferences(path);
      continue;
    }
    if (!stat.isFile() || !GENERATED_TEXT_EXTENSIONS.has(getExtension(path))) {
      continue;
    }

    const source = readFileSync(path, 'utf8');
    const next = source.replace(GLOBAL_CSS_ASSET_PATTERN, '/globals.css');
    if (next !== source) {
      writeFileSync(path, next);
    }
  }
};

const normalizeGlobalCssAsset = (clientDir: string, serverDir?: string): void => {
  const assetsDir = join(clientDir, 'assets');
  if (!existsSync(assetsDir)) {
    return;
  }

  const globalCss = readdirSync(assetsDir)
    .filter((entry) => /^globals-[A-Za-z0-9_-]+\.css$/.test(entry))
    .toSorted()[0];
  if (!globalCss) {
    return;
  }

  cpSync(join(assetsDir, globalCss), join(clientDir, 'globals.css'));
  rewriteGeneratedGlobalCssReferences(clientDir);
  if (serverDir) {
    rewriteGeneratedGlobalCssReferences(serverDir);
  }
};

export const buildVercelOutput = async (options: BuildOutputOptions): Promise<void> => {
  const root = process.cwd();
  const outputDir = join(root, '.vercel', 'output');
  const staticDir = join(outputDir, 'static');
  const functionsDir = join(outputDir, 'functions');
  const functionDir = join(functionsDir, 'index.func');

  writeLog('info', 'Building app for Vercel', { appName: options.appName });
  cleanViteOutput(root);
  const buildProc = Bun.spawn(['bun', 'x', 'vite', 'build'], {
    cwd: root,
    stdio: ['inherit', 'inherit', 'inherit'],
  });
  const exitCode = await buildProc.exited;
  if (exitCode !== 0) {
    throw new Error(`Vite build failed with exit code ${exitCode}`);
  }

  const clientDir = resolveDirectory(root, options.clientCandidates);
  const serverDir = resolveDirectory(root, options.serverCandidates);
  normalizeGlobalCssAsset(clientDir, serverDir);

  if (options.logBuildOutput) {
    Bun.spawnSync(['ls', '-R', 'dist'], { stdio: ['inherit', 'inherit', 'inherit'] });
  }

  writeLog('info', 'Creating Vercel Build Output API structure');
  if (existsSync(outputDir)) {
    Bun.spawnSync(['rm', '-rf', outputDir]);
  }
  mkdirSync(outputDir, { recursive: true });
  mkdirSync(staticDir, { recursive: true });
  mkdirSync(functionsDir, { recursive: true });

  writeLog('info', 'Copying static assets');
  cpSync(clientDir, staticDir, { recursive: true });

  const publicDir = join(root, 'public');
  if (existsSync(publicDir)) {
    writeLog('info', 'Copying public files to static');
    cpSync(publicDir, staticDir, { recursive: true });
  }

  writeLog('info', 'Creating serverless function');
  mkdirSync(functionDir, { recursive: true });
  cpSync(serverDir, functionDir, { recursive: true });

  const packageJSON = options.functionPackageJSON ?? { type: 'module' };
  writeFileSync(join(functionDir, 'package.json'), JSON.stringify(packageJSON, null, 2));

  const handler =
    options.functionHandler ??
    (existsSync(join(functionDir, 'index.mjs')) ? 'index.mjs' : 'server.js');
  const functionConfig = {
    runtime: 'nodejs22.x',
    handler,
    launcherType: 'Nodejs',
    regions: ['iad1'],
  };
  writeFileSync(join(functionDir, '.vc-config.json'), JSON.stringify(functionConfig, null, 2));

  writeFileSync(join(outputDir, 'config.json'), JSON.stringify(options.outputConfig, null, 2));

  // Copy fonts and WASM for @vercel/og if present in node_modules to fix ENOENT in serverless environment
  const assetsToCopy = [
    {
      name: 'Geist-Regular.ttf',
      paths: [
        join(root, 'node_modules', '@vercel', 'og', 'dist', 'Geist-Regular.ttf'),
        join(root, '../../node_modules', '@vercel', 'og', 'dist', 'Geist-Regular.ttf'),
      ],
    },
    {
      name: 'noto-sans-v27-latin-regular.ttf',
      paths: [
        join(root, 'node_modules', '@vercel', 'og', 'dist', 'noto-sans-v27-latin-regular.ttf'),
        join(
          root,
          '../../node_modules',
          '@vercel',
          'og',
          'dist',
          'noto-sans-v27-latin-regular.ttf'
        ),
      ],
    },
    {
      name: 'resvg.wasm',
      paths: [
        join(root, 'node_modules', '@vercel', 'og', 'dist', 'resvg.wasm'),
        join(root, '../../node_modules', '@vercel', 'og', 'dist', 'resvg.wasm'),
      ],
    },
    {
      name: 'yoga.wasm',
      paths: [
        join(root, 'node_modules', '@vercel', 'og', 'dist', 'yoga.wasm'),
        join(root, '../../node_modules', '@vercel', 'og', 'dist', 'yoga.wasm'),
      ],
    },
  ];

  const targetAssetsDir = join(functionDir, 'assets');
  if (!existsSync(targetAssetsDir)) {
    mkdirSync(targetAssetsDir, { recursive: true });
  }

  for (const asset of assetsToCopy) {
    const foundPath = asset.paths.find((p) => existsSync(p));
    if (foundPath) {
      cpSync(foundPath, join(targetAssetsDir, asset.name));
      writeLog('info', `Copied ${asset.name} for @vercel/og`, {
        assetName: asset.name,
        targetAssetsDir,
      });
    } else {
      writeLog('info', `Could not find ${asset.name} for @vercel/og`, {
        assetName: asset.name,
      });
    }
  }

  writeLog('info', 'Vercel Build Output API structure created', {
    staticDir,
    functionDir,
  });
};

export const buildStaticSpaOutput = async ({
  appName,
  outputConfig,
  clientDir = join(process.cwd(), 'dist', 'client'),
  shellFile = '_shell.html',
}: StaticSpaOutputOptions): Promise<void> => {
  const root = process.cwd();
  const outputDir = join(root, '.vercel', 'output');
  const staticDir = join(outputDir, 'static');

  writeLog('info', 'Building static SPA for Vercel', { appName });
  cleanViteOutput(root);
  const buildProc = Bun.spawn(['bun', 'x', 'vite', 'build'], {
    cwd: root,
    stdio: ['inherit', 'inherit', 'inherit'],
  });
  const exitCode = await buildProc.exited;
  if (exitCode !== 0) {
    throw new Error(`Vite build failed with exit code ${exitCode}`);
  }
  if (!existsSync(clientDir)) {
    throw new Error(`Client build did not produce expected output at ${clientDir}`);
  }

  const shellPath = join(clientDir, shellFile);
  const indexPath = join(clientDir, 'index.html');
  if (existsSync(shellPath)) {
    renameSync(shellPath, indexPath);
  }
  normalizeGlobalCssAsset(clientDir);

  if (existsSync(outputDir)) {
    Bun.spawnSync(['rm', '-rf', outputDir]);
  }
  mkdirSync(outputDir, { recursive: true });
  mkdirSync(staticDir, { recursive: true });
  cpSync(clientDir, staticDir, { recursive: true });
  writeFileSync(join(outputDir, 'config.json'), JSON.stringify(outputConfig, null, 2));
  writeLog('info', 'Vercel static output created', { staticDir });
};

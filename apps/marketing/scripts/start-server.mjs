#!/usr/bin/env node
import { createReadStream, promises as fs } from 'node:fs';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createGzip } from 'node:zlib';
import path from 'node:path';
import { getFrontendSecurityHeaders } from '@taskforceai/config/frontend-security-headers';

const SECURITY_HEADER_ENVIRONMENT =
  process.env['NODE_ENV'] === 'production' ? 'production' : 'development';
const SECURITY_HEADERS = getFrontendSecurityHeaders('marketing', {
  environment: SECURITY_HEADER_ENVIRONMENT,
  includeStrictTransportSecurity: SECURITY_HEADER_ENVIRONMENT === 'production',
});

function writeError(message) {
  process.stderr.write(`${message}\n`);
}

function writeInfo(message) {
  process.stdout.write(`${message}\n`);
}

function toRequestHeaders(nodeHeaders) {
  const headers = new Headers();

  for (const [key, value] of Object.entries(nodeHeaders)) {
    if (value === undefined) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(key, item);
      }
      continue;
    }

    if (typeof value === 'string') {
      headers.set(key, value);
      continue;
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      headers.set(key, `${value}`);
    }
  }

  return headers;
}

const CONTENT_TYPE_BY_EXT = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.htm': 'text/html; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml; charset=utf-8',
  '.yaml': 'application/yaml; charset=utf-8',
  '.yml': 'application/yaml; charset=utf-8',
};

function getContentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return CONTENT_TYPE_BY_EXT[extension] ?? 'application/octet-stream';
}

function getCacheControl(pathname) {
  if (pathname.startsWith('/_build/')) {
    return 'public, max-age=31536000, immutable';
  }
  return 'public, max-age=3600';
}

function applySecurityHeaders(res) {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    if (!res.hasHeader(key)) {
      res.setHeader(key, value);
    }
  }
}

function isCompressibleContentType(contentType) {
  const normalizedContentType = contentType.toLowerCase();
  return (
    normalizedContentType.startsWith('text/') ||
    normalizedContentType.includes('application/javascript') ||
    normalizedContentType.includes('application/json') ||
    normalizedContentType.includes('application/xml') ||
    normalizedContentType.includes('application/yaml') ||
    normalizedContentType.includes('image/svg+xml')
  );
}

function acceptsGzip(req) {
  const acceptEncoding = req.headers['accept-encoding'];
  if (Array.isArray(acceptEncoding)) {
    return acceptEncoding.some((value) => value.includes('gzip'));
  }
  return typeof acceptEncoding === 'string' && acceptEncoding.includes('gzip');
}

function resolveAssetPath(assetRoot, requestPathname) {
  const relativePath = requestPathname.replace(/^\/+/, '');
  if (relativePath.length === 0) {
    return null;
  }

  const candidatePath = path.resolve(assetRoot, relativePath);
  const rootWithSeparator = assetRoot.endsWith(path.sep) ? assetRoot : `${assetRoot}${path.sep}`;
  if (!candidatePath.startsWith(rootWithSeparator)) {
    return null;
  }

  return candidatePath;
}

async function maybeServeStaticAsset({ req, res, pathname, assetRoots }) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return false;
  }

  let decodedPathname;
  try {
    decodedPathname = decodeURIComponent(pathname);
  } catch {
    return false;
  }

  if (decodedPathname === '/' || decodedPathname.endsWith('/')) {
    return false;
  }

  const candidatePaths = assetRoots
    .map((root) => resolveAssetPath(root, decodedPathname))
    .filter((assetPath) => typeof assetPath === 'string');

  const candidates = await Promise.all(
    candidatePaths.map(async (assetPath) => {
      try {
        const stats = await fs.stat(assetPath);
        if (!stats.isFile()) {
          return null;
        }
        return { assetPath, stats };
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
          return null;
        }
        throw error;
      }
    })
  );

  const resolvedCandidate = candidates.find((candidate) => candidate !== null);
  if (!resolvedCandidate) {
    return false;
  }

  res.statusCode = 200;
  const contentType = getContentType(resolvedCandidate.assetPath);
  const shouldCompress = acceptsGzip(req) && isCompressibleContentType(contentType);

  applySecurityHeaders(res);
  res.setHeader('content-type', contentType);
  res.setHeader('cache-control', getCacheControl(decodedPathname));
  if (shouldCompress) {
    res.setHeader('content-encoding', 'gzip');
    res.setHeader('vary', 'accept-encoding');
  } else {
    res.setHeader('content-length', String(resolvedCandidate.stats.size));
  }

  if (req.method === 'HEAD') {
    res.end();
    return true;
  }

  if (shouldCompress) {
    await pipeline(createReadStream(resolvedCandidate.assetPath), createGzip(), res);
  } else {
    await pipeline(createReadStream(resolvedCandidate.assetPath), res);
  }
  return true;
}

async function loadFetchHandler() {
  const thisFilePath = fileURLToPath(import.meta.url);
  const thisDir = path.dirname(thisFilePath);
  const serverEntryPath = path.resolve(thisDir, '../dist/server/server.js');
  const serverEntryUrl = pathToFileURL(serverEntryPath).href;

  const mod = await import(serverEntryUrl);
  const maybeHandler = mod?.default?.fetch;

  if (typeof maybeHandler !== 'function') {
    throw new Error(
      `Expected default export with fetch(request) in ${serverEntryPath}, but did not find it.`
    );
  }

  return maybeHandler;
}

async function main() {
  const fetchHandler = await loadFetchHandler();
  const thisFilePath = fileURLToPath(import.meta.url);
  const thisDir = path.dirname(thisFilePath);
  const assetRoots = [path.resolve(thisDir, '../dist/client'), path.resolve(thisDir, '../public')];

  const port = Number.parseInt(process.env['PORT'] ?? '3001', 10);
  const host = process.env['HOST'] ?? '0.0.0.0';

  const handleRequest = async (req, res) => {
    try {
      const method = req.method ?? 'GET';
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? `localhost:${port}`}`);

      if (
        await maybeServeStaticAsset({
          req,
          res,
          pathname: url.pathname,
          assetRoots,
        })
      ) {
        return;
      }

      const requestHeaders = toRequestHeaders(req.headers);
      const hasBody = method !== 'GET' && method !== 'HEAD';

      const request = new Request(url, {
        method,
        headers: requestHeaders,
        body: hasBody ? Readable.toWeb(req) : undefined,
        ...(hasBody ? { duplex: 'half' } : {}),
      });

      const response = await fetchHandler(request);

      res.statusCode = response.status;
      res.statusMessage = response.statusText;

      const setCookie = response.headers.getSetCookie?.();
      if (setCookie && setCookie.length > 0) {
        res.setHeader('set-cookie', setCookie);
      }

      response.headers.forEach((value, key) => {
        if (key.toLowerCase() === 'set-cookie') {
          return;
        }
        res.setHeader(key, value);
      });
      applySecurityHeaders(res);

      if (!response.body) {
        res.end();
        return;
      }

      const responseContentType = response.headers.get('content-type') ?? '';
      const responseAlreadyEncoded = response.headers.has('content-encoding');
      const shouldCompress =
        acceptsGzip(req) &&
        !responseAlreadyEncoded &&
        isCompressibleContentType(responseContentType);

      if (shouldCompress) {
        res.removeHeader('content-length');
        res.setHeader('content-encoding', 'gzip');
        res.setHeader('vary', 'accept-encoding');
        await pipeline(Readable.fromWeb(response.body), createGzip(), res);
        return;
      }

      Readable.fromWeb(response.body).pipe(res);
    } catch (error) {
      writeError(
        JSON.stringify({
          level: 'error',
          message: 'Request handling failed',
          error: error instanceof Error ? error.message : String(error),
        })
      );
      res.statusCode = 500;
      res.end('Internal Server Error');
    }
  };

  const server = createServer((req, res) => {
    void handleRequest(req, res);
  });

  server.on('error', (error) => {
    writeError(
      JSON.stringify({
        level: 'error',
        message: 'Server startup failed',
        error: error instanceof Error ? error.message : String(error),
      })
    );
    process.exitCode = 1;
  });

  server.listen(port, host, () => {
    writeInfo(
      JSON.stringify({
        level: 'info',
        message: 'Marketing server listening',
        host,
        port,
      })
    );
  });
}

main().catch((error) => {
  writeError(
    JSON.stringify({
      level: 'error',
      message: 'Failed to start marketing server',
      error: error instanceof Error ? error.message : String(error),
    })
  );
  process.exit(1);
});

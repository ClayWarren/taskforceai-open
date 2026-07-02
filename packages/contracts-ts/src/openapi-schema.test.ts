import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'bun:test';

type Operation = {
  operationId?: string;
};

type PathItem = {
  get?: Operation;
  post?: Operation;
  delete?: Operation;
};

type OpenApiDocument = {
  paths?: Record<string, PathItem>;
};

const packageSrcDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(packageSrcDir, '../../..');
const schemaPath = join(packageSrcDir, '../schema/openapi.json');
const ensureSchemaScript = join(repoRoot, 'scripts/dev/ensure-openapi-spec.sh');

const ensureSchema = () => {
  if (existsSync(schemaPath)) {
    return;
  }

  const result = spawnSync(ensureSchemaScript, {
    cwd: repoRoot,
    env: process.env,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`Failed to generate OpenAPI schema with ${ensureSchemaScript}`);
  }
};

const loadSchema = (): OpenApiDocument => {
  ensureSchema();
  return JSON.parse(readFileSync(schemaPath, 'utf8')) as OpenApiDocument;
};

describe('contracts-ts unified OpenAPI schema', () => {
  it('documents client-supported MFA, storage, and thread routes', () => {
    const paths = loadSchema().paths ?? {};

    expect(paths['/api/v1/auth/mfa']?.get?.operationId).toBe('get-auth-mfa-status');
    expect(paths['/api/v1/auth/mfa/authenticator']?.delete?.operationId).toBe(
      'disable-authenticator-mfa'
    );
    expect(paths['/api/v1/auth/mfa/authenticator/setup']?.post?.operationId).toBe(
      'setup-authenticator-mfa'
    );
    expect(paths['/api/v1/auth/mfa/authenticator/verify']?.post?.operationId).toBe(
      'verify-authenticator-mfa'
    );
    expect(paths['/api/v1/developer/storage']?.get?.operationId).toBe('developer-storage-summary');
    expect(paths['/api/v1/developer/threads/{id}']?.get?.operationId).toBe('developer-get-thread');
  }, 60000);
});

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'bun:test';

type OpenApiOperation = {
  operationId?: string;
  tags?: string[];
  parameters?: unknown[];
  responses?: Record<string, unknown>;
  requestBody?: unknown;
};

type OpenApiPathItem = Partial<Record<(typeof HTTP_METHODS)[number], OpenApiOperation>>;

type OpenApiDocument = {
  openapi?: string;
  info?: {
    title?: string;
    version?: string;
  };
  servers?: Array<{ url?: string }>;
  security?: unknown[];
  paths?: Record<string, OpenApiPathItem>;
  components?: {
    securitySchemes?: Record<string, unknown>;
    schemas?: Record<string, unknown>;
  };
  tags?: Array<{ name?: string }>;
};

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'patch', 'options', 'head', 'trace'] as const;

const specPath = join(dirname(fileURLToPath(import.meta.url)), 'openapi.yaml');

const loadSpec = (): OpenApiDocument =>
  Bun.YAML.parse(readFileSync(specPath, 'utf8')) as OpenApiDocument;

const operationEntries = (spec: OpenApiDocument) => {
  const paths = spec.paths ?? {};
  return Object.entries(paths).flatMap(([pathName, pathItem]) =>
    HTTP_METHODS.flatMap((method) => {
      const operation = pathItem[method];
      return operation ? [{ pathName, method, operation }] : [];
    })
  );
};

const resolveLocalRef = (spec: OpenApiDocument, ref: string): unknown => {
  if (!ref.startsWith('#/')) {
    return undefined;
  }

  return ref
    .slice(2)
    .split('/')
    .reduce<unknown>((current, segment) => {
      if (current && typeof current === 'object' && segment in current) {
        return (current as Record<string, unknown>)[segment];
      }
      return undefined;
    }, spec);
};

const collectRefs = (value: unknown): string[] => {
  if (!value || typeof value !== 'object') {
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap(collectRefs);
  }

  const record = value as Record<string, unknown>;
  const ownRef = typeof record['$ref'] === 'string' ? [record['$ref']] : [];
  return ownRef.concat(Object.values(record).flatMap(collectRefs));
};

describe('canonical public OpenAPI spec', () => {
  const spec = loadSpec();

  it('parses as the versioned Developer API document', () => {
    expect(spec.openapi).toBe('3.0.0');
    expect(spec.info?.title).toBe('TaskForceAI Developer API');
    expect(spec.servers?.map((server) => server.url)).toContain('https://taskforceai.chat/api');
    expect(spec.security).toEqual([{ ApiKeyAuth: [] }]);
    expect(spec.components?.securitySchemes?.['ApiKeyAuth']).toEqual({
      type: 'apiKey',
      in: 'header',
      name: 'x-api-key',
      description:
        'API key for authentication. Get yours from the console at https://console.taskforceai.chat',
    });
  });

  it('keeps every public path under the versioned API prefix', () => {
    expect(Object.keys(spec.paths ?? {}).every((pathName) => pathName.startsWith('/v1/'))).toBe(
      true
    );
  });

  it('documents the runtime developer task routes', () => {
    expect(spec.paths?.['/v1/developer/run']?.post?.operationId).toBe('submitTask');
    expect(spec.paths?.['/v1/developer/status/{taskId}']?.get?.operationId).toBe('getTaskStatus');
    expect(spec.paths?.['/v1/developer/results/{taskId}']?.get?.operationId).toBe('getTaskResults');
  });

  it('keeps API key lifecycle operations on the developer keys route', () => {
    expect(spec.paths?.['/v1/developer/keys']?.get?.operationId).toBe('listAPIKeys');
    expect(spec.paths?.['/v1/developer/keys']?.post?.operationId).toBe('createAPIKey');
    expect(spec.paths?.['/v1/developer/keys']?.delete?.operationId).toBe('revokeAPIKey');
    expect(spec.paths?.['/v1/sync/status']?.delete).toBeUndefined();
  });

  it('declares unique operation ids and known tags for each operation', () => {
    const declaredTags = new Set((spec.tags ?? []).map((tag) => tag.name).filter(Boolean));
    const ids = operationEntries(spec).map(({ operation }) => operation.operationId);

    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);

    for (const { operation } of operationEntries(spec)) {
      expect(operation.tags?.length).toBeGreaterThan(0);
      expect(operation.tags?.every((tag) => declaredTags.has(tag))).toBe(true);
      expect(Object.keys(operation.responses ?? {}).length).toBeGreaterThan(0);
    }
  });

  it('only references schemas that exist in the document', () => {
    const refs = collectRefs(spec);

    expect(refs.length).toBeGreaterThan(0);
    expect(refs.every((ref) => resolveLocalRef(spec, ref) !== undefined)).toBe(true);
  });
});

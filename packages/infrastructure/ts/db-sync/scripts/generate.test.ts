import { afterEach, describe, expect, it } from 'bun:test';
import { Database } from 'bun:sqlite';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  assertDrizzleSchemaMatchesSqlite,
  collectDrizzleSchemaColumns,
  diff,
  formatGeneratedArtifacts,
  postProcess,
  prismaDiffArgs,
  prismaDiffConfig,
  rewriteSchemaForProvider,
  run,
  syncMigrations,
  type RunOptions,
} from './generate';

const tempDirs: string[] = [];

const makeTempDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'db-sync-generate-'));
  tempDirs.push(dir);
  return dir;
};

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir && fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('run', () => {
  it('throws when command exits non-zero', () => {
    const failingSpawn = (() => ({ status: 2, stdout: '' })) as unknown as typeof spawnSync;

    expect(() => run('bun', ['run', 'missing-script'], {}, failingSpawn)).toThrow(
      'bun run missing-script failed: 2'
    );
  });

  it('surfaces spawn errors when a binary is missing', () => {
    const failingSpawn = (() => ({
      error: new Error('spawn bun ENOENT'),
      status: null,
      stdout: '',
    })) as unknown as typeof spawnSync;

    expect(() => run('bun', ['run', 'missing-script'], {}, failingSpawn)).toThrow(
      'bun run missing-script failed: spawn bun ENOENT'
    );
  });
});

describe('rewriteSchemaForProvider', () => {
  const prismaSchema = `datasource db {
  provider = "sqlite"
}

model Conversation {
  id String @id
}`;

  it('keeps sqlite schema datasource URL-free for Prisma 7', () => {
    const rewritten = rewriteSchemaForProvider(prismaSchema, 'sqlite');

    expect(rewritten).toContain('provider = "sqlite"');
    expect(rewritten).not.toContain('url =');
  });

  it('rewrites postgresql schema provider and datasource url', () => {
    const rewritten = rewriteSchemaForProvider(prismaSchema, 'postgresql');

    expect(rewritten).toContain('provider = "postgresql"');
    expect(rewritten).not.toContain('url =');
    expect(rewritten).not.toContain('provider = "sqlite"');
  });

  it('removes existing datasource url', () => {
    const schemaWithUrl = `datasource db {
  provider = "sqlite"
  url = env("DATABASE_URL")
}

model Conversation {
  id String @id
}`;

    const rewritten = rewriteSchemaForProvider(schemaWithUrl, 'sqlite');

    expect(rewritten).toContain('provider = "sqlite"');
    expect(rewritten).not.toContain('url =');
  });

  it('rewrites datasource with flexible whitespace', () => {
    const schemaWithSpacing = `datasource  db{
  provider = "sqlite"
}

model Conversation {
  id String @id
}`;

    const rewritten = rewriteSchemaForProvider(schemaWithSpacing, 'sqlite');
    expect(rewritten).toContain('datasource db {');
    expect(rewritten).toContain('provider = "sqlite"');
    expect(rewritten).not.toContain('url =');
  });
});

describe('prismaDiffArgs', () => {
  it('uses the Prisma 7 schema diff flag', () => {
    const args = prismaDiffArgs('/tmp/schema.prisma', '/tmp/prisma.config.mjs');

    expect(args).toContain('--config');
    expect(args).toContain('/tmp/prisma.config.mjs');
    expect(args).toContain('--to-schema');
    expect(args).toContain('/tmp/schema.prisma');
    expect(args).not.toContain('--to-schema-datamodel');
  });
});

describe('prismaDiffConfig', () => {
  it('writes datasource URL into Prisma config instead of the schema', () => {
    const config = prismaDiffConfig('/tmp/schema.prisma', 'file:/tmp/shadow.db');

    expect(config).toContain('schema: "/tmp/schema.prisma"');
    expect(config).toContain('url: "file:/tmp/shadow.db"');
    expect(config).not.toContain('env("SYNC_DATABASE_URL")');
  });
});

describe('diff', () => {
  it('uses the injectable async runner with provider-specific schema and config files', async () => {
    const tempDir = makeTempDir();
    const schemaPath = path.join(tempDir, 'schema.prisma');
    const tmpDir = path.join(tempDir, '.tmp');
    const pkgDir = path.join(tempDir, 'pkg');
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(
      schemaPath,
      `datasource db {
  provider = "sqlite"
}

model Conversation {
  id String @id
}
`
    );
    const calls: Array<{ args: string[]; cmd: string; cwd?: string }> = [];

    const sql = await diff(
      'postgresql',
      { schemaPath, tmpDir, pkgDir },
      async (cmd, args, opts = {}) => {
        calls.push({ cmd, args, cwd: opts.cwd });
        return '  -- sql  \n';
      }
    );

    const generatedSchemaPath = path.join(tmpDir, 'schema.postgres.prisma');
    const generatedConfigPath = path.join(tmpDir, 'prisma.postgresql.config.mjs');
    expect(sql).toBe('-- sql');
    expect(calls).toEqual([
      {
        cmd: 'bunx',
        args: prismaDiffArgs(generatedSchemaPath, generatedConfigPath),
        cwd: pkgDir,
      },
    ]);
    expect(fs.readFileSync(generatedSchemaPath, 'utf8')).toContain('provider = "postgresql"');
    expect(fs.readFileSync(generatedConfigPath, 'utf8')).toContain(
      'postgresql://user:password@localhost:5432/taskforceai'
    );
  });
});

describe('postProcess', () => {
  it('rewrites typed columns, cleans imports, and appends mobile schema exports', async () => {
    const tempDir = makeTempDir();
    const schemaFile = path.join(tempDir, 'schema.ts');
    const prismaSchema = path.join(tempDir, 'schema.prisma');

    fs.writeFileSync(
      prismaSchema,
      `datasource db {
  provider = "sqlite"
}

model Conversation {
  id               Int     @id
  isDeleted        Boolean @default(false) @map("is_deleted")
  isStreaming      Boolean @default(false) @map("is_streaming")
  isAgentStatus    Boolean @default(false) @map("is_agent_status")
  isArchived       Boolean @default(false) @map("is_archived")
  enabledByDefault Boolean @default(true) @map("enabled_by_default")
  optionalFlag     Boolean? @map("optional_flag")
  sources          Json?   @map("sources")
  toolEvents       Json?   @map("tool_events")
  agentStatuses    Json?   @map("agent_statuses")
  metadata         Json?   @map("metadata")

  @@map("conversations")
}

model PendingChange {
  id   Int  @id
  data Json

  @@map("pending_changes")
}

model UserProfile {
  id   Int @id
  data Json? @map("data")

  @@map("user_profiles")
}
`
    );

    fs.writeFileSync(
      schemaFile,
      `import { sql } from 'drizzle-orm';
import { sqliteTable, numeric, AnySQLiteColumn, foreignKey } from 'drizzle-orm/sqlite-core';

export const conversations = sqliteTable('conversations', {
  isDeleted: numeric('is_deleted'),
  isStreaming: numeric('is_streaming'),
  isAgentStatus: numeric('is_agent_status'),
  isArchived: numeric('is_archived'),
  enabledByDefault: numeric('enabled_by_default'),
  optionalFlag: numeric('optional_flag'),
  sources: numeric('sources'),
  toolEvents: numeric('tool_events'),
  agentStatuses: numeric('agent_statuses'),
  metadata: numeric('metadata'),
});

export const messages = sqliteTable('messages', {});
export const pendingChanges = sqliteTable('pending_changes', {
  data: numeric('data').notNull(),
});
export const metadata = sqliteTable('metadata', {});
export const pendingPrompts = sqliteTable('pending_prompts', {});
export const promptQueue = sqliteTable('prompt_queue', {});
export const authSessions = sqliteTable('auth_sessions', {});
export const userProfiles = sqliteTable('user_profiles', {
  data: numeric('data'),
});
`
    );

    const changed = await postProcess(schemaFile, { prismaSchemaPath: prismaSchema });
    const output = fs.readFileSync(schemaFile, 'utf8');

    expect(changed).toBe(true);
    expect(output).toMatch(
      /isDeleted:\s*integer\(["']is_deleted["'], \{ mode: ["']boolean["'] \}\)\.default\(false\)\.notNull\(\)/
    );
    expect(output).toMatch(
      /isStreaming:\s*integer\(["']is_streaming["'], \{ mode: ["']boolean["'] \}\)\.default\(false\)\.notNull\(\)/
    );
    expect(output).toMatch(
      /isAgentStatus:\s*integer\(["']is_agent_status["'], \{ mode: ["']boolean["'] \}\)\.default\(false\)\.notNull\(\)/
    );
    expect(output).toMatch(
      /isArchived:\s*integer\(["']is_archived["'], \{ mode: ["']boolean["'] \}\)\.default\(false\)\.notNull\(\)/
    );
    expect(output).toMatch(
      /enabledByDefault:\s*integer\(["']enabled_by_default["'], \{ mode: ["']boolean["'] \}\)\.default\(true\)\.notNull\(\)/
    );
    expect(output).toMatch(
      /optionalFlag:\s*integer\(["']optional_flag["'], \{ mode: ["']boolean["'] \}\),/
    );
    expect(output).toContain("text('sources')");
    expect(output).toContain("text('tool_events')");
    expect(output).toContain("text('agent_statuses')");
    expect(output).toContain("text('metadata')");
    expect(output).toContain("data: text('data'),");
    expect(output).toMatch(/data:\s*text\(["']data["']\)\.notNull\(\)/);
    expect(output).toContain('InferSelectModel');
    expect(output).toContain('export type MobileSchema = typeof mobileSchema;');
    expect(output).not.toContain('numeric');
    expect(output).not.toContain('AnySQLiteColumn');
    expect(output).not.toContain('foreignKey');
    expect(output).not.toMatch(/import\s*\{\s*sql(?:\s*,|\s*\})/);
  });

  it('is idempotent and does not duplicate mobile schema exports', async () => {
    const tempDir = makeTempDir();
    const schemaFile = path.join(tempDir, 'schema.ts');

    fs.writeFileSync(
      schemaFile,
      `import { sqliteTable, numeric } from 'drizzle-orm/sqlite-core';

export const conversations = sqliteTable('conversations', {});
export const messages = sqliteTable('messages', {});
export const pendingChanges = sqliteTable('pending_changes', { data: numeric('data') });
export const metadata = sqliteTable('metadata', {});
export const pendingPrompts = sqliteTable('pending_prompts', {});
export const promptQueue = sqliteTable('prompt_queue', {});
export const authSessions = sqliteTable('auth_sessions', {});
export const userProfiles = sqliteTable('user_profiles', {});
`
    );

    await postProcess(schemaFile);
    await postProcess(schemaFile);
    const output = fs.readFileSync(schemaFile, 'utf8');

    expect(output.match(/export const mobileSchema = \{/g)?.length).toBe(1);
    expect(output.match(/export type MobileSchema = typeof mobileSchema;/g)?.length).toBe(1);
  });

  it('does not emit references to undefined table declarations', async () => {
    const tempDir = makeTempDir();
    const schemaFile = path.join(tempDir, 'schema.ts');

    fs.writeFileSync(
      schemaFile,
      `import { sqliteTable } from 'drizzle-orm/sqlite-core';

export const conversations = sqliteTable('conversations', {});
export const messages = sqliteTable('messages', {});
export const pendingChanges = sqliteTable('pending_changes', {});
export const metadata = sqliteTable('metadata', {});
`
    );

    await postProcess(schemaFile);
    const output = fs.readFileSync(schemaFile, 'utf8');

    expect(output).toContain('conversations');
    expect(output).toContain('messages');
    expect(output).toContain('pendingChanges');
    expect(output).toContain('metadata');
    expect(output).not.toContain('pendingPrompts,');
    expect(output).not.toContain('promptQueue,');
    expect(output).not.toContain('authSessions,');
    expect(output).not.toContain('userProfiles,');
  });
});

describe('collectDrizzleSchemaColumns', () => {
  it('extracts implicit and explicit column names by table', () => {
    const columns =
      collectDrizzleSchemaColumns(`import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core';

export const conversations = sqliteTable(
  'conversations',
  {
    id: integer().primaryKey(),
    conversationId: text('conversation_id').notNull(),
  }
);
`);

    expect(columns.get('conversations')).toEqual(new Set(['id', 'conversation_id']));
  });
});

describe('assertDrizzleSchemaMatchesSqlite', () => {
  it('throws when the generated schema is missing an SQLite artifact column', () => {
    const tempDir = makeTempDir();
    const sqlitePath = path.join(tempDir, 'sync.sqlite');
    const schemaFile = path.join(tempDir, 'schema.ts');
    const db = new Database(sqlitePath);
    db.exec(
      'CREATE TABLE conversations (id INTEGER PRIMARY KEY, is_archived BOOLEAN NOT NULL DEFAULT false);'
    );
    db.close();
    fs.writeFileSync(
      schemaFile,
      `import { sqliteTable, integer } from 'drizzle-orm/sqlite-core';

export const conversations = sqliteTable('conversations', {
  id: integer().primaryKey(),
});
`
    );

    expect(() => assertDrizzleSchemaMatchesSqlite(sqlitePath, schemaFile)).toThrow(
      'missing generated column conversations.is_archived'
    );
  });
});

describe('syncMigrations', () => {
  it('returns false and skips migrations.ts when journal JSON is invalid', async () => {
    const mobileDir = makeTempDir();
    const migrationsDir = path.join(mobileDir, 'drizzle');
    fs.mkdirSync(path.join(migrationsDir, 'meta'), { recursive: true });
    fs.writeFileSync(path.join(migrationsDir, 'meta', '_journal.json'), '{invalid-json');
    fs.writeFileSync(path.join(migrationsDir, '0000_init.sql'), 'create table test(id integer);\n');

    const synced = await syncMigrations(mobileDir);

    expect(synced).toBe(false);
    expect(fs.existsSync(path.join(migrationsDir, 'migrations.ts'))).toBe(false);
  });

  it('returns false and skips migrations.ts when journal shape is invalid', async () => {
    const mobileDir = makeTempDir();
    const migrationsDir = path.join(mobileDir, 'drizzle');
    fs.mkdirSync(path.join(migrationsDir, 'meta'), { recursive: true });
    fs.writeFileSync(
      path.join(migrationsDir, 'meta', '_journal.json'),
      JSON.stringify({ version: '7', dialect: 'sqlite', entries: [{ idx: 0 }] })
    );
    fs.writeFileSync(path.join(migrationsDir, '0000_init.sql'), 'create table test(id integer);\n');

    const synced = await syncMigrations(mobileDir);

    expect(synced).toBe(false);
    expect(fs.existsSync(path.join(migrationsDir, 'migrations.ts'))).toBe(false);
  });

  it('escapes template interpolation markers in SQL files', async () => {
    const mobileDir = makeTempDir();
    const migrationsDir = path.join(mobileDir, 'drizzle');
    fs.mkdirSync(path.join(migrationsDir, 'meta'), { recursive: true });
    fs.writeFileSync(
      path.join(migrationsDir, 'meta', '_journal.json'),
      JSON.stringify({
        version: '7',
        dialect: 'sqlite',
        entries: [{ idx: 0, version: '6', when: 0, tag: '0000_init', breakpoints: true }],
      })
    );
    fs.writeFileSync(
      path.join(migrationsDir, '0000_init.sql'),
      "INSERT INTO test(value) VALUES('${process.version}');\n"
    );

    const synced = await syncMigrations(mobileDir);
    const moduleUrl = pathToFileURL(path.join(migrationsDir, 'migrations.ts')).href;
    const generated = (await import(moduleUrl)) as { migrations: Record<string, string> };

    expect(synced).toBe(true);
    expect(generated.migrations['m0000']).toContain('${process.version}');
  });

  it('quotes migration keys so filenames without underscore remain valid TS', async () => {
    const mobileDir = makeTempDir();
    const migrationsDir = path.join(mobileDir, 'drizzle');
    fs.mkdirSync(path.join(migrationsDir, 'meta'), { recursive: true });
    fs.writeFileSync(
      path.join(migrationsDir, 'meta', '_journal.json'),
      JSON.stringify({
        version: '7',
        dialect: 'sqlite',
        entries: [{ idx: 0, version: '6', when: 0, tag: '0000', breakpoints: true }],
      })
    );
    fs.writeFileSync(path.join(migrationsDir, '0000.sql'), 'CREATE TABLE t(id integer);\n');

    const synced = await syncMigrations(mobileDir);
    const moduleUrl = pathToFileURL(path.join(migrationsDir, 'migrations.ts')).href;
    const generated = (await import(moduleUrl)) as { migrations: Record<string, string> };

    expect(synced).toBe(true);
    expect(generated.migrations['m0000']).toContain('CREATE TABLE t(id integer);');
  });
});

describe('formatGeneratedArtifacts', () => {
  it('formats only package schema artifacts instead of app-owned files', () => {
    const tempDir = makeTempDir();
    const rootDir = path.join(tempDir, 'repo');
    const pkgDir = path.join(rootDir, 'packages', 'infrastructure', 'ts', 'db-sync');
    const drizzleSchema = path.join(pkgDir, 'drizzle', 'schema.ts');
    const packageArtifacts = path.join(pkgDir, 'artifacts');
    const postgresArtifact = path.join(packageArtifacts, 'schema.postgresql.sql');
    const sqliteArtifact = path.join(packageArtifacts, 'schema.sqlite.sql');
    const packageDrizzle = path.join(pkgDir, 'drizzle');
    const calls: Array<{ args: string[]; cmd: string; cwd?: string }> = [];

    for (const file of [drizzleSchema, postgresArtifact, sqliteArtifact]) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, '');
    }

    formatGeneratedArtifacts(
      {
        rootDir,
        pkgDir,
        drizzleSchema,
      },
      (cmd: string, args: string[], opts: RunOptions = {}) => {
        calls.push({ cmd, args, cwd: opts.cwd });
        return '';
      }
    );

    expect(calls).toEqual([
      {
        cmd: 'bun',
        args: ['x', 'oxfmt', '--write', drizzleSchema],
        cwd: rootDir,
      },
      {
        cmd: 'uv',
        args: ['run', '--project', 'apps/evaluation', 'sqlfluff', 'fix', postgresArtifact],
        cwd: rootDir,
      },
      {
        cmd: 'uv',
        args: [
          'run',
          '--project',
          'apps/evaluation',
          'sqlfluff',
          'fix',
          '--dialect',
          'sqlite',
          sqliteArtifact,
          packageDrizzle,
        ],
        cwd: rootDir,
      },
    ]);
    expect(calls.flatMap((call) => call.args)).not.toContain('format');
  });
});

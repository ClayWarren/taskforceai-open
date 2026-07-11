import { parseJsonSchema } from '@taskforceai/client-core/json/parse';
import { Database } from 'bun:sqlite';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

export interface GeneratePaths {
  rootDir: string;
  pkgDir: string;
  tmpDir: string;
  schemaPath: string;
  drizzleSchema: string;
  sqliteDbPath: string;
}

export type Provider = 'sqlite' | 'postgresql';

export const createPaths = (scriptUrl: string = import.meta.url): GeneratePaths => {
  const scriptDir = path.dirname(fileURLToPath(scriptUrl));
  const rootDir = path.resolve(scriptDir, '../../../../..');
  const pkgDir = path.resolve(scriptDir, '..');
  const tmpDir = path.join(pkgDir, '.tmp');

  return {
    rootDir,
    pkgDir,
    tmpDir,
    schemaPath: path.join(pkgDir, 'schema.prisma'),
    drizzleSchema: path.join(pkgDir, 'drizzle', 'schema.ts'),
    sqliteDbPath: path.join(tmpDir, 'sync.sqlite'),
  };
};

const defaultPaths = createPaths();

const log = (level: 'info' | 'warn' | 'error', message: string, meta?: Record<string, unknown>) => {
  const payload = { level, message, timestamp: new Date().toISOString(), ...meta };
  const line = `${JSON.stringify(payload)}\n`;
  if (level === 'error' || level === 'warn') {
    process.stderr.write(line);
    return;
  }
  process.stdout.write(line);
};

export interface RunOptions {
  cwd?: string;
  env?: Record<string, string>;
  input?: string | Buffer;
  cap?: boolean;
}

export const run = (
  cmd: string,
  args: string[],
  opts: RunOptions = {},
  spawnSyncFn: typeof spawnSync = spawnSync
) => {
  const res = spawnSyncFn(cmd, args, {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env } as NodeJS.ProcessEnv,
    input: opts.input,
    stdio: opts.cap ? ['pipe', 'pipe', 'inherit'] : 'inherit',
    encoding: 'utf-8',
  });
  if (res.error) throw new Error(`${cmd} ${args.join(' ')} failed: ${res.error.message}`);
  if (res.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed: ${res.status}`);
  return res.stdout || '';
};

export type AsyncRunner = (cmd: string, args: string[], opts?: RunOptions) => Promise<string>;

export const runAsync: AsyncRunner = (cmd, args, opts = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env } as NodeJS.ProcessEnv,
      stdio: [opts.input ? 'pipe' : 'ignore', opts.cap ? 'pipe' : 'inherit', 'inherit'],
    });
    let stdout = '';
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.on('error', reject);
    child.on('close', (status) => {
      if (status !== 0) {
        reject(new Error(`${cmd} ${args.join(' ')} failed: ${status}`));
        return;
      }
      resolve(stdout);
    });
    if (opts.input && child.stdin) {
      child.stdin.end(opts.input);
    }
  });

const datasourceDbBlockPattern = /datasource\s+db\s*\{[\s\S]*?\}/m;

export const rewriteSchemaForProvider = (schema: string, provider: Provider) => {
  const datasourceBlock = schema.match(datasourceDbBlockPattern)?.[0];
  if (!datasourceBlock) {
    throw new Error('schema.prisma is missing datasource db block');
  }

  let rewrittenBlock = datasourceBlock
    .replace(/^\s*url\s*=.*\n?/gm, '')
    .replace(/datasource\s+db\s*\{/, 'datasource db {');

  if (/^\s*provider\s*=.*$/m.test(rewrittenBlock)) {
    rewrittenBlock = rewrittenBlock.replace(/^\s*provider\s*=.*$/m, `  provider = "${provider}"`);
  } else {
    rewrittenBlock = rewrittenBlock.replace(
      /datasource\s+db\s*\{/,
      `datasource db {\n  provider = "${provider}"`
    );
  }

  return schema.replace(datasourceDbBlockPattern, rewrittenBlock);
};

export const prismaDiffConfig = (schemaPath: string, datasourceUrl: string) => `export default {
  schema: ${JSON.stringify(schemaPath)},
  datasource: {
    url: ${JSON.stringify(datasourceUrl)},
  },
};
`;

export const prismaDiffArgs = (schemaPath: string, configPath: string) => [
  'prisma',
  'migrate',
  'diff',
  '--config',
  configPath,
  '--from-empty',
  '--to-schema',
  schemaPath,
  '--script',
];

export const diff = async (
  provider: Provider,
  paths: Pick<GeneratePaths, 'schemaPath' | 'tmpDir' | 'pkgDir'> = defaultPaths,
  runner: AsyncRunner = runAsync
) => {
  const rewrittenSchema = rewriteSchemaForProvider(
    await Bun.file(paths.schemaPath).text(),
    provider
  );
  const schema = path.join(
    paths.tmpDir,
    provider === 'postgresql' ? 'schema.postgres.prisma' : 'schema.sqlite.prisma'
  );
  await Bun.write(schema, rewrittenSchema);

  const shadowDb = path.join(paths.tmpDir, 'shadow.db');
  if (provider === 'sqlite' && !fs.existsSync(shadowDb)) {
    fs.closeSync(fs.openSync(shadowDb, 'w'));
  }
  const datasourceUrl =
    provider === 'sqlite'
      ? `file:${path.join(paths.tmpDir, 'shadow.db')}`
      : 'postgresql://user:password@localhost:5432/taskforceai';
  const configPath = path.join(paths.tmpDir, `prisma.${provider}.config.mjs`);
  await Bun.write(configPath, prismaDiffConfig(schema, datasourceUrl));

  return (
    await runner('bunx', prismaDiffArgs(schema, configPath), {
      cwd: paths.pkgDir,
      env: {
        PRISMA_HIDE_UPDATE_MESSAGE: '1',
      },
      cap: true,
    })
  ).trim();
};

const write = async (p: string, c: string, rootDir: string = defaultPaths.rootDir) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  await Bun.write(p, c);
  log('info', 'Wrote file', { path: path.relative(rootDir, p) });
};

export const mobileSchemaReExport = "export * from '@taskforceai/db-sync/drizzle/schema';\n";

export type PrismaColumnMetadata = {
  kind: 'boolean' | 'json';
  nullable: boolean;
  defaultValue?: boolean;
};

const capture = (match: RegExpMatchArray, index: number): string => match[index] ?? '';

export const parsePrismaColumnMetadata = (schema: string): Map<string, PrismaColumnMetadata> => {
  const columns = new Map<string, PrismaColumnMetadata>();
  const modelPattern = /model\s+([A-Za-z_$][\w$]*)\s*\{([\s\S]*?)\n\}/g;
  for (const modelMatch of schema.matchAll(modelPattern)) {
    const modelName = capture(modelMatch, 1);
    const block = capture(modelMatch, 2);
    const tableName = block.match(/@@map\("([^"]+)"\)/)?.[1] ?? modelName;

    for (const rawLine of block.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('//') || line.startsWith('@@')) continue;

      const fieldMatch = line.match(/^([A-Za-z_$][\w$]*)\s+([A-Za-z_$][\w$]*)(\?)?(?:\s+|$)(.*)$/);
      if (!fieldMatch) continue;

      const fieldName = capture(fieldMatch, 1);
      const prismaType = capture(fieldMatch, 2);
      if (prismaType !== 'Boolean' && prismaType !== 'Json') continue;

      const nullable = fieldMatch[3] === '?';
      const attributes = capture(fieldMatch, 4);
      const columnName = attributes.match(/@map\("([^"]+)"\)/)?.[1] ?? fieldName;
      const defaultMatch = attributes.match(/@default\((true|false)\)/);
      const metadata: PrismaColumnMetadata = {
        kind: prismaType === 'Boolean' ? 'boolean' : 'json',
        nullable,
      };
      if (prismaType === 'Boolean' && defaultMatch) {
        metadata.defaultValue = defaultMatch[1] === 'true';
      }

      columns.set(`${tableName}.${columnName}`, metadata);
    }
  }
  return columns;
};

export const postProcess = async (
  schemaFilePath: string = defaultPaths.drizzleSchema,
  options: { prismaSchemaPath?: string } = {}
) => {
  if (!fs.existsSync(schemaFilePath)) return false;
  let source = await Bun.file(schemaFilePath).text();
  const prismaSchemaPath = options.prismaSchemaPath ?? defaultPaths.schemaPath;
  const columnMetadata = fs.existsSync(prismaSchemaPath)
    ? parsePrismaColumnMetadata(await Bun.file(prismaSchemaPath).text())
    : new Map<string, PrismaColumnMetadata>();

  source = normalizeNamedImport(source, 'drizzle-orm/sqlite-core', {
    add: ['integer', 'text'],
    remove: ['AnySQLiteColumn', 'foreignKey'],
  });
  source = normalizeDrizzleOrmImport(source);
  source = rewriteColumnInitializers(source, columnMetadata);
  if (!/\bnumeric\s*\(/.test(source)) {
    source = normalizeNamedImport(source, 'drizzle-orm/sqlite-core', {
      remove: ['numeric'],
    });
  }

  if (!source.includes('export type MobileSchema = typeof mobileSchema;')) {
    const typeMap: Array<{ exportName: string; tableName: string }> = [
      { exportName: 'ConversationRow', tableName: 'conversations' },
      { exportName: 'MessageRow', tableName: 'messages' },
      { exportName: 'PendingChangeRow', tableName: 'pendingChanges' },
      { exportName: 'PromptQueueRow', tableName: 'promptQueue' },
      { exportName: 'AuthSessionRow', tableName: 'authSessions' },
      { exportName: 'UserProfileRow', tableName: 'userProfiles' },
    ];
    const schemaFields = [
      'conversations',
      'messages',
      'pendingChanges',
      'metadata',
      'pendingPrompts',
      'promptQueue',
      'authSessions',
      'userProfiles',
    ].filter((name) => hasExportedConst(source, name));

    const typeLines = typeMap
      .filter(({ tableName }) => hasExportedConst(source, tableName))
      .map(
        ({ exportName, tableName }) =>
          `export type ${exportName} = InferSelectModel<typeof ${tableName}>;`
      );

    source += `
${typeLines.join('\n')}

export const mobileSchema = {
${schemaFields.map((name) => `  ${name},`).join('\n')}
};

export type MobileSchema = typeof mobileSchema;
`;
  }

  await Bun.write(schemaFilePath, source);
  return true;
};

const hasExportedConst = (source: string, name: string) =>
  new RegExp(`\\bexport\\s+const\\s+${name}\\b`).test(source);

const parseNamedImports = (imports: string) =>
  imports
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

const buildNamedImport = (imports: string[], moduleSpecifier: string) =>
  `import { ${imports.join(', ')} } from '${moduleSpecifier}';`;

const normalizeNamedImport = (
  source: string,
  moduleSpecifier: string,
  options: { add?: string[]; remove?: string[] }
) => {
  const importPattern = new RegExp(
    `import\\s*\\{([^}]+)\\}\\s*from\\s*['"]${moduleSpecifier.replace(
      /[.*+?^${}()|[\]\\]/g,
      '\\$&'
    )}['"];?`
  );
  const match = source.match(importPattern);
  if (!match) return source;

  const remove = new Set(options.remove ?? []);
  const imports = parseNamedImports(match[1] ?? '').filter((name) => !remove.has(name));
  for (const name of options.add ?? []) {
    if (!imports.includes(name)) imports.push(name);
  }

  return source.replace(importPattern, buildNamedImport(imports, moduleSpecifier));
};

const normalizeDrizzleOrmImport = (source: string) => {
  const moduleSpecifier = 'drizzle-orm';
  const importPattern = /import\s*\{([^}]+)\}\s*from\s*['"]drizzle-orm['"];?\n?/;
  const match = source.match(importPattern);
  if (!match) {
    return `import { InferSelectModel } from '${moduleSpecifier}';\n${source}`;
  }

  const imports = parseNamedImports(match[1] ?? '');
  const sqlReferenceCount = source.match(/\bsql\b/g)?.length ?? 0;
  const normalized = imports.filter((name) => name !== 'sql' || sqlReferenceCount > 1);
  if (!normalized.includes('InferSelectModel')) normalized.push('InferSelectModel');

  return source.replace(importPattern, `${buildNamedImport(normalized, moduleSpecifier)}\n`);
};

const rewriteColumnInitializers = (
  source: string,
  columnMetadata: Map<string, PrismaColumnMetadata>
) => {
  let pendingTableDeclaration = false;
  let currentTableName: string | undefined;

  return source
    .split('\n')
    .map((line) => {
      const sameLineTableMatch = line.match(
        /\bexport\s+const\s+[A-Za-z_$][\w$]*\s*=\s*sqliteTable\(\s*(['"])([^'"]+)\1/
      );
      if (sameLineTableMatch) {
        currentTableName = sameLineTableMatch[2];
        pendingTableDeclaration = false;
      } else if (/\bexport\s+const\s+[A-Za-z_$][\w$]*\s*=\s*sqliteTable\(/.test(line)) {
        currentTableName = undefined;
        pendingTableDeclaration = true;
      } else if (pendingTableDeclaration) {
        const tableNameMatch = line.match(/^\s*(['"])([^'"]+)\1\s*,?/);
        if (tableNameMatch) {
          currentTableName = tableNameMatch[2];
          pendingTableDeclaration = false;
        }
      }

      const match = line.match(
        /^(\s*)([A-Za-z_$][\w$]*):\s*([A-Za-z_$][\w$]*)\(([^)]*)\)((?:\.[^,\n]+)*)?(,?)$/
      );
      if (!match) return line;

      const indent = capture(match, 1);
      const name = capture(match, 2);
      const initializer = capture(match, 3);
      const rawColumn = capture(match, 4);
      const comma = capture(match, 6);
      if (initializer !== 'numeric' || !currentTableName) return line;

      const column = rawColumn.trim() || `"${name}"`;
      const columnName = column.match(/^['"]([^'"]+)['"]$/)?.[1] ?? name;
      const metadata = columnMetadata.get(`${currentTableName}.${columnName}`);
      if (!metadata) return line;

      if (metadata.kind === 'boolean') {
        const defaultChain =
          metadata.defaultValue === undefined ? '' : `.default(${metadata.defaultValue})`;
        const notNull = metadata.nullable ? '' : '.notNull()';
        return `${indent}${name}: integer(${column}, { mode: "boolean" })${defaultChain}${notNull}${comma}`;
      }

      const notNull = metadata.nullable ? '' : '.notNull()';
      return `${indent}${name}: text(${column})${notNull}${comma}`;
    })
    .join('\n');
};

const quoteSqliteIdentifier = (identifier: string) => `"${identifier.replaceAll('"', '""')}"`;

export const collectDrizzleSchemaColumns = (source: string): Map<string, Set<string>> => {
  const tables = new Map<string, Set<string>>();
  let pendingTableDeclaration = false;
  let currentTableName: string | undefined;

  for (const line of source.split('\n')) {
    const sameLineTableMatch = line.match(
      /\bexport\s+const\s+[A-Za-z_$][\w$]*\s*=\s*sqliteTable\(\s*(['"])([^'"]+)\1/
    );
    if (sameLineTableMatch) {
      const tableName = sameLineTableMatch[2];
      if (!tableName) {
        continue;
      }
      currentTableName = tableName;
      pendingTableDeclaration = false;
      tables.set(currentTableName, tables.get(currentTableName) ?? new Set<string>());
      continue;
    }

    if (/\bexport\s+const\s+[A-Za-z_$][\w$]*\s*=\s*sqliteTable\(/.test(line)) {
      currentTableName = undefined;
      pendingTableDeclaration = true;
      continue;
    }

    if (pendingTableDeclaration) {
      const tableNameMatch = line.match(/^\s*(['"])([^'"]+)\1\s*,?/);
      if (tableNameMatch) {
        const tableName = tableNameMatch[2];
        if (!tableName) {
          continue;
        }
        currentTableName = tableName;
        pendingTableDeclaration = false;
        tables.set(currentTableName, tables.get(currentTableName) ?? new Set<string>());
      }
      continue;
    }

    if (!currentTableName) continue;

    const columnMatch = line.match(
      /^\s*([A-Za-z_$][\w$]*):\s*(?:integer|text|real|numeric)\(([^)]*)\)/
    );
    if (!columnMatch) continue;

    const propertyName = columnMatch[1] ?? '';
    const args = columnMatch[2] ?? '';
    const explicitName = args.match(/^\s*(['"])([^'"]+)\1/)?.[2];
    tables.get(currentTableName)?.add(explicitName ?? propertyName);
  }

  return tables;
};

export const assertDrizzleSchemaMatchesSqlite = (
  sqliteDbPath: string,
  drizzleSchemaPath: string
) => {
  const source = fs.readFileSync(drizzleSchemaPath, 'utf8');
  const drizzleColumns = collectDrizzleSchemaColumns(source);
  const db = new Database(sqliteDbPath, { readonly: true });

  try {
    const sqliteTables = db
      .query(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
      )
      .all() as Array<{ name: string }>;
    const sqliteColumns = new Map<string, Set<string>>();

    for (const table of sqliteTables) {
      const columns = db
        .query(`PRAGMA table_info(${quoteSqliteIdentifier(table.name)})`)
        .all() as Array<{ name: string }>;
      sqliteColumns.set(table.name, new Set(columns.map((column) => column.name)));
    }

    const errors: string[] = [];
    for (const [tableName, columns] of sqliteColumns) {
      const generatedColumns = drizzleColumns.get(tableName);
      if (!generatedColumns) {
        errors.push(`missing generated table ${tableName}`);
        continue;
      }

      for (const columnName of columns) {
        if (!generatedColumns.has(columnName)) {
          errors.push(`missing generated column ${tableName}.${columnName}`);
        }
      }
    }

    for (const [tableName, columns] of drizzleColumns) {
      const artifactColumns = sqliteColumns.get(tableName);
      if (!artifactColumns) {
        errors.push(`extra generated table ${tableName}`);
        continue;
      }

      for (const columnName of columns) {
        if (!artifactColumns.has(columnName)) {
          errors.push(`extra generated column ${tableName}.${columnName}`);
        }
      }
    }

    if (errors.length > 0) {
      throw new Error(
        `Generated Drizzle schema does not match SQLite artifact:\n- ${errors.join('\n- ')}`
      );
    }
  } finally {
    db.close();
  }
};

const migrationJournalEntrySchema = z
  .object({
    idx: z.number().int().nonnegative(),
    version: z.string(),
    when: z.number(),
    tag: z.string().min(1),
    breakpoints: z.boolean(),
  })
  .passthrough();

const migrationJournalSchema = z
  .object({
    version: z.string(),
    dialect: z.literal('sqlite'),
    entries: z.array(migrationJournalEntrySchema),
  })
  .passthrough();

export async function syncMigrations(mobileDirectory: string) {
  const migrationsDir = path.join(mobileDirectory, 'drizzle');
  const journalRaw = await Bun.file(path.join(migrationsDir, 'meta', '_journal.json')).text();
  const journal = parseJsonSchema(journalRaw, migrationJournalSchema);
  if (!journal.ok) return false;

  const files = fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .toSorted();

  const constants: string[] = [];
  const mappings: string[] = [];
  for (const file of files) {
    const keyPrefix = (file.split('_')[0] ?? '').replace(/\.sql$/i, '');
    const key = `m${keyPrefix}`;
    const name = `migration_${file.replace(/[^a-zA-Z0-9]+/g, '_')}`;
    const raw = await Bun.file(path.join(migrationsDir, file)).text();
    const sql = raw.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
    constants.push(`const ${name} = \`${sql.endsWith('\n') ? sql : sql + '\n'}\`;`);
    mappings.push(`  ${JSON.stringify(key)}: ${name},`);
  }

  await Bun.write(
    path.join(migrationsDir, 'migrations.ts'),
    `export const migrationsJournal = ${JSON.stringify(journal.value, null, 2)} as const;\n\n${constants.join('\n\n')}\n\nexport const migrations = {\n${mappings.join('\n')}\n};\n\nexport default { journal: migrationsJournal, migrations };\n`
  );
  return true;
}

export const formatGeneratedArtifacts = (
  paths: Pick<GeneratePaths, 'rootDir' | 'pkgDir' | 'drizzleSchema'> = defaultPaths,
  runner: typeof run = run
) => {
  const typeScriptPaths = [paths.drizzleSchema].filter(fs.existsSync);
  if (typeScriptPaths.length > 0) {
    runner('bun', ['x', 'oxfmt', '--write', ...typeScriptPaths], { cwd: paths.rootDir });
  }

  const postgresArtifact = path.join(paths.pkgDir, 'artifacts', 'schema.postgresql.sql');
  if (fs.existsSync(postgresArtifact)) {
    runner('uv', ['run', '--project', 'apps/evaluation', 'sqlfluff', 'fix', postgresArtifact], {
      cwd: paths.rootDir,
    });
  }

  const sqlitePaths = [
    path.join(paths.pkgDir, 'artifacts', 'schema.sqlite.sql'),
    path.join(paths.pkgDir, 'drizzle'),
  ].filter(fs.existsSync);
  if (sqlitePaths.length > 0) {
    runner(
      'uv',
      [
        'run',
        '--project',
        'apps/evaluation',
        'sqlfluff',
        'fix',
        '--dialect',
        'sqlite',
        ...sqlitePaths,
      ],
      {
        cwd: paths.rootDir,
      }
    );
  }
};

export const generate = async (paths: GeneratePaths = defaultPaths) => {
  fs.mkdirSync(paths.tmpDir, { recursive: true });
  const schemaDiffs = await Promise.all(
    (['sqlite', 'postgresql'] as const).map(async (provider) => ({
      provider,
      sql: await diff(provider, paths),
    }))
  );
  for (const { provider, sql } of schemaDiffs) {
    await write(
      path.join(paths.pkgDir, 'artifacts', `schema.${provider}.sql`),
      `-- AUTO-GENERATED\n\n${sql}\n`,
      paths.rootDir
    );
  }
  const legacyPostgresArtifact = path.join(paths.pkgDir, 'artifacts', 'schema.postgres.sql');
  if (fs.existsSync(legacyPostgresArtifact)) {
    fs.rmSync(legacyPostgresArtifact);
    log('info', 'Removed legacy artifact', {
      path: path.relative(paths.rootDir, legacyPostgresArtifact),
    });
  }

  const sqliteSql = path.join(paths.pkgDir, 'artifacts', 'schema.sqlite.sql');
  if (fs.existsSync(paths.sqliteDbPath)) fs.rmSync(paths.sqliteDbPath);

  const db = new Database(paths.sqliteDbPath);
  db.exec(`PRAGMA foreign_keys=ON;PRAGMA journal_mode=OFF;\n${await Bun.file(sqliteSql).text()}`);
  db.close();

  run('bunx', ['drizzle-kit', 'introspect', '--config', 'drizzle.config.ts'], {
    cwd: paths.pkgDir,
    env: {
      SYNC_DB_FILE: paths.sqliteDbPath,
      NODE_PATH: process.env['NODE_PATH']
        ? `${path.join(paths.pkgDir, 'node_modules')}${path.delimiter}${process.env['NODE_PATH']}`
        : path.join(paths.pkgDir, 'node_modules'),
    },
  });

  await postProcess(paths.drizzleSchema);
  assertDrizzleSchemaMatchesSqlite(paths.sqliteDbPath, paths.drizzleSchema);
  run('bun', ['x', 'oxfmt', '--write', paths.drizzleSchema], { cwd: paths.rootDir });

  formatGeneratedArtifacts(paths);
  log('info', 'Schema sync package artifacts complete');
};

if (import.meta.main) {
  void generate();
}

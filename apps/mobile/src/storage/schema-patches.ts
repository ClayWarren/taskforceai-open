/**
 * Schema Patches - Legacy table rebuilds and index management
 *
 * Uses a Table Rebuild strategy to normalize schemas from earlier versions
 * that may have had camelCase columns, missing columns, or NOT NULL "poison"
 * columns that prevent Drizzle from working correctly.
 */
import type * as SQLite from "expo-sqlite";

import { mobileLogger } from "../logger";
import {
  SCHEMA_INDEX_CONFIGS,
  type SchemaIndexConfig,
  SCHEMA_REBUILD_CONFIGS,
} from "./schema-patch-definitions";

export type LegacySchemaPatchResult = {
  changed: boolean;
  rebuiltTables: string[];
  repairedIndexes: string[];
};

/**
 * Validate that a table name is a safe SQL identifier.
 * Guards against SQL injection if external data ever flows into this path.
 */
const assertSafeIdentifier = (name: string): void => {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(`[SchemaPatches] Invalid table name: ${name}`);
  }
};

const parseTargetColumns = (createSql: string): string[] => {
  const targetColumnsMatch = createSql.match(/\(([\s\S]*)\)/);
  if (!targetColumnsMatch) {
    throw new Error("[SchemaPatches] Unable to parse target table columns");
  }

  return targetColumnsMatch[1]
    .split(",")
    .map((line) => line.trim().split(/\s+/)[0].replace(/['"`]/g, ""))
    .filter(
      (name) =>
        name &&
        !["PRIMARY", "FOREIGN", "CONSTRAINT"].includes(name.toUpperCase()),
    );
};

const isPoisonColumnForOption = (column: string, option: string): boolean =>
  option.length > 2 &&
  (column.includes(`_${option}_`) || column.endsWith(`_${option}`));

const isPoisonColumn = (column: string, mappingOptions: string[]): boolean =>
  mappingOptions.some((option) => isPoisonColumnForOption(column, option));

const defaultSqlLiteral = (line: string): string | null => {
  const defaultMatch = line.match(/\bDEFAULT\s+((?:'[^']*')|(?:"[^"]*")|[^\s,]+)/i);
  return defaultMatch?.[1] ?? null;
};

const missingColumnFallbackSql = (targetCol: string, line: string | undefined): string => {
  const defaultLiteral = line ? defaultSqlLiteral(line) : null;
  if (defaultLiteral) {
    return defaultLiteral;
  }

  const normalizedLine = line?.toUpperCase() ?? "";
  const isNotNull = normalizedLine.includes("NOT NULL");

  if (
    targetCol === "conversation_id" ||
    targetCol === "message_id"
  ) {
    return "'legacy-' || rowid";
  }
  if (
    targetCol === "id" &&
    normalizedLine.includes("INTEGER")
  ) {
    return "rowid";
  }
  if (targetCol === "data") {
    return "'{}'";
  }

  if (!isNotNull) {
    return "NULL";
  }
  if (normalizedLine.includes("TEXT")) {
    return "''";
  }
  if (normalizedLine.includes("INTEGER") || normalizedLine.includes("REAL")) {
    return "0";
  }

  return "NULL";
};

const shouldRebuildLegacyTable = (
  columnNames: Set<string>,
  targetColumns: string[],
  mappings: Record<string, string[]>,
): boolean => {
  const targetColumnNames = new Set(targetColumns);
  const mappingOptions = Object.values(mappings).flat();
  const knownColumnNames = new Set([...targetColumns, ...mappingOptions]);

  for (const [targetColumn, options] of Object.entries(mappings)) {
    if (columnNames.has(targetColumn)) {
      continue;
    }
    if (options.some((option) => option !== targetColumn && columnNames.has(option))) {
      return true;
    }
  }

  if (Array.from(columnNames).some((column) => isPoisonColumn(column, mappingOptions))) {
    return true;
  }

  const missingTargetColumn = targetColumns.some((column) => !columnNames.has(column));
  if (!missingTargetColumn) {
    return false;
  }

  const hasUnknownFutureColumn = Array.from(columnNames).some(
    (column) =>
      !targetColumnNames.has(column) &&
      !knownColumnNames.has(column) &&
      !isPoisonColumn(column, mappingOptions),
  );

  return !hasUnknownFutureColumn;
};

/**
 * Rebuild a single table to match the target schema, mapping data from
 * legacy column names to their modern equivalents.
 */
function rebuildTable(
  db: SQLite.SQLiteDatabase,
  tableName: string,
  createSql: string,
  mappings: Record<string, string[]>,
): boolean {
  assertSafeIdentifier(tableName);

  try {
    const tables = db.getAllSync<{ name: string }>(
      'SELECT name FROM sqlite_master WHERE type="table"',
    );
    if (!tables.some((t) => t.name === tableName)) return false;

    // 1. Get current columns
    const cols = db.getAllSync<{ name: string }>(
      `PRAGMA table_info("${tableName}")`,
    );
    const colNames = new Set(cols.map((c) => c.name));

    // 2. Identify target columns from CREATE TABLE sql
    const targetColumns = parseTargetColumns(createSql);
    if (!shouldRebuildLegacyTable(colNames, targetColumns, mappings)) {
      mobileLogger.debug(`[SchemaPatches] Skipping non-legacy table ${tableName}`);
      return false;
    }

    mobileLogger.warn(
      `[SchemaPatches] Rebuilding table ${tableName} to normalize schema`,
    );

    // 3. Create new table
    const tempTableName = `${tableName}_new`;
    db.execSync(`DROP TABLE IF EXISTS "${tempTableName}"`);
    db.execSync(createSql);

    // 4. Build dynamic INSERT SELECT with intelligent column discovery
    const selectParts: string[] = [];
    for (const targetCol of targetColumns) {
      const legacyOptions = mappings[targetCol] || [targetCol];

      // Special handling for primary key ID to avoid conflicts during rowid mapping
      if (targetCol === "id" && colNames.has("id")) {
        selectParts.push('"id"');
        continue;
      }

      // Find the best source column, favoring modern name, then camelCase, then previously renamed poison ones
      let foundSource: string | null = null;
      for (const opt of legacyOptions) {
        if (colNames.has(opt)) {
          foundSource = opt;
          break;
        }
      }

      // If not found, look for "poison_" or "obs_" prefixed versions of any legacy option
      if (!foundSource) {
        const allCols = Array.from(colNames);
        for (const opt of legacyOptions) {
          const poisonMatch = allCols.find(
            (c) => c.includes(`_${opt}_`) || c.endsWith(`_${opt}`),
          );
          if (poisonMatch) {
            foundSource = poisonMatch;
            break;
          }
        }
      }

      if (foundSource) {
        selectParts.push(`"${foundSource}"`);
      } else {
        const line = createSql.split("\n").find((l) => l.includes(targetCol));
        selectParts.push(missingColumnFallbackSql(targetCol, line));
      }
    }

    const insertSql = `INSERT INTO "${tempTableName}" ("${targetColumns.join('", "')}") SELECT ${selectParts.join(", ")} FROM "${tableName}"`;

    db.execSync("PRAGMA foreign_keys = OFF;");
    try {
      db.execSync("BEGIN IMMEDIATE;");
      try {
        db.execSync(insertSql);

        // 5. Finalize
        db.execSync(`DROP TABLE "${tableName}"`);
        db.execSync(`ALTER TABLE "${tempTableName}" RENAME TO "${tableName}"`);
        db.execSync("COMMIT;");
      } catch (err) {
        db.execSync("ROLLBACK;");
        throw err;
      }
    } finally {
      db.execSync("PRAGMA foreign_keys = ON;");
    }
    mobileLogger.warn(`[SchemaPatches] Successfully rebuilt ${tableName}`);
    return true;
  } catch (err) {
    mobileLogger.error(`[SchemaPatches] Failed to rebuild table ${tableName}`, {
      error: err,
    });
    throw err;
  }
}

const createUniqueIndexSql = (config: SchemaIndexConfig): string =>
  `CREATE UNIQUE INDEX IF NOT EXISTS "${config.name}" ON "${config.table}" ("${config.column}")`;

const dedupeRowsByColumn = (
  db: SQLite.SQLiteDatabase,
  table: string,
  column: string,
): void => {
  db.execSync(
    `DELETE FROM "${table}" WHERE rowid NOT IN (SELECT MIN(rowid) FROM "${table}" GROUP BY "${column}")`,
  );
};

const ensureUniqueIndex = (
  db: SQLite.SQLiteDatabase,
  config: SchemaIndexConfig,
): boolean => {
  assertSafeIdentifier(config.name);
  assertSafeIdentifier(config.table);
  assertSafeIdentifier(config.column);

  const indexSql = createUniqueIndexSql(config);
  try {
    db.execSync(indexSql);
    db.execSync(`DROP INDEX IF EXISTS "${config.name}_nonunique"`);
    return false;
  } catch (error) {
    mobileLogger.warn("[SchemaPatches] Unique index repair failed; deduping rows and retrying", {
      table: config.table,
      index: config.name,
      column: config.column,
      error,
    });
  }

  dedupeRowsByColumn(db, config.table, config.column);
  db.execSync(indexSql);
  db.execSync(`DROP INDEX IF EXISTS "${config.name}_nonunique"`);
  return true;
};

/**
 * Apply legacy schema patches to normalize table schemas from older app versions.
 * This runs BEFORE Drizzle ORM initialization so the ORM sees a clean schema.
 */
export function applyLegacySchemaPatches(
  db: SQLite.SQLiteDatabase,
  tableNames: string[],
): LegacySchemaPatchResult {
  const existingTableNames = tableNames.length
    ? tableNames
    : db
        .getAllSync<{
          name: string;
        }>('SELECT name FROM sqlite_master WHERE type="table"')
        .map((table) => table.name);
  const result: LegacySchemaPatchResult = {
    changed: false,
    rebuiltTables: [],
    repairedIndexes: [],
  };

  for (const config of SCHEMA_REBUILD_CONFIGS) {
    if (rebuildTable(db, config.tableName, config.createSql, config.mappings)) {
      result.changed = true;
      result.rebuiltTables.push(config.tableName);
    }
  }

  // Re-verify indexes after rebuild
  try {
    db.execSync("PRAGMA foreign_keys = OFF;");
    for (const config of SCHEMA_INDEX_CONFIGS) {
      if (!existingTableNames.includes(config.table)) {
        continue;
      }

      if (ensureUniqueIndex(db, config)) {
        result.changed = true;
        result.repairedIndexes.push(config.name);
      }
    }
  } finally {
    db.execSync("PRAGMA foreign_keys = ON;");
  }

  return result;
}

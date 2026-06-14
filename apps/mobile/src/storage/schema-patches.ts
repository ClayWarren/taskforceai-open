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
  SCHEMA_REBUILD_CONFIGS,
} from "./schema-patch-definitions";

/**
 * Validate that a table name is a safe SQL identifier.
 * Guards against SQL injection if external data ever flows into this path.
 */
const assertSafeIdentifier = (name: string): void => {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(`[SchemaPatches] Invalid table name: ${name}`);
  }
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
): void {
  assertSafeIdentifier(tableName);

  try {
    const tables = db.getAllSync<{ name: string }>(
      'SELECT name FROM sqlite_master WHERE type="table"',
    );
    if (!tables.some((t) => t.name === tableName)) return;

    mobileLogger.warn(
      `[SchemaPatches] Rebuilding table ${tableName} to normalize schema`,
    );

    // 1. Get current columns
    const cols = db.getAllSync<{ name: string }>(
      `PRAGMA table_info("${tableName}")`,
    );
    const colNames = new Set(cols.map((c) => c.name));

    // 2. Identify target columns from CREATE TABLE sql
    const targetColumnsMatch = createSql.match(/\(([\s\S]*)\)/);
    if (!targetColumnsMatch) return;
    const targetColumns = targetColumnsMatch[1]
      .split(",")
      .map((line) => line.trim().split(/\s+/)[0].replace(/['"`]/g, ""))
      .filter(
        (name) =>
          name &&
          !["PRIMARY", "FOREIGN", "CONSTRAINT"].includes(name.toUpperCase()),
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
        // Check if the target column in createSql has a default value
        const line = createSql.split("\n").find((l) => l.includes(targetCol));
        if (line && line.toUpperCase().includes("DEFAULT")) {
          if (line.toUpperCase().includes("INTEGER")) selectParts.push("0");
          else if (line.toUpperCase().includes("TEXT")) selectParts.push("''");
          else selectParts.push("NULL");
        } else if (
          targetCol === "conversation_id" ||
          targetCol === "message_id"
        ) {
          selectParts.push("'legacy-' || rowid");
        } else if (
          targetCol === "id" &&
          line &&
          line.toUpperCase().includes("INTEGER")
        ) {
          selectParts.push("rowid");
        } else {
          selectParts.push("NULL");
        }
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
  } catch (err) {
    mobileLogger.error(`[SchemaPatches] Failed to rebuild table ${tableName}`, {
      error: err,
    });
  }
}

/**
 * Apply legacy schema patches to normalize table schemas from older app versions.
 * This runs BEFORE Drizzle ORM initialization so the ORM sees a clean schema.
 */
export function applyLegacySchemaPatches(
  db: SQLite.SQLiteDatabase,
  tableNames: string[],
): void {
  const existingTableNames = tableNames.length
    ? tableNames
    : db
        .getAllSync<{
          name: string;
        }>('SELECT name FROM sqlite_master WHERE type="table"')
        .map((table) => table.name);

  for (const config of SCHEMA_REBUILD_CONFIGS) {
    rebuildTable(db, config.tableName, config.createSql, config.mappings);
  }

  // Re-verify indexes after rebuild
  try {
    db.execSync("PRAGMA foreign_keys = OFF;");
    for (const config of SCHEMA_INDEX_CONFIGS) {
      if (!existingTableNames.includes(config.table)) {
        continue;
      }

      try {
        db.execSync(
          `CREATE UNIQUE INDEX IF NOT EXISTS "${config.name}" ON "${config.table}" ("${config.column}")`,
        );
      } catch {
        db.execSync(
          `CREATE INDEX IF NOT EXISTS "${config.name}_nonunique" ON "${config.table}" ("${config.column}")`,
        );
      }
    }
  } finally {
    db.execSync("PRAGMA foreign_keys = ON;");
  }
}

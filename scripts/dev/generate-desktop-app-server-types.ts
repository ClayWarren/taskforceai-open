import fs from 'node:fs';
import path from 'node:path';

type SerdeAttrs = {
  default: boolean;
  rename?: string;
  renameAll?: string;
  skipSerializingIf?: string;
  tag?: string;
};

type Field = {
  name: string;
  type: string;
  attrs: SerdeAttrs;
};

type StructItem = {
  kind: 'struct';
  name: string;
  attrs: SerdeAttrs;
  fields: Field[];
};

type EnumVariant = {
  name: string;
  attrs: SerdeAttrs;
  fields: Field[];
  tupleType?: string;
};

type EnumItem = {
  kind: 'enum';
  name: string;
  attrs: SerdeAttrs;
  variants: EnumVariant[];
};

type Item = StructItem | EnumItem;

const rootDir = path.resolve(import.meta.dir, '../..');
const outputPath = path.join(
  rootDir,
  'apps/web/app/lib/platform/desktop/app-server-types.generated.ts'
);
const protocolSchemaPath = path.join(
  rootDir,
  'packages/contracts/rust/schema/app-server-protocol.schema.json'
);

const protocolRustSourcePaths = [
  'packages/contracts/rust/src/records.rs',
  'packages/contracts/rust/src/automation.rs',
  'packages/contracts/rust/src/agent.rs',
  'packages/contracts/rust/src/params.rs',
  'packages/contracts/rust/src/voice.rs',
  'packages/contracts/rust/src/git_review.rs',
  'packages/contracts/rust/src/sync.rs',
  'packages/contracts/rust/src/server.rs',
  'packages/contracts/rust/src/initialize.rs',
  'packages/contracts/rust/src/interactions.rs',
  'packages/contracts/rust/src/events.rs',
  'packages/contracts/rust/src/jsonrpc.rs',
  'packages/contracts/rust/src/settings.rs',
  'packages/contracts/rust/src/models.rs',
  'packages/contracts/rust/src/workflow.rs',
];

const rustSourcePaths = [
  ...protocolRustSourcePaths,
  'apps/desktop/src/app_server/types.rs',
  'apps/desktop/src/commands/app_server/local_coding.rs',
  'apps/desktop/src/commands/browser/types.rs',
  'apps/desktop/src/commands/ui/local_environment.rs',
  'apps/desktop/src/commands/ui/record_replay.rs',
  'apps/desktop/src/commands/ui/workspace.rs',
  'apps/desktop/src/commands/ui/terminal.rs',
  'apps/desktop/src/worktrees.rs',
  'apps/desktop/src/screen_memory.rs',
  'apps/desktop/src/appshots.rs',
];

const stripLineComment = (line: string) => {
  const index = line.indexOf('//');
  return index === -1 ? line : line.slice(0, index);
};

const attrsFromLines = (lines: string[]): SerdeAttrs => {
  const attrs: SerdeAttrs = { default: false };
  for (const line of lines) {
    const match = line.match(/#\[serde\((.*)\)\]/);
    if (!match?.[1]) continue;
    const raw = match[1];
    attrs.default ||= /\bdefault\b/.test(raw);
    attrs.rename = raw.match(/rename\s*=\s*"([^"]+)"/)?.[1] ?? attrs.rename;
    attrs.renameAll = raw.match(/rename_all\s*=\s*"([^"]+)"/)?.[1] ?? attrs.renameAll;
    attrs.skipSerializingIf =
      raw.match(/skip_serializing_if\s*=\s*"([^"]+)"/)?.[1] ?? attrs.skipSerializingIf;
    attrs.tag = raw.match(/tag\s*=\s*"([^"]+)"/)?.[1] ?? attrs.tag;
  }
  return attrs;
};

const braceDelta = (line: string) => {
  let sum = 0;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '{') sum += 1;
    if (char === '}') sum -= 1;
  }
  return sum;
};

const collectBlock = (lines: string[], startIndex: number) => {
  const block: string[] = [];
  let depth = 0;
  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    depth += braceDelta(stripLineComment(line));
    block.push(line);
    if (depth === 0) {
      return { block, endIndex: index };
    }
  }
  throw new Error(`Unclosed Rust block starting at line ${startIndex + 1}`);
};

const parseField = (line: string, attrLines: string[]): Field | null => {
  const trimmed = stripLineComment(line).trim();
  if (!trimmed) return null;
  const match = trimmed.match(
    /^(?:pub(?:\([^)]*\))?\s+)?(r#)?([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.+?),?$/
  );
  if (!match?.[2] || !match[3]) return null;
  return {
    name: match[2],
    type: match[3].trim(),
    attrs: attrsFromLines(attrLines),
  };
};

const parseStructFields = (block: string[]) => {
  const fields: Field[] = [];
  const pendingAttrs: string[] = [];
  for (const line of block.slice(1, -1)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#[')) {
      pendingAttrs.push(trimmed);
      continue;
    }
    const field = parseField(line, pendingAttrs);
    pendingAttrs.length = 0;
    if (field) fields.push(field);
  }
  return fields;
};

const parseEnumVariants = (block: string[]) => {
  const variants: EnumVariant[] = [];
  const pendingAttrs: string[] = [];
  const body = block.slice(1, -1);
  for (let index = 0; index < body.length; index += 1) {
    const line = body[index] ?? '';
    const trimmed = stripLineComment(line).trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('#[')) {
      pendingAttrs.push(trimmed);
      continue;
    }
    const structVariant = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*\{$/);
    if (structVariant?.[1]) {
      const variantLines = [line];
      let depth = braceDelta(trimmed);
      while (depth > 0) {
        index += 1;
        const next = body[index] ?? '';
        variantLines.push(next);
        depth += braceDelta(stripLineComment(next));
      }
      variants.push({
        name: structVariant[1],
        attrs: attrsFromLines(pendingAttrs),
        fields: parseStructFields(variantLines),
      });
      pendingAttrs.length = 0;
      continue;
    }
    const unitVariant = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*),?$/);
    if (unitVariant?.[1]) {
      variants.push({
        name: unitVariant[1],
        attrs: attrsFromLines(pendingAttrs),
        fields: [],
      });
      pendingAttrs.length = 0;
      continue;
    }
    const tupleVariant = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\((.+)\),?$/);
    if (tupleVariant?.[1] && tupleVariant[2]) {
      variants.push({
        name: tupleVariant[1],
        attrs: attrsFromLines(pendingAttrs),
        fields: [],
        tupleType: tupleVariant[2].trim(),
      });
      pendingAttrs.length = 0;
    }
  }
  return variants;
};

const parseItems = (sourcePath: string) => {
  const source = fs.readFileSync(path.join(rootDir, sourcePath), 'utf8');
  const lines = source.split('\n');
  const items: Item[] = [];
  const pendingAttrs: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const trimmed = line.trim();
    if (trimmed.startsWith('#[')) {
      pendingAttrs.push(trimmed);
      continue;
    }
    const structMatch = trimmed.match(
      /^(?:pub(?:\([^)]*\))?\s+)?struct\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/
    );
    if (structMatch?.[1]) {
      const { block, endIndex } = collectBlock(lines, index);
      const attrs = attrsFromLines(pendingAttrs);
      if (attrs.renameAll || pendingAttrs.some((attr) => attr.includes('Serialize'))) {
        items.push({
          kind: 'struct',
          name: structMatch[1],
          attrs,
          fields: parseStructFields(block),
        });
      }
      pendingAttrs.length = 0;
      index = endIndex;
      continue;
    }

    const enumMatch = trimmed.match(
      /^(?:pub(?:\([^)]*\))?\s+)?enum\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/
    );
    if (enumMatch?.[1]) {
      const { block, endIndex } = collectBlock(lines, index);
      const attrs = attrsFromLines(pendingAttrs);
      if (attrs.renameAll || pendingAttrs.some((attr) => attr.includes('Serialize'))) {
        items.push({
          kind: 'enum',
          name: enumMatch[1],
          attrs,
          variants: parseEnumVariants(block),
        });
      }
      pendingAttrs.length = 0;
      index = endIndex;
      continue;
    }

    pendingAttrs.length = 0;
  }
  return items;
};

const toCamelCase = (value: string) =>
  value.replace(/_([a-z0-9])/g, (_, char: string) => char.toUpperCase());

const toSnakeCase = (value: string) =>
  value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1_$2')
    .toLowerCase();

const renameWith = (value: string, renameAll?: string) => {
  if (renameAll === 'camelCase') return toCamelCase(value);
  if (renameAll === 'snake_case') return toSnakeCase(value);
  return value;
};

const splitGenericArgs = (value: string) => {
  const args: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === '<') depth += 1;
    if (char === '>') depth -= 1;
    if (char === ',' && depth === 0) {
      args.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  args.push(value.slice(start).trim());
  return args.filter(Boolean);
};

const unwrapGeneric = (type: string, wrapper: string) => {
  const normalized = type.trim();
  const prefix = `${wrapper}<`;
  if (!normalized.startsWith(prefix) || !normalized.endsWith('>')) return null;
  return normalized.slice(prefix.length, -1).trim();
};

const stripRustPath = (type: string) => type.replace(/\b(?:crate|serde_json)::/g, '');

const mapRustType = (type: string): string => {
  const normalized = stripRustPath(type)
    .replace(/^&'?static\s+/, '')
    .replace(/^&/, '')
    .replace(/\br#([A-Za-z_][A-Za-z0-9_]*)/g, '$1')
    .trim();

  const option = unwrapGeneric(normalized, 'Option');
  if (option) return `${mapRustType(option)} | null`;

  const vector = unwrapGeneric(normalized, 'Vec');
  if (vector) {
    const item = mapRustType(vector);
    return item.includes('|') ? `Array<${item}>` : `${item}[]`;
  }

  const boxed = unwrapGeneric(normalized, 'Box');
  if (boxed) return mapRustType(boxed);

  const hashMap = unwrapGeneric(normalized, 'HashMap') ?? unwrapGeneric(normalized, 'BTreeMap');
  if (hashMap) {
    const args = splitGenericArgs(hashMap);
    if (args.length !== 2) throw new Error(`Unsupported map type: ${type}`);
    return `Record<${mapRustType(args[0] ?? 'String')}, ${mapRustType(args[1] ?? 'Value')}>`;
  }

  if (normalized === 'String' || normalized === 'str') return 'string';
  if (normalized === 'bool') return 'boolean';
  if (
    /^(?:u|i)(?:8|16|32|64|size)$/.test(normalized) ||
    normalized === 'f32' ||
    normalized === 'f64'
  ) {
    return 'number';
  }
  if (normalized === 'Value') return 'unknown';
  if (normalized === '()') return 'void';
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(normalized)) return normalized;
  throw new Error(`Unsupported Rust type: ${type}`);
};

const isOuterOption = (type: string) => stripRustPath(type).trim().startsWith('Option<');

const tsFieldName = (field: Field, renameAll?: string) =>
  field.attrs.rename ?? renameWith(field.name, renameAll);

const renderField = (field: Field, renameAll?: string) => {
  const name = tsFieldName(field, renameAll);
  const optional =
    field.attrs.default || field.attrs.skipSerializingIf !== undefined || isOuterOption(field.type);
  return `  ${JSON.stringify(name)}${optional ? '?' : ''}: ${mapRustType(field.type)};`;
};

const renderStruct = (item: StructItem) => {
  const seen = new Set<string>();
  const fields = item.fields.map((field) => {
    const name = tsFieldName(field, item.attrs.renameAll);
    if (seen.has(name)) {
      throw new Error(`${item.name} has duplicate serialized field ${name}`);
    }
    seen.add(name);
    return renderField(field, item.attrs.renameAll);
  });
  return `export type ${item.name} = {\n${fields.join('\n')}\n};`;
};

const renderEnum = (item: EnumItem) => {
  const seen = new Set<string>();
  const tag = item.attrs.tag;
  const variants = item.variants.map((variant) => {
    const name = variant.attrs.rename ?? renameWith(variant.name, item.attrs.renameAll);
    if (seen.has(name)) {
      throw new Error(`${item.name} has duplicate serialized variant ${name}`);
    }
    seen.add(name);
    if (!tag) return variant.tupleType ? mapRustType(variant.tupleType) : JSON.stringify(name);
    const fields = variant.fields.map((field) => renderField(field, item.attrs.renameAll));
    const tagField = `  ${JSON.stringify(tag)}: ${JSON.stringify(name)};`;
    return `{\n${[tagField, ...fields].join('\n')}\n}`;
  });
  return `export type ${item.name} = ${variants.join(' | ')};`;
};

const generatedTypes = rustSourcePaths.flatMap(parseItems);
const rendered = generatedTypes.map((item) =>
  item.kind === 'struct' ? renderStruct(item) : renderEnum(item)
);

const content = [
  '// AUTO-GENERATED by scripts/dev/generate-desktop-app-server-types.ts.',
  '// Source of truth: Rust serde protocol structs in packages/contracts/rust and apps/desktop.',
  '',
  ...rendered,
  '',
].join('\n\n');

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, content);
console.log(`Generated ${path.relative(rootDir, outputPath)}`);

type JsonSchema = Record<string, unknown>;

const jsonSchemaForRustType = (type: string): JsonSchema => {
  const normalized = stripRustPath(type)
    .replace(/^&'?static\s+/, '')
    .replace(/^&/, '')
    .trim();
  const option = unwrapGeneric(normalized, 'Option');
  if (option) return { anyOf: [jsonSchemaForRustType(option), { type: 'null' }] };
  const vector = unwrapGeneric(normalized, 'Vec');
  if (vector) return { type: 'array', items: jsonSchemaForRustType(vector) };
  const boxed = unwrapGeneric(normalized, 'Box');
  if (boxed) return jsonSchemaForRustType(boxed);
  const map = unwrapGeneric(normalized, 'HashMap') ?? unwrapGeneric(normalized, 'BTreeMap');
  if (map) {
    const args = splitGenericArgs(map);
    return {
      type: 'object',
      additionalProperties: jsonSchemaForRustType(args[1] ?? 'Value'),
    };
  }
  if (normalized === 'String' || normalized === 'str') return { type: 'string' };
  if (normalized === 'bool') return { type: 'boolean' };
  if (/^(?:u|i)(?:8|16|32|64|size)$/.test(normalized)) return { type: 'integer' };
  if (normalized === 'f32' || normalized === 'f64') return { type: 'number' };
  if (normalized === 'Value') return {};
  if (normalized === '()') return { type: 'null' };
  return { $ref: `#/$defs/${normalized}` };
};

const jsonSchemaForItem = (item: Item): JsonSchema => {
  if (item.kind === 'enum' && !item.attrs.tag) {
    if (item.variants.some((variant) => variant.tupleType)) {
      return {
        oneOf: item.variants.map((variant) =>
          variant.tupleType
            ? item.name === 'OutgoingMessage' && variant.name === 'Response'
              ? {
                  allOf: [
                    jsonSchemaForRustType(variant.tupleType),
                    // The custom OutgoingMessage deserializer distinguishes a response
                    // from a notification by the presence of id, including a null id.
                    { type: 'object', required: ['id'] },
                  ],
                }
              : jsonSchemaForRustType(variant.tupleType)
            : {
                const: variant.attrs.rename ?? renameWith(variant.name, item.attrs.renameAll),
              }
        ),
      };
    }
    return {
      type: 'string',
      enum: item.variants.map(
        (variant) => variant.attrs.rename ?? renameWith(variant.name, item.attrs.renameAll)
      ),
    };
  }
  if (item.kind === 'enum') {
    return {
      oneOf: item.variants.map((variant) => {
        const name = variant.attrs.rename ?? renameWith(variant.name, item.attrs.renameAll);
        const properties: Record<string, JsonSchema> = {
          [item.attrs.tag ?? 'type']: { const: name },
        };
        const required = [item.attrs.tag ?? 'type'];
        for (const field of variant.fields) {
          const fieldName = tsFieldName(field, item.attrs.renameAll);
          properties[fieldName] = jsonSchemaForRustType(field.type);
          if (
            !field.attrs.default &&
            field.attrs.skipSerializingIf === undefined &&
            !isOuterOption(field.type)
          ) {
            required.push(fieldName);
          }
        }
        return { type: 'object', additionalProperties: false, properties, required };
      }),
    };
  }
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  for (const field of item.fields) {
    const fieldName = tsFieldName(field, item.attrs.renameAll);
    properties[fieldName] = jsonSchemaForRustType(field.type);
    if (
      !field.attrs.default &&
      field.attrs.skipSerializingIf === undefined &&
      !isOuterOption(field.type)
    ) {
      required.push(fieldName);
    }
  }
  return {
    type: 'object',
    additionalProperties: false,
    properties,
    ...(required.length > 0 ? { required } : {}),
  };
};

const protocolTypes = protocolRustSourcePaths.flatMap(parseItems);
const definitions = Object.fromEntries(
  protocolTypes.map((item) => [item.name, jsonSchemaForItem(item)])
);
const protocolSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://taskforceai.dev/schemas/app-server-protocol.schema.json',
  title: 'TaskForceAI App Server Protocol',
  description: 'Generated from the Rust serde protocol source of truth.',
  $defs: definitions,
};
fs.mkdirSync(path.dirname(protocolSchemaPath), { recursive: true });
fs.writeFileSync(protocolSchemaPath, `${JSON.stringify(protocolSchema, null, 2)}\n`);
const formatSchema = Bun.spawnSync(
  [process.execPath, 'x', '--no-install', 'oxfmt', protocolSchemaPath],
  {
    cwd: rootDir,
    stdout: 'inherit',
    stderr: 'inherit',
  }
);
if (!formatSchema.success) {
  throw new Error(`Failed to format ${path.relative(rootDir, protocolSchemaPath)}`);
}
console.log(`Generated ${path.relative(rootDir, protocolSchemaPath)}`);

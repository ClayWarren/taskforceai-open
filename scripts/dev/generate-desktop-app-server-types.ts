import fs from 'node:fs';
import path from 'node:path';

type SerdeAttrs = {
  default: boolean;
  flatten: boolean;
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
  'packages/contracts/typescript/src/app-server-types.generated.ts'
);
const protocolSchemaPath = path.join(
  rootDir,
  'packages/contracts/rust/schema/app-server-protocol.schema.json'
);

const protocolRustSourcePaths = [
  'packages/contracts/rust/src/records.rs',
  'packages/contracts/rust/src/automation.rs',
  'packages/contracts/rust/src/compat.rs',
  'packages/contracts/rust/src/agent.rs',
  'packages/contracts/rust/src/params.rs',
  'packages/contracts/rust/src/process.rs',
  'packages/contracts/rust/src/voice.rs',
  'packages/contracts/rust/src/git_review.rs',
  'packages/contracts/rust/src/sync.rs',
  'packages/contracts/rust/src/remote.rs',
  'packages/contracts/rust/src/server.rs',
  'packages/contracts/rust/src/initialize.rs',
  'packages/contracts/rust/src/interactions.rs',
  'packages/contracts/rust/src/events.rs',
  'packages/contracts/rust/src/jsonrpc.rs',
  'packages/contracts/rust/src/settings.rs',
  'packages/contracts/rust/src/models.rs',
  'packages/contracts/rust/src/workflow.rs',
  'packages/contracts/rust/src/catalog.rs',
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
  const attrs: SerdeAttrs = { default: false, flatten: false };
  for (const line of lines) {
    const match = line.match(/#\[serde\((.*)\)\]/);
    if (!match?.[1]) continue;
    const raw = match[1];
    attrs.default ||= /\bdefault\b/.test(raw);
    attrs.flatten ||= /\bflatten\b/.test(raw);
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

const toCamelCase = (value: string) => {
  const camelCase = value.replace(/_([a-z0-9])/g, (_, char: string) => char.toUpperCase());
  return camelCase.charAt(0).toLowerCase() + camelCase.slice(1);
};

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

const fieldIsOptional = (field: Field, containerDefault = false) =>
  containerDefault ||
  field.attrs.default ||
  field.attrs.skipSerializingIf !== undefined ||
  isOuterOption(field.type);

const renderField = (field: Field, renameAll?: string, containerDefault = false) => {
  const name = tsFieldName(field, renameAll);
  const optional = fieldIsOptional(field, containerDefault);
  return `  ${JSON.stringify(name)}${optional ? '?' : ''}: ${mapRustType(field.type)};`;
};

const renderStruct = (item: StructItem) => {
  if (item.name === 'JsonRpcResponse') {
    return `export type JsonRpcResponse =
  | {
      jsonrpc: '2.0';
      id: unknown | null;
      result: unknown;
      error?: never;
    }
  | {
      jsonrpc: '2.0';
      id: unknown | null;
      result?: never;
      error: JsonRpcError;
    };`;
  }
  const seen = new Set<string>();
  const flattened = item.fields
    .filter((field) => field.attrs.flatten)
    .map((field) => {
      const option = unwrapGeneric(stripRustPath(field.type).trim(), 'Option');
      const type = mapRustType(option ?? field.type);
      return fieldIsOptional(field, item.attrs.default) ? `Partial<${type}>` : type;
    });
  const fields = item.fields
    .filter((field) => !field.attrs.flatten)
    .map((field) => {
      const name = tsFieldName(field, item.attrs.renameAll);
      if (seen.has(name)) {
        throw new Error(`${item.name} has duplicate serialized field ${name}`);
      }
      seen.add(name);
      return renderField(field, item.attrs.renameAll, item.attrs.default);
    });
  const object = `{\n${fields.join('\n')}\n}`;
  return `export type ${item.name} = ${[...flattened, object].join(' & ')};`;
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
const rpcMethodSource = fs.readFileSync(
  path.join(rootDir, 'apps/app-server/src/stdio/methods.rs'),
  'utf8'
);
const appRequestSource = fs.readFileSync(
  path.join(rootDir, 'packages/contracts/rust/src/request.rs'),
  'utf8'
);
const appRequestBody = appRequestSource.match(/pub enum AppRequest\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
const requestVariantTypes = new Map<string, string | null>();
for (const line of appRequestBody.split('\n')) {
  const match = line.trim().match(/^([A-Za-z0-9_]+)(?:\(([^)]+)\))?,?$/);
  if (match?.[1]) requestVariantTypes.set(match[1], match[2]?.trim() ?? null);
}

const rpcRequestSpecs = new Map<string, string | null>();
let pendingMethodArm = '';
let pendingMethods: string[] = [];
for (const line of rpcMethodSource.split('\n')) {
  if (!pendingMethodArm) {
    if (!/^\s*"[^"]+"(?:\s*\|\s*"[^"]+")*\s*=>/.test(line)) continue;
    pendingMethodArm = line;
    pendingMethods = [...line.matchAll(/"([^"]+)"/g)]
      .map((match) => match[1] ?? '')
      .filter(Boolean);
  } else {
    pendingMethodArm += `\n${line}`;
  }
  if (!pendingMethodArm.includes('AppRequest::')) continue;
  const variant = pendingMethodArm.match(/AppRequest::([A-Za-z0-9_]+)/)?.[1];
  if (variant) {
    const paramsType = requestVariantTypes.get(variant) ?? null;
    for (const method of pendingMethods) {
      rpcRequestSpecs.set(method.replaceAll('.', '/'), paramsType);
    }
  }
  pendingMethodArm = '';
  pendingMethods = [];
}
rpcRequestSpecs.set('thread/subscribe', 'ThreadIDParams');
rpcRequestSpecs.set('thread/unsubscribe', 'ThreadIDParams');
const rpcMethods = [...rpcRequestSpecs.keys()].toSorted();
const renderedRpcMethods = `export type AppServerRpcMethod = ${rpcMethods
  .map((method) => JSON.stringify(method))
  .join(' | ')};`;
const renderedJsonRpcID = 'export type JsonRpcID = string | number | null;';
const renderedClientRequest = `export type AppServerClientRequest = ${rpcMethods
  .map((method) => {
    const paramsType = rpcRequestSpecs.get(method);
    const params = paramsType
      ? `; params: ${mapRustType(paramsType)}`
      : '; params?: Record<string, never>';
    return `{ jsonrpc: '2.0'; id: JsonRpcID; method: ${JSON.stringify(method)}${params} }`;
  })
  .join(' | ')};`;
const typedRpcResults = new Map<string, string>([
  ['server/describe', 'ServerDescribeResult'],
  ['fs/readDirectory', 'FsReadDirectoryResult'],
  ['fs/getMetadata', 'FsMetadataResult'],
  ['diagnostics/submit', 'DiagnosticsSubmitResult'],
  ['feedback/upload', 'DiagnosticsSubmitResult'],
  ['serverRequest/list', 'ServerRequestListResult'],
  ['agentMode/list', 'AgentModeListResult'],
  ['permissionProfile/list', 'PermissionProfileListResult'],
  ['permissionGrant/list', 'PermissionGrantListResult'],
  ['permissionGrant/clear', 'AckResult'],
  ['modelProvider/list', 'ModelProviderListResult'],
  ['integration/list', 'IntegrationListResult'],
  ['integration/get', 'IntegrationResult'],
  ['integration/connect', 'IntegrationResult'],
  ['integration/disconnect', 'IntegrationDisconnectResult'],
  ['mcpServerStatus/list', 'McpServerStatusListResult'],
]);
const renderedResultMap = `export type AppServerRpcResultMap = {\n${rpcMethods
  .map((method) => `  ${JSON.stringify(method)}: ${typedRpcResults.get(method) ?? 'unknown'};`)
  .join(
    '\n'
  )}\n};\n\nexport type AppServerClientResponse<M extends AppServerRpcMethod = AppServerRpcMethod> = Omit<JsonRpcResponse, 'result'> & { result?: AppServerRpcResultMap[M] };`;

const content = [
  '// AUTO-GENERATED by scripts/dev/generate-desktop-app-server-types.ts.',
  '// Source of truth: Rust serde protocol structs in packages/contracts/rust and apps/desktop.',
  '',
  renderedRpcMethods,
  renderedJsonRpcID,
  renderedClientRequest,
  renderedResultMap,
  ...rendered,
  '',
].join('\n\n');

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, content);
const formatTypeScript = Bun.spawnSync(
  [process.execPath, 'x', '--no-install', 'oxfmt', outputPath],
  {
    cwd: rootDir,
    stdout: 'inherit',
    stderr: 'inherit',
  }
);
if (!formatTypeScript.success) {
  throw new Error(`Failed to format ${path.relative(rootDir, outputPath)}`);
}
console.log(`Generated ${path.relative(rootDir, outputPath)}`);

type JsonSchema = Record<string, unknown>;
type ObjectSchemaParts = {
  properties: Record<string, JsonSchema>;
  required: string[];
};

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

const flattenedStruct = (field: Field, items: ReadonlyMap<string, Item>) => {
  const normalized = stripRustPath(field.type).trim();
  const type = unwrapGeneric(normalized, 'Option') ?? normalized;
  const nested = items.get(type);
  if (!nested || nested.kind !== 'struct') {
    throw new Error(`Unsupported flattened field type ${field.type}`);
  }
  return nested;
};

const jsonSchemaForFields = (
  fields: Field[],
  renameAll: string | undefined,
  containerDefault: boolean,
  items: ReadonlyMap<string, Item>
): ObjectSchemaParts => {
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  const addProperty = (name: string, schema: JsonSchema) => {
    if (properties[name]) {
      throw new Error(`Duplicate serialized field ${name}`);
    }
    properties[name] = schema;
  };

  for (const field of fields) {
    if (field.attrs.flatten) {
      const nested = flattenedStruct(field, items);
      const nestedParts = jsonSchemaForFields(
        nested.fields,
        nested.attrs.renameAll,
        containerDefault || fieldIsOptional(field) || nested.attrs.default,
        items
      );
      for (const [name, schema] of Object.entries(nestedParts.properties)) {
        addProperty(name, schema);
      }
      required.push(...nestedParts.required);
      continue;
    }

    const fieldName = tsFieldName(field, renameAll);
    addProperty(fieldName, jsonSchemaForRustType(field.type));
    if (!fieldIsOptional(field, containerDefault)) {
      required.push(fieldName);
    }
  }

  return { properties, required };
};

const jsonSchemaForItem = (item: Item, items: ReadonlyMap<string, Item>): JsonSchema => {
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
        const variantParts = jsonSchemaForFields(
          variant.fields,
          item.attrs.renameAll,
          false,
          items
        );
        for (const [fieldName, schema] of Object.entries(variantParts.properties)) {
          properties[fieldName] = schema;
        }
        required.push(...variantParts.required);
        return { type: 'object', additionalProperties: false, properties, required };
      }),
    };
  }
  const { properties, required } = jsonSchemaForFields(
    item.fields,
    item.attrs.renameAll,
    item.attrs.default,
    items
  );
  if (item.name === 'JsonRpcResponse') {
    properties['jsonrpc'] = { const: '2.0' };
    return {
      type: 'object',
      additionalProperties: false,
      properties,
      required: ['jsonrpc', 'id'],
      oneOf: [
        { properties: { result: {}, error: false }, required: ['result'] },
        {
          properties: { result: false, error: { $ref: '#/$defs/JsonRpcError' } },
          required: ['error'],
        },
      ],
    };
  }
  return {
    type: 'object',
    additionalProperties: false,
    properties,
    ...(required.length > 0 ? { required } : {}),
  };
};

const protocolTypes = protocolRustSourcePaths.flatMap(parseItems);
const protocolTypesByName = new Map(protocolTypes.map((item) => [item.name, item]));
const definitions = Object.fromEntries(
  protocolTypes.map((item) => [item.name, jsonSchemaForItem(item, protocolTypesByName)])
);
definitions['AppServerRpcMethod'] = { type: 'string', enum: rpcMethods };
definitions['ClientRequest'] = {
  type: 'object',
  additionalProperties: false,
  properties: {
    jsonrpc: { const: '2.0' },
    id: { anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'null' }] },
    method: { $ref: '#/$defs/AppServerRpcMethod' },
    params: {},
  },
  required: ['jsonrpc', 'id', 'method'],
  oneOf: rpcMethods.map((method) => {
    const paramsType = rpcRequestSpecs.get(method);
    const properties: Record<string, JsonSchema> = {
      method: { const: method },
    };
    if (paramsType) {
      properties['params'] = jsonSchemaForRustType(paramsType);
      return { properties, required: ['params'] };
    }
    properties['params'] = { type: 'object', maxProperties: 0 };
    return { properties };
  }),
};
definitions['ClientResponse'] = { $ref: '#/$defs/JsonRpcResponse' };
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

/**
 * Simple YAML parser for the configuration files.
 * Uses Bun.YAML if available, otherwise falls back to a basic implementation.
 */

import { z } from 'zod';

import { parseJsonSchema } from '../json/parse';

interface IYamlParser {
  parse(content: string): unknown;
}

const stripInlineComment = (value: string): string => {
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }
    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }
    if (char !== '#' || inSingleQuote || inDoubleQuote) {
      continue;
    }
    if (i === 0 || /\s/.test(value[i - 1] ?? '')) {
      return value.slice(0, i).trimEnd();
    }
  }

  return value.trimEnd();
};

/**
 * A basic YAML parser that handles common features like indentation, lists, and multi-line strings.
 * It's not a full YAML spec implementation but sufficient for our config.yaml.
 */
export const basicYamlParse = (content: string): unknown => {
  try {
    // If it looks like JSON, parse it as JSON first
    if (content.trim().startsWith('{')) {
      const parsed = parseJsonSchema(content, z.unknown());
      if (!parsed.ok) {
        throw new Error('Failed to parse JSON content', { cause: parsed.error });
      }
      return parsed.value;
    }

    const lines = content.split(/\r?\n/);
    const result: Record<string, unknown> = {};
    const stack: {
      indent: number;
      obj: Record<string, unknown> | unknown[];
      key?: string;
    }[] = [{ indent: -1, obj: result }];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const trimmed = line.trim();

      // Skip empty lines and comments (if not in a multi-line string)
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }

      const indent = line.search(/\S/);

      // Pop from stack if indent decreased
      while (stack.length > 1 && indent <= stack[stack.length - 1]!.indent) {
        stack.pop();
      }

      const current = stack[stack.length - 1]!;
      // Split on first colon followed by space (or end), preserving URLs like https://
      const colonMatch = trimmed.match(/^([^:]+):\s*(.*)/);
      const key = colonMatch
        ? colonMatch[1]?.replace(/^-\s*/, '').trim()
        : trimmed.replace(/^-\s*/, '').trim();
      const isListItem = trimmed.startsWith('-');
      let value: unknown = colonMatch ? colonMatch[2]?.trim() : '';

      // Handle multi-line strings with |
      if (value === '|') {
        const textLines: string[] = [];
        let nextI = i + 1;
        let contentIndent = -1;

        while (nextI < lines.length) {
          const nextLine = lines[nextI]!;
          if (!nextLine.trim()) {
            textLines.push('');
            nextI++;
            continue;
          }

          const nextIndent = nextLine.search(/\S/);
          if (contentIndent === -1) {
            contentIndent = nextIndent;
          }

          if (nextIndent < contentIndent && nextLine.trim()) {
            break;
          }

          textLines.push(nextLine.slice(contentIndent));
          nextI++;
        }
        value = textLines.join('\n');
        i = nextI - 1;
      } else if (typeof value === 'string') {
        // Clean up inline comments
        const v = stripInlineComment(value).trim();

        // Handle common types
        if (v === 'true') value = true;
        else if (v === 'false') value = false;
        else if (v === 'null') value = null;
        else if (v === "''" || v === '""') value = '';
        else if (v && !isNaN(Number(v)) && trimmed.includes(':')) value = Number(v);
        else if (v.startsWith('"') && v.endsWith('"')) value = v.slice(1, -1);
        else if (v.startsWith("'") && v.endsWith("'")) value = v.slice(1, -1);
        else value = v;
      }

      if (isListItem) {
        // Check if we need to convert the current object container to an array
        // (e.g. "key:\n  - item")
        if (
          stack.length > 1 &&
          !Array.isArray(current.obj) &&
          current.key &&
          Object.keys(current.obj).length === 0
        ) {
          const parent = stack[stack.length - 2]!;
          const parentObj = parent.obj as Record<string, unknown>;
          // Double check we are modifying the right thing
          if (parentObj[current.key] === current.obj) {
            const newArray: unknown[] = [];
            parentObj[current.key] = newArray;
            current.obj = newArray;
          }
        }

        let list: unknown[];
        if (Array.isArray(current.obj)) {
          list = current.obj;
        } else {
          // Fallback for weird structures or flat lists not under a key (shouldn't happen in our config)
          if (!Array.isArray(current.obj[current.key!])) {
            current.obj[current.key!] = [];
          }
          list = current.obj[current.key!] as unknown[];
        }

        if (trimmed.includes(':')) {
          // Complex list item: - id: val
          const itemObj: Record<string, unknown> = {};
          itemObj[key!] = value;
          list.push(itemObj);
          stack.push({ indent, obj: itemObj, key: key! });
        } else {
          // Simple list item: - val
          const simpleVal = trimmed
            .replace(/^-\s*/, '')
            .trim()
            .replace(/^['"]|['"]$/g, '');
          list.push(simpleVal);
        }
      } else if (key) {
        const currentObj = current.obj as Record<string, unknown>;
        if (value === '' && !trimmed.endsWith(': ""') && !trimmed.endsWith(": ''")) {
          // It's a nested object
          const nestedObj: Record<string, unknown> = {};
          currentObj[key] = nestedObj;
          stack.push({ indent, obj: nestedObj, key });
        } else {
          currentObj[key] = value;
        }
      }
    }

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse YAML: ${message}`, { cause: error });
  }
};

/**
 * Universal YAML parser that works in both Bun and Node.js
 */
export const yamlParser: IYamlParser = {
  parse(content: string): unknown {
    if (typeof Bun !== 'undefined' && Bun.YAML) {
      return Bun.YAML.parse(content);
    }
    return basicYamlParse(content);
  },
};

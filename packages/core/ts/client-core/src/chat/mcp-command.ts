export type ParsedMcpCallCommand = {
  serverName: string;
  toolName: string;
  argumentsObject: Record<string, unknown>;
};

const MCP_CALL_PREFIX = /^\/mcp\s+call\b/i;

export const isMcpCallCommand = (input: string): boolean => MCP_CALL_PREFIX.test(input.trim());

export const parseMcpCallCommand = (input: string): ParsedMcpCallCommand | null => {
  const trimmed = input.trim();
  if (!isMcpCallCommand(trimmed)) {
    return null;
  }

  const parts = trimmed.split(/\s+/);
  if (parts.length < 4) {
    throw new Error('Usage: /mcp call <server> <tool> [json-arguments]');
  }

  const serverName = parts[2]?.trim() ?? '';
  const toolName = parts[3]?.trim() ?? '';
  const rawArguments = parts.slice(4).join(' ').trim();

  if (!serverName || !toolName) {
    throw new Error('Usage: /mcp call <server> <tool> [json-arguments]'); // coverage-ignore-line -- whitespace splitting makes this defensive.
  }

  if (!rawArguments) {
    return {
      serverName,
      toolName,
      argumentsObject: {},
    };
  }

  let parsedArguments: unknown;
  try {
    parsedArguments = JSON.parse(rawArguments);
  } catch (error) {
    throw new Error(
      `Invalid MCP arguments JSON: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  }

  if (!parsedArguments || Array.isArray(parsedArguments) || typeof parsedArguments !== 'object') {
    throw new Error('MCP arguments must be a JSON object.');
  }

  return {
    serverName,
    toolName,
    argumentsObject: parsedArguments as Record<string, unknown>,
  };
};

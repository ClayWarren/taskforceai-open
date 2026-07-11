import type { PendingApproval } from '../types';

export type PendingMcpToolApproval = {
  serverName: string;
  toolName: string;
  argumentsObject: Record<string, unknown>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const parsePendingMcpToolApproval = (
  approval: PendingApproval | null | undefined
): PendingMcpToolApproval | null => {
  if (!approval || !isRecord(approval.metadata)) {
    return null;
  }

  const source = approval.metadata['source'];
  const action = approval.metadata['action'];
  const serverName = approval.metadata['serverName'];
  const toolName = approval.metadata['toolName'];
  const argumentsObject = approval.metadata['arguments'];

  if (source !== 'mcp' || action !== 'tool_call') {
    return null;
  }
  if (typeof serverName !== 'string' || serverName.trim() === '') {
    return null;
  }
  if (typeof toolName !== 'string' || toolName.trim() === '') {
    return null;
  }
  if (!isRecord(argumentsObject)) {
    return {
      serverName,
      toolName,
      argumentsObject: {},
    };
  }

  return {
    serverName,
    toolName,
    argumentsObject,
  };
};

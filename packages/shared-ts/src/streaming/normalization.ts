import type { ToolUsageEvent } from '../types';
import type { ToolUsageEventPayload } from './types';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const FAILURE_STATUS_TOKENS = ['fail', 'error', 'abort', 'cancel', 'deny', 'timeout'] as const;
const SUCCESS_STATUS_TOKENS = ['success', 'complete', 'done', 'ok'] as const;

const getPayloadValue = <K extends keyof ToolUsageEventPayload>(
  event: ToolUsageEvent | ToolUsageEventPayload,
  key: K
): ToolUsageEventPayload[K] | undefined => {
  if (!(key in event)) {
    return undefined;
  }
  return (event as ToolUsageEventPayload)[key];
};

const getPayloadString = (
  event: ToolUsageEvent | ToolUsageEventPayload,
  key: keyof ToolUsageEventPayload
): string | undefined => {
  const value = getPayloadValue(event, key);
  return typeof value === 'string' ? value : undefined;
};

const getPayloadNumber = (
  event: ToolUsageEvent | ToolUsageEventPayload,
  key: keyof ToolUsageEventPayload
): number | undefined => {
  const value = getPayloadValue(event, key);
  return typeof value === 'number' ? value : undefined;
};

const resolveAgentId = (event: ToolUsageEvent | ToolUsageEventPayload): number | undefined => {
  if (typeof event.agentId === 'number') {
    return event.agentId;
  }
  return getPayloadNumber(event, 'agent_id');
};

const resolveInvocationId = (event: ToolUsageEvent | ToolUsageEventPayload): string | undefined => {
  if (typeof event.invocationId === 'string' && event.invocationId.length > 0) {
    return event.invocationId;
  }
  const payloadInvocationId = getPayloadString(event, 'invocation_id');
  return payloadInvocationId && payloadInvocationId.length > 0 ? payloadInvocationId : undefined;
};

const resolveAgentLabel = (
  event: ToolUsageEvent | ToolUsageEventPayload,
  agentId: number | undefined
): string => {
  if (typeof event.agentLabel === 'string') {
    return event.agentLabel;
  }
  const payloadAgentLabel = getPayloadString(event, 'agent_label');
  if (typeof payloadAgentLabel === 'string') {
    return payloadAgentLabel;
  }
  if (typeof agentId === 'number') {
    return `Agent ${agentId + 1}`;
  }
  return 'Agent';
};

const resolveToolName = (event: ToolUsageEvent | ToolUsageEventPayload): string => {
  if (typeof event.toolName === 'string') {
    return event.toolName;
  }
  return getPayloadString(event, 'tool_name') ?? 'Tool';
};

const resolveArguments = (event: ToolUsageEvent | ToolUsageEventPayload): unknown => {
  const payloadToolInput = getPayloadValue(event, 'tool_input');
  const rawArguments = event.arguments ?? payloadToolInput;
  if (rawArguments === null || rawArguments === undefined) {
    return {};
  }
  return rawArguments;
};

const resolveDurationMs = (event: ToolUsageEvent | ToolUsageEventPayload): number => {
  if (typeof event.durationMs === 'number') {
    return event.durationMs;
  }
  return getPayloadNumber(event, 'duration_ms') ?? 0;
};

const parseJsonRecord = (value: string): Record<string, unknown> | undefined => {
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
};

const getStructuredToolOutput = (
  event: ToolUsageEvent | ToolUsageEventPayload
): Record<string, unknown> | undefined => {
  const payloadToolOutput = getPayloadValue(event, 'tool_output');
  if (isRecord(payloadToolOutput)) {
    return payloadToolOutput;
  }
  if (typeof payloadToolOutput === 'string') {
    return parseJsonRecord(payloadToolOutput);
  }
  if (typeof event.resultPreview === 'string') {
    return parseJsonRecord(event.resultPreview);
  }
  return undefined;
};

const resolveToolOutputError = (
  event: ToolUsageEvent | ToolUsageEventPayload
): string | undefined => {
  const output = getStructuredToolOutput(event);
  if (!output) {
    return undefined;
  }
  for (const key of ['errors', 'error', 'screenshot_error']) {
    const value = output[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
};

const resolveSuccess = (event: ToolUsageEvent | ToolUsageEventPayload): boolean => {
  if (typeof event.success === 'boolean') {
    return event.success;
  }

  if (typeof event.error === 'string') {
    return false;
  }

  const output = getStructuredToolOutput(event);
  if (output) {
    if (output['success'] === false) {
      return false;
    }
    if (resolveToolOutputError(event)) {
      return false;
    }
  }

  const payloadStatus = getPayloadString(event, 'status');
  if (typeof payloadStatus === 'string') {
    const status = payloadStatus.toLowerCase();
    if (FAILURE_STATUS_TOKENS.some((token) => status.includes(token))) {
      return false;
    }
    if (SUCCESS_STATUS_TOKENS.some((token) => status.includes(token))) {
      return true;
    }
  }

  return true;
};

const resolveTimestamp = (event: ToolUsageEvent | ToolUsageEventPayload): string => {
  const timestampValue = event.timestamp;
  if (typeof timestampValue === 'string') {
    return timestampValue;
  }
  if (typeof timestampValue === 'number') {
    return new Date(timestampValue).toISOString();
  }
  return new Date().toISOString();
};

const resolveStatus = (
  event: ToolUsageEvent | ToolUsageEventPayload,
  success: boolean
): string | undefined => {
  if (!success) {
    return 'failed';
  }
  const explicitStatus = getPayloadString(event, 'status') ?? event.status;
  if (typeof explicitStatus === 'string' && explicitStatus.trim().length > 0) {
    return explicitStatus.trim();
  }
  if (typeof event.error === 'string' && event.error.length > 0) {
    return 'failed';
  }
  if (typeof event.resultPreview === 'string' && event.resultPreview.length > 0) {
    return 'completed';
  }
  if (event.success === true) {
    return 'completed';
  }
  if (event.success === false) {
    return 'failed';
  }
  return undefined;
};

const resolveResultPreview = (
  event: ToolUsageEvent | ToolUsageEventPayload
): string | undefined => {
  if (typeof event.resultPreview === 'string') {
    return event.resultPreview;
  }
  const payloadToolOutput = getPayloadValue(event, 'tool_output');
  return typeof payloadToolOutput === 'string' ? payloadToolOutput : undefined;
};

const resolveImageBase64 = (event: ToolUsageEvent | ToolUsageEventPayload): string | undefined => {
  if (typeof event.image_base64 === 'string' && event.image_base64.length > 0) {
    return event.image_base64;
  }

  const toolOutput = getPayloadValue(event, 'tool_output');
  if (!isRecord(toolOutput)) {
    return undefined;
  }

  const imageBase64 = toolOutput['image_base64'];
  if (typeof imageBase64 === 'string' && imageBase64.length > 0) {
    return imageBase64;
  }
  return undefined;
};

const stringValue = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;

const numberValue = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const resolveGeneratedFile = (
  event: ToolUsageEvent | ToolUsageEventPayload
): ToolUsageEvent['generatedFile'] | undefined => {
  const direct = isRecord(event.generatedFile) ? event.generatedFile : undefined;
  const output = getStructuredToolOutput(event);
  const nested =
    output && isRecord(output['generated_file']) ? output['generated_file'] : undefined;
  const raw = direct ?? nested;
  if (!raw) {
    return undefined;
  }
  const filename = stringValue(raw['filename']);
  if (!filename) {
    return undefined;
  }
  return {
    ...(stringValue(raw['artifactId'] ?? raw['artifact_id'])
      ? { artifactId: stringValue(raw['artifactId'] ?? raw['artifact_id']) }
      : {}),
    filename,
    ...(stringValue(raw['filepath']) ? { filepath: stringValue(raw['filepath']) } : {}),
    ...(stringValue(raw['mimeType'] ?? raw['mime_type'])
      ? { mimeType: stringValue(raw['mimeType'] ?? raw['mime_type']) }
      : {}),
    ...(numberValue(raw['bytes']) ? { bytes: numberValue(raw['bytes']) } : {}),
    ...(stringValue(raw['fileId'] ?? raw['file_id'])
      ? { fileId: stringValue(raw['fileId'] ?? raw['file_id']) }
      : {}),
    ...(stringValue(raw['downloadUrl'] ?? raw['download_url'])
      ? { downloadUrl: stringValue(raw['downloadUrl'] ?? raw['download_url']) }
      : {}),
  };
};

const isSourceReference = (
  value: unknown
): value is NonNullable<ToolUsageEvent['sources']>[number] =>
  isRecord(value) && typeof value['url'] === 'string';

const resolveSources = (
  event: ToolUsageEvent | ToolUsageEventPayload
): ToolUsageEvent['sources'] | undefined => {
  if (!Array.isArray(event.sources)) {
    return undefined;
  }
  const sources = event.sources.filter(isSourceReference);
  return sources.length > 0 ? sources : undefined;
};

export const normalizeToolUsageEvent = (
  event: ToolUsageEvent | ToolUsageEventPayload
): ToolUsageEvent => {
  const agentId = resolveAgentId(event);
  const invocationId = resolveInvocationId(event);
  const resultPreviewValue = resolveResultPreview(event);
  const imageBase64 = resolveImageBase64(event);
  const generatedFile = resolveGeneratedFile(event);
  const sources = resolveSources(event);
  const success = resolveSuccess(event);
  const outputError = resolveToolOutputError(event);

  const normalized: ToolUsageEvent = {
    timestamp: resolveTimestamp(event),
    agentLabel: resolveAgentLabel(event, agentId),
    toolName: resolveToolName(event),
    arguments: resolveArguments(event),
    success,
    durationMs: resolveDurationMs(event),
  };

  if (typeof imageBase64 === 'string' && imageBase64.length > 0) {
    normalized.image_base64 = imageBase64;
  }

  if (invocationId) {
    normalized.invocationId = invocationId;
  }
  if (typeof agentId === 'number') {
    normalized.agentId = agentId;
  }
  const status = resolveStatus(event, success);
  if (status) {
    normalized.status = status;
  }
  if (typeof resultPreviewValue === 'string') {
    normalized.resultPreview = resultPreviewValue;
  }
  if (typeof event.error === 'string') {
    normalized.error = event.error;
  } else if (outputError) {
    normalized.error = outputError;
  }
  if (sources) {
    normalized.sources = sources;
  }
  if (generatedFile) {
    normalized.generatedFile = generatedFile;
  }
  return normalized;
};

export const normalizeToolUsageEvents = (
  events: Array<ToolUsageEvent | ToolUsageEventPayload>
): ToolUsageEvent[] => events.map((event) => normalizeToolUsageEvent(event));

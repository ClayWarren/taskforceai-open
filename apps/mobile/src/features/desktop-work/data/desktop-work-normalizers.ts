import type { DesktopThread, DesktopThreadItem, DesktopTurn } from './desktop-work.types';

export const normalizeDesktopThread = (
  value: unknown,
  hostId = '',
  machineName = 'Desktop'
): DesktopThread => {
  const thread = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const id = stringValue(thread.id) || stringValue(thread.sessionId);
  const turns = Array.isArray(thread.turns) ? (thread.turns as DesktopTurn[]) : [];
  const latestTurn = turns.at(-1);
  const activeTurn = findLastActiveTurn(turns);
  const lastMessage = lastThreadText(turns);
  return {
    id,
    sessionId: id,
    hostId,
    machineName,
    projectId: optionalNumber(thread.projectId ?? thread.project_id),
    workspaceRoot: optionalString(thread.workspaceRoot ?? thread.workspace_root),
    title: stringValue(thread.title) || 'Desktop thread',
    objective: stringValue(thread.objective),
    state: stringValue(thread.state) || 'active',
    archived: Boolean(thread.archived),
    source: stringValue(thread.source) || 'desktop',
    taskMode: taskModeValue(thread.taskMode),
    parentThreadId: optionalString(thread.parentThreadId ?? thread.parentSessionId),
    turns,
    lastMessage: optionalString(thread.lastMessage) ?? lastMessage,
    runIds: Array.isArray(thread.runIds)
      ? thread.runIds.filter((item): item is string => typeof item === 'string')
      : turns.map((turn) => turn.runId),
    activeRunId: optionalString(thread.activeRunId) ?? activeTurn?.runId ?? null,
    lastError: optionalString(thread.lastError) ?? turnError(latestTurn),
    createdAt: numberValue(thread.createdAt),
    updatedAt: numberValue(thread.updatedAt),
  };
};

const findLastActiveTurn = (turns: DesktopTurn[]): DesktopTurn | undefined => {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (
      turn?.status === 'inProgress' ||
      turn?.status === 'in_progress' ||
      turn?.status === 'queued'
    ) {
      return turn;
    }
  }
  return undefined;
};

const lastThreadText = (turns: DesktopTurn[]): string | null => {
  for (let turnIndex = turns.length - 1; turnIndex >= 0; turnIndex -= 1) {
    const turn = turns[turnIndex];
    if (!turn) continue;
    for (let itemIndex = turn.items.length - 1; itemIndex >= 0; itemIndex -= 1) {
      const item = turn.items[itemIndex];
      if (!item) continue;
      const text = threadItemText(item);
      if (text && (item.type === 'agentMessage' || item.type === 'error')) return text;
    }
  }
  return null;
};

export const threadItemText = (item: DesktopThreadItem): string => {
  if (typeof item.content === 'string') return item.content;
  if (item.content && typeof item.content === 'object') {
    const content = item.content as Record<string, unknown>;
    const directText = [
      content.text,
      content.message,
      content.error,
      content.output,
      content.result,
      content.summary,
      content.description,
    ].find((value) => typeof value === 'string' && value.trim().length > 0);
    if (typeof directText === 'string') return directText;
    const toolName = stringValue(content.toolName ?? content.name);
    const detail = content.arguments ?? content.input ?? content.result ?? content.output;
    if (toolName && detail !== undefined) {
      return `${toolName}\n${formatThreadItemValue(detail)}`;
    }
    if (toolName) return toolName;
    return formatThreadItemValue(content);
  }
  return '';
};

export const threadItemImageUri = (item: DesktopThreadItem): string | null => {
  if (!isRecord(item.content)) return null;
  const encoded = item.content.imageBase64 ?? item.content.image_base64;
  if (typeof encoded !== 'string' || !encoded.trim()) return null;
  if (encoded.startsWith('data:image/')) return encoded;
  const mimeType = stringValue(item.content.imageMimeType ?? item.content.image_mime_type);
  return `data:${mimeType.startsWith('image/') ? mimeType : 'image/png'};base64,${encoded}`;
};

const formatThreadItemValue = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'bigint' || typeof value === 'symbol') return String(value);
  try {
    return JSON.stringify(
      value,
      (key, nested) =>
        key === 'imageBase64' || key === 'image_base64' ? '[desktop screenshot]' : nested,
      2
    );
  } catch {
    return '[unserializable desktop item]';
  }
};

const turnError = (turn: DesktopTurn | undefined): string | null => {
  const item = turn?.items.find((candidate) => candidate.type === 'error');
  return item ? threadItemText(item) : null;
};

const stringValue = (value: unknown): string => (typeof value === 'string' ? value : '');
const optionalString = (value: unknown): string | null => {
  const result = stringValue(value);
  return result || null;
};
const numberValue = (value: unknown): number => (typeof value === 'number' ? value : 0);
const optionalNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) ? value : null;
const taskModeValue = (value: unknown): DesktopThread['taskMode'] =>
  value === 'work' || value === 'code' ? value : 'chat';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);


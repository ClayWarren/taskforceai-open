import { z } from 'zod';
import { systemRNG } from '../random/rng';

declare const __brand: unique symbol;
export type Brand<T, B extends string> = T & { readonly [__brand]: B };

export type ConversationId = Brand<string, 'ConversationId'>;
export type ServerConversationId = Brand<number, 'ServerConversationId'>;
export type MessageId = Brand<string, 'MessageId'>;
export type UserId = Brand<string, 'UserId'>;
export type AgentId = Brand<string, 'AgentId'>;
export type DeviceId = Brand<string, 'DeviceId'>;
export type TaskId = Brand<string, 'TaskId'>;
export type ApiKeyId = Brand<string, 'ApiKeyId'>;
export type SessionId = Brand<string, 'SessionId'>;

const to = <T>(id: any) => id as T;
export const toConversationId = (id: string) => to<ConversationId>(id);
export const toServerConversationId = (id: number) => to<ServerConversationId>(id);
export const toMessageId = (id: string) => to<MessageId>(id);
export const toUserId = (id: string) => to<UserId>(id);
export const toAgentId = (id: string) => to<AgentId>(id);
export const toDeviceId = (id: string) => to<DeviceId>(id);
export const toTaskId = (id: string) => to<TaskId>(id);
export const toApiKeyId = (id: string) => to<ApiKeyId>(id);
export const toSessionId = (id: string) => to<SessionId>(id);

export const isValidIdString = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
export const isValidServerId = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v > 0;
export const unwrapId = <T extends string>(id: Brand<string, T>) => id as string;
export const unwrapServerId = <T extends string>(id: Brand<number, T>) => id as number;

const gen = (p: string) => `${p}-${systemRNG.uuid()}`;
export const createConversationId = () => toConversationId(gen('conv'));
export const createMessageId = (r?: string) => toMessageId(gen(r || 'msg'));
export const createDeviceId = () => toDeviceId(gen('device'));
export const createTaskId = () => toTaskId(gen('task'));
export const createSessionId = () => toSessionId(gen('session'));

const s = (f: any) => z.string().min(1).transform(f);
export const conversationIdSchema = s(toConversationId);
export const serverConversationIdSchema = z
  .number()
  .int()
  .positive()
  .transform(toServerConversationId);
export const messageIdSchema = s(toMessageId);
export const userIdSchema = s(toUserId);
export const agentIdSchema = s(toAgentId);
export const deviceIdSchema = s(toDeviceId);
export const taskIdSchema = s(toTaskId);
export const apiKeyIdSchema = s(toApiKeyId);
export const sessionIdSchema = s(toSessionId);

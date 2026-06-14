import { z } from 'zod';
import { parseJsonSchema } from '../json/parse';

const orchestrationConfigSchema = z.object({
  roleModels: z.record(z.string(), z.string()),
  budget: z.number().optional(),
  agentCount: z.number().optional(),
});

export type OrchestrationConfig = z.infer<typeof orchestrationConfigSchema>;

export const parseOrchestrationConfig = (raw: string): OrchestrationConfig | null => {
  const parsed = parseJsonSchema(raw, orchestrationConfigSchema);
  return parsed.ok ? parsed.value : null;
};

const serializeOrchestrationConfig = (config: OrchestrationConfig): string => {
  return JSON.stringify(config);
};

export interface OrchestrationConfigStorageAdapter {
  read: () => string | null | Promise<string | null>;
  write: (value: string) => void | Promise<void>;
}

export interface OrchestrationConfigStorageOptions {
  onReadError?: (error: unknown) => void;
  onWriteError?: (error: unknown, config: OrchestrationConfig) => void;
}

export const readStoredOrchestrationConfigValue = async (
  adapter: Pick<OrchestrationConfigStorageAdapter, 'read'>,
  options: Pick<OrchestrationConfigStorageOptions, 'onReadError'> = {}
): Promise<OrchestrationConfig | null> => {
  try {
    const raw = await adapter.read();
    return raw ? parseOrchestrationConfig(raw) : null;
  } catch (error) {
    options.onReadError?.(error);
    return null;
  }
};

export const persistStoredOrchestrationConfigValue = async (
  adapter: Pick<OrchestrationConfigStorageAdapter, 'write'>,
  config: OrchestrationConfig,
  options: Pick<OrchestrationConfigStorageOptions, 'onWriteError'> = {}
): Promise<void> => {
  try {
    await adapter.write(serializeOrchestrationConfig(config));
  } catch (error) {
    options.onWriteError?.(error, config);
  }
};

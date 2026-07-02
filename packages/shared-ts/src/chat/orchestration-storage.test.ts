import { describe, expect, it, mock } from 'bun:test';

import {
  parseOrchestrationConfig,
  persistStoredOrchestrationConfigValue,
  readStoredOrchestrationConfigValue,
} from './orchestration-storage';

describe('orchestration storage', () => {
  it('parses and serializes orchestration config', () => {
    const config = {
      roleModels: { planner: 'gpt-5' },
      budget: 25,
      agentCount: 6,
    };

    expect(parseOrchestrationConfig(JSON.stringify(config))).toEqual(config);
    expect(parseOrchestrationConfig('{"bad":true}')).toBeNull();
  });

  it('reads stored config through sync or async adapters', async () => {
    const config = { roleModels: { engineer: 'gpt-5' }, agentCount: 4 };

    await expect(
      readStoredOrchestrationConfigValue({
        read: () => JSON.stringify(config),
      })
    ).resolves.toEqual(config);

    await expect(
      readStoredOrchestrationConfigValue({
        read: async () => JSON.stringify(config),
      })
    ).resolves.toEqual(config);
  });

  it('returns null and reports read failures', async () => {
    const onReadError = mock(() => undefined);
    const error = new Error('read failed');

    await expect(
      readStoredOrchestrationConfigValue(
        {
          read: async () => {
            throw error;
          },
        },
        { onReadError }
      )
    ).resolves.toBeNull();

    expect(onReadError).toHaveBeenCalledWith(error);
  });

  it('persists config through sync or async adapters', async () => {
    const config = { roleModels: { planner: 'gpt-5' }, budget: 10 };
    const writeSync = mock(() => undefined);
    const writeAsync = mock(async () => undefined);

    await persistStoredOrchestrationConfigValue({ write: writeSync }, config);
    await persistStoredOrchestrationConfigValue({ write: writeAsync }, config);

    expect(writeSync).toHaveBeenCalledWith(JSON.stringify(config));
    expect(writeAsync).toHaveBeenCalledWith(JSON.stringify(config));
  });

  it('reports write failures without throwing', async () => {
    const config = { roleModels: {}, agentCount: 2 };
    const error = new Error('write failed');
    const onWriteError = mock(() => undefined);

    await expect(
      persistStoredOrchestrationConfigValue(
        {
          write: async () => {
            throw error;
          },
        },
        config,
        { onWriteError }
      )
    ).resolves.toBeUndefined();

    expect(onWriteError).toHaveBeenCalledWith(error, config);
  });
});

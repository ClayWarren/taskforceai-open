import { describe, expect, it } from 'bun:test';

import {
  AgentError,
  ConfigurationError,
  OrchestrationError,
  SearchError,
  TaskforceError,
  ToolError,
  formatErrorPayload,
  isTaskforceError,
} from './index';

describe('client-core/errors', () => {
  describe('TaskforceError', () => {
    it('sets the default HTTP status for known error codes', () => {
      expect(new TaskforceError('ERR_INVALID_REQUEST', 'Invalid request').status).toBe(400);
      expect(new TaskforceError('ERR_DUPLICATE_EMAIL', 'Duplicate email').status).toBe(409);
      expect(new TaskforceError('ERR_NOT_FOUND', 'Missing').status).toBe(404);
      expect(new TaskforceError('ERR_UNAUTHORIZED', 'Unauthorized').status).toBe(401);
      expect(new TaskforceError('ERR_FORBIDDEN', 'Forbidden').status).toBe(403);
      expect(new TaskforceError('ERR_INTERNAL', 'Internal').status).toBe(500);
    });

    it('preserves explicit status, details, cause, and Error prototype behavior', () => {
      const cause = new Error('database failed');
      const error = new TaskforceError(
        'ERR_INTERNAL',
        'Operation failed',
        503,
        { traceId: 'trace-1' },
        { cause }
      );

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(TaskforceError);
      expect(error.name).toBe('TaskforceError');
      expect(error.status).toBe(503);
      expect(error.details).toEqual({ traceId: 'trace-1' });
      expect(error.cause).toBe(cause);
    });

    it('serializes safe error payloads', () => {
      const error = new TaskforceError('ERR_FORBIDDEN', 'Forbidden', undefined, {
        scope: 'admin',
      });

      expect(error.toJSON()).toEqual({
        error: 'Forbidden',
        code: 'ERR_FORBIDDEN',
        details: { scope: 'admin' },
      });
      expect(formatErrorPayload(error)).toEqual(error.toJSON());
    });

    it('identifies only TaskforceError instances', () => {
      expect(isTaskforceError(new TaskforceError('ERR_INTERNAL', 'Internal'))).toBe(true);
      expect(isTaskforceError(new Error('plain'))).toBe(false);
      expect(isTaskforceError(null)).toBe(false);
    });
  });

  it('sets metadata on specialized error classes', () => {
    const cause = new Error('root cause');

    expect(new AgentError('agent failed', cause)).toMatchObject({
      name: 'AgentError',
      message: 'agent failed',
      cause,
    });
    expect(new ToolError('tool failed', 'browser', cause)).toMatchObject({
      name: 'ToolError',
      message: 'tool failed',
      toolName: 'browser',
      cause,
    });
    expect(new ConfigurationError('missing config', 'AUTH_SECRET', cause)).toMatchObject({
      name: 'ConfigurationError',
      message: 'missing config',
      configKey: 'AUTH_SECRET',
      cause,
    });
    expect(new SearchError('search failed', 'query', cause)).toMatchObject({
      name: 'SearchError',
      message: 'search failed',
      query: 'query',
      cause,
    });
    expect(new OrchestrationError('stage failed', 'synthesis', cause)).toMatchObject({
      name: 'OrchestrationError',
      message: 'stage failed',
      stage: 'synthesis',
      cause,
    });
  });
});

import { describe, expect, it } from 'bun:test';

import { buildBaseLogMeta } from './base-meta';

describe('logging/base-meta', () => {
  describe('buildBaseLogMeta', () => {
    it('includes app and service', () => {
      const result = buildBaseLogMeta({
        app: 'my-app',
        service: 'my-service',
      });
      expect(result).toEqual({
        app: 'my-app',
        service: 'my-service',
      });
    });

    it('includes runtime when provided', () => {
      const result = buildBaseLogMeta({
        app: 'my-app',
        service: 'my-service',
        runtime: 'node',
      });
      expect(result).toEqual({
        app: 'my-app',
        service: 'my-service',
        runtime: 'node',
      });
    });

    it('excludes runtime when not provided', () => {
      const result = buildBaseLogMeta({
        app: 'my-app',
        service: 'my-service',
        runtime: undefined,
      });
      expect(result).toEqual({
        app: 'my-app',
        service: 'my-service',
      });
      expect('runtime' in result).toBe(false);
    });
  });
});

import { describe, expect, it, mock } from 'bun:test';

mock.module('expo-crypto', () => ({}));

describe('SqlitePersister', () => {
  describe('createSqlitePersister', () => {
    it('creates persister with required methods', async () => {
      const { createSqlitePersister } = require('../../storage/SqlitePersister');
      const persister = createSqlitePersister();

      expect(persister).toHaveProperty('persistClient');
      expect(persister).toHaveProperty('restoreClient');
      expect(persister).toHaveProperty('removeClient');
    });

    it('persister methods are functions', () => {
      const { createSqlitePersister } = require('../../storage/SqlitePersister');
      const persister = createSqlitePersister();

      expect(typeof persister.persistClient).toBe('function');
      expect(typeof persister.restoreClient).toBe('function');
      expect(typeof persister.removeClient).toBe('function');
    });
  });
});

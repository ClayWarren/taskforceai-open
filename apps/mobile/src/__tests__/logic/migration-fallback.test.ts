import { describe, expect, it, mock } from 'bun:test';

mock.module('../../logger', () => ({
  mobileLogger: {
    info: mock(() => {}),
  },
}));

const { createTablesFallback } = await import('../../storage/migration-fallback');

describe('migration fallback schema builder', () => {
  it('creates the offline chat, prompt queue, auth, and sync tables with their indexes', () => {
    let sql = '';
    const rawDb = {
      execSync: (statement: string) => {
        sql = statement;
      },
    };

    createTablesFallback(rawDb as any);

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS conversations');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS messages');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS prompt_queue');
    expect(sql).toContain('attachment_ids TEXT');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS pending_changes');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS pending_prompts');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS auth_sessions');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS user_profiles');
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS conversations_conversation_id_key');
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS messages_message_id_key');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS pending_changes_created_at_idx');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS prompt_queue_status_idx');
  });
});

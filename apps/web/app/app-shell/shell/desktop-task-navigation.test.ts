import { describe, expect, it } from 'bun:test';

import { adjacentTask } from './desktop-task-navigation';

const task = (conversationId: string, isArchived = false) => ({
  conversationId,
  title: conversationId,
  createdAt: 1,
  updatedAt: 1,
  lastMessagePreview: null,
  isArchived,
});

describe('adjacentTask', () => {
  it('moves in either direction and wraps at the ends', () => {
    const tasks = [task('one'), task('two'), task('three')];

    expect(adjacentTask(tasks, 'two', 1)?.conversationId).toBe('three');
    expect(adjacentTask(tasks, 'two', -1)?.conversationId).toBe('one');
    expect(adjacentTask(tasks, 'three', 1)?.conversationId).toBe('one');
    expect(adjacentTask(tasks, 'one', -1)?.conversationId).toBe('three');
  });

  it('skips archived tasks and selects an edge when no task is active', () => {
    const tasks = [task('one'), task('archived', true), task('three')];

    expect(adjacentTask(tasks, null, 1)?.conversationId).toBe('one');
    expect(adjacentTask(tasks, null, -1)?.conversationId).toBe('three');
    expect(adjacentTask(tasks, 'one', 1)?.conversationId).toBe('three');
  });
});

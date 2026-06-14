import { describe, expect, it } from 'bun:test';

import { resolveStreamUrl } from './streaming-core';

describe('resolveStreamUrl', () => {
  it('uses a relative path when no API URL is configured', () => {
    expect(resolveStreamUrl('task-1')).toBe('/api/v1/stream/task-1');
  });

  it('uses a relative path when API URL is not absolute', () => {
    expect(resolveStreamUrl('task-2', '/api')).toBe('/api/v1/stream/task-2');
  });

  it('builds an absolute URL for normal absolute API URLs', () => {
    expect(resolveStreamUrl('task-3', 'https://api.taskforceai.chat/')).toBe(
      'https://api.taskforceai.chat/api/v1/stream/task-3'
    );
  });

  it('uses a relative path when a local configured API matches the current origin', () => {
    expect(resolveStreamUrl('task-local', 'http://localhost:5173', 'http://localhost:5173')).toBe(
      '/api/v1/stream/task-local'
    );
  });

  it('streams directly from the engine service when the production API matches the web origin', () => {
    expect(
      resolveStreamUrl('task-4', 'https://www.taskforceai.chat', 'https://www.taskforceai.chat')
    ).toBe('https://engine.taskforceai.chat/api/v1/stream/task-4');
  });

  it('streams directly from the engine service for apex TaskForce API URLs on the web app', () => {
    expect(
      resolveStreamUrl('task-www', 'https://taskforceai.chat', 'https://www.taskforceai.chat')
    ).toBe('https://engine.taskforceai.chat/api/v1/stream/task-www');
  });

  it('streams directly from the engine service for TaskForce service URLs on the web app', () => {
    expect(
      resolveStreamUrl(
        'task-engine',
        'https://engine.taskforceai.chat',
        'https://www.taskforceai.chat'
      )
    ).toBe('https://engine.taskforceai.chat/api/v1/stream/task-engine');
  });

  it('streams directly from the engine service for API gateway URLs on the web app', () => {
    expect(
      resolveStreamUrl('task-api', 'https://api.taskforceai.chat', 'https://www.taskforceai.chat')
    ).toBe('https://engine.taskforceai.chat/api/v1/stream/task-api');
  });

  it('keeps absolute URL when current origin is not http(s)', () => {
    expect(resolveStreamUrl('task-5', 'https://taskforceai.chat', 'tauri://localhost')).toBe(
      'https://taskforceai.chat/api/v1/stream/task-5'
    );
  });

  it('keeps external absolute API URLs', () => {
    expect(
      resolveStreamUrl('task-ext', 'https://api.example.com', 'https://www.taskforceai.chat')
    ).toBe('https://api.example.com/api/v1/stream/task-ext');
  });
});

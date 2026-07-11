import { describe, expect, it } from 'bun:test';
import { Button, Card, Input } from './index';

describe('UI Kit Smoke Test', () => {
  it('should export components', () => {
    expect(Button).toBeDefined();
    expect(Card).toBeDefined();
    expect(Input).toBeDefined();
  });
});

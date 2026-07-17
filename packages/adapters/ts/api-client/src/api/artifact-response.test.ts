import { describe, expect, it } from 'bun:test';

import { apiArtifactSchema, parseArtifactApiPayload } from './artifact-response';

const validArtifact = {
  id: 'artifact-1',
  ownerUserId: 42,
  type: 'DOCUMENT',
  title: 'Quarterly report',
  status: 'READY',
  visibility: 'PRIVATE',
  createdAt: '2026-07-06T12:00:00.000Z',
  updatedAt: '2026-07-06T12:01:00.000Z',
};

describe('api-client/artifact-response', () => {
  it('returns parsed artifact payloads', () => {
    const result = parseArtifactApiPayload(validArtifact, apiArtifactSchema);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBe(validArtifact.id);
      expect(result.value.type).toBe('DOCUMENT');
    }
  });

  it('reports invalid artifact payloads', () => {
    let invalidIssueCount = 0;

    const result = parseArtifactApiPayload(
      { ...validArtifact, status: 'BROKEN' },
      apiArtifactSchema,
      (error) => {
        invalidIssueCount = error.issues.length;
      }
    );

    expect(invalidIssueCount).toBeGreaterThan(0);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Invalid response from server');
    }
  });
});

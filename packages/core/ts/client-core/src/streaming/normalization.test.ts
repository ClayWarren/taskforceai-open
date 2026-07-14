import { describe, expect, it } from 'bun:test';

import { normalizeToolUsageEvent } from './normalization';

describe('client-core/streaming/normalization', () => {
  it('marks status=error events as unsuccessful', () => {
    const normalized = normalizeToolUsageEvent({
      tool_name: 'search_web',
      status: 'error',
    });

    expect(normalized.success).toBe(false);
  });

  it('marks events with error payload as unsuccessful', () => {
    const normalized = normalizeToolUsageEvent({
      tool_name: 'search_web',
      error: 'request timed out',
    });

    expect(normalized.success).toBe(false);
  });

  it('extracts computer-use screenshots from tool_output', () => {
    const normalized = normalizeToolUsageEvent({
      tool_name: 'computer_use',
      status: 'completed',
      tool_output: {
        image_base64: 'abc123',
      },
    });

    expect(normalized.image_base64).toBe('abc123');
  });

  it('marks structured tool_output failures as unsuccessful', () => {
    const normalized = normalizeToolUsageEvent({
      tool_name: 'computer_use',
      status: 'completed',
      tool_output: {
        success: false,
        errors: 'failed to start computer use',
      },
    });

    expect(normalized.success).toBe(false);
    expect(normalized.status).toBe('failed');
    expect(normalized.error).toBe('failed to start computer use');
  });

  it('marks JSON result previews with screenshot errors as unsuccessful', () => {
    const normalized = normalizeToolUsageEvent({
      tool_name: 'computer_use',
      status: 'completed',
      resultPreview: JSON.stringify({
        success: true,
        screenshot_error: 'screenshot output too short',
      }),
    });

    expect(normalized.success).toBe(false);
    expect(normalized.status).toBe('failed');
    expect(normalized.error).toBe('screenshot output too short');
  });

  it('preserves search sources from tool events', () => {
    const normalized = normalizeToolUsageEvent({
      tool_name: 'search_web',
      status: 'completed',
      sources: [
        { url: 'https://example.com/one', title: 'One' },
        { title: 'Missing URL' } as unknown as { url: string; title: string },
      ],
    });

    expect(normalized.sources).toEqual([{ url: 'https://example.com/one', title: 'One' }]);
  });

  it('preserves tool invocation ids from stream payloads', () => {
    expect(
      normalizeToolUsageEvent({
        invocation_id: 'call-search-1',
        tool_name: 'search_web',
      }).invocationId
    ).toBe('call-search-1');
    expect(
      normalizeToolUsageEvent({
        invocationId: 'call-search-2',
        toolName: 'search_web',
      }).invocationId
    ).toBe('call-search-2');
  });

  it('preserves running tool status from progress payloads', () => {
    const normalized = normalizeToolUsageEvent({
      invocation_id: 'call-search-3',
      tool_name: 'search_web',
      status: 'running',
      success: true,
    });

    expect(normalized.status).toBe('running');
    expect(normalized.success).toBe(true);
  });

  it('infers timestamps and statuses from legacy tool payload shapes', () => {
    const timestamp = Date.UTC(2026, 0, 2, 3, 4, 5);
    expect(
      normalizeToolUsageEvent({
        tool_name: 'search_web',
        timestamp: timestamp as unknown as string,
        resultPreview: 'Found a source',
      })
    ).toEqual(
      expect.objectContaining({
        timestamp: new Date(timestamp).toISOString(),
        status: 'completed',
        resultPreview: 'Found a source',
      })
    );

    expect(
      normalizeToolUsageEvent({
        tool_name: 'search_web',
        success: true,
      }).status
    ).toBe('completed');

    const failed = normalizeToolUsageEvent({
      tool_name: 'search_web',
      success: false,
    });
    expect(failed.success).toBe(false);
    expect(failed.status).toBe('failed');

    expect(
      normalizeToolUsageEvent({
        tool_name: 'search_web',
        success: true,
        error: 'partial warning',
      }).status
    ).toBe('failed');
  });

  it('preserves generated file artifacts', () => {
    expect(
      normalizeToolUsageEvent({
        toolName: 'create_chart',
        generatedFile: {
          artifactId: 'artifact-generated',
          filename: 'chart.png',
          mimeType: 'image/png',
          bytes: 2048,
          fileId: 'file-generated',
          downloadUrl: '/api/v1/developer/files/file-generated/content',
        },
      }).generatedFile
    ).toEqual({
      filename: 'chart.png',
      artifactId: 'artifact-generated',
      mimeType: 'image/png',
      bytes: 2048,
      fileId: 'file-generated',
      downloadUrl: '/api/v1/developer/files/file-generated/content',
    });

    expect(
      normalizeToolUsageEvent({
        tool_name: 'create_chart',
        tool_output: {
          generated_file: {
            filename: 'chart.svg',
            artifact_id: 'artifact-svg',
            mime_type: 'image/svg+xml',
            file_id: 'file-svg',
            download_url: '/api/v1/developer/files/file-svg/content',
          },
        },
      }).generatedFile
    ).toEqual({
      filename: 'chart.svg',
      artifactId: 'artifact-svg',
      mimeType: 'image/svg+xml',
      fileId: 'file-svg',
      downloadUrl: '/api/v1/developer/files/file-svg/content',
    });

    expect(
      normalizeToolUsageEvent({
        tool_name: 'create_chart',
        tool_output: {
          generated_file: {
            artifact_id: 'artifact-missing-name',
          },
        },
      }).generatedFile
    ).toBeUndefined();
  });

  it('omits invalid source entries', () => {
    expect(
      normalizeToolUsageEvent({
        tool_name: 'search_web',
        status: 'completed',
        sources: [{ title: 'Missing URL' } as unknown as { url: string; title: string }],
      }).sources
    ).toBeUndefined();
  });
});

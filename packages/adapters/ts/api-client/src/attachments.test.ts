import { describe, expect, it } from 'bun:test';

import { type RunTaskAttachment, buildRunFormData } from './attachments';

describe('contracts-ts/attachments', () => {
  describe('buildRunFormData', () => {
    const build = (payload: Parameters<typeof buildRunFormData>[0]) =>
      buildRunFormData(payload, []);

    it('creates FormData with prompt only', () => {
      const formData = build({ prompt: 'Hello world' });

      expect(formData.get('prompt')).toBe('Hello world');
    });

    const fieldCases: Array<
      [string, Parameters<typeof buildRunFormData>[0], string, FormDataEntryValue | null]
    > = [
      [
        'includes conversation_id when provided',
        { prompt: 'Hello', conversation_id: 'conv-123' },
        'conversation_id',
        'conv-123',
      ],
      [
        'excludes conversation_id when null',
        { prompt: 'Hello', conversation_id: null },
        'conversation_id',
        null,
      ],
      [
        'excludes conversation_id when undefined',
        { prompt: 'Hello', conversation_id: undefined },
        'conversation_id',
        null,
      ],
      ['includes modelId when provided', { prompt: 'Hello', modelId: 'gpt-4' }, 'modelId', 'gpt-4'],
      ['includes projectId when provided', { prompt: 'Hello', projectId: 0 }, 'projectId', '0'],
      ['excludes modelId when null', { prompt: 'Hello', modelId: null }, 'modelId', null],
      ['excludes projectId when null', { prompt: 'Hello', projectId: null }, 'projectId', null],
      [
        'excludes projectId when undefined',
        { prompt: 'Hello', projectId: undefined },
        'projectId',
        null,
      ],
      ['includes demo as string when true', { prompt: 'Hello', demo: true }, 'demo', 'true'],
      ['includes demo as string when false', { prompt: 'Hello', demo: false }, 'demo', 'false'],
      ['includes demo as string when number', { prompt: 'Hello', demo: 1 }, 'demo', '1'],
      ['excludes demo when undefined', { prompt: 'Hello', demo: undefined }, 'demo', null],
    ];

    for (const [name, payload, field, expected] of fieldCases) {
      it(name, () => {
        const formData = build(payload);

        expect(formData.get(field)).toBe(expected);
      });
    }

    it('appends single attachment', () => {
      const attachments: RunTaskAttachment[] = [
        { uri: 'file:///path/to/file.txt', name: 'file.txt', type: 'text/plain' },
      ];

      const formData = buildRunFormData({ prompt: 'Hello' }, attachments);

      expect(formData.getAll('files')).toHaveLength(1);
    });

    it('allows non-file attachment URIs', () => {
      const attachments: RunTaskAttachment[] = [
        { uri: 'https://example.test/file.txt', name: 'file.txt', type: 'text/plain' },
      ];

      const formData = buildRunFormData({ prompt: 'Hello' }, attachments);

      expect(formData.getAll('files')).toHaveLength(1);
    });

    it('appends multiple attachments', () => {
      const attachments: RunTaskAttachment[] = [
        { uri: 'file:///path/to/file1.txt', name: 'file1.txt', type: 'text/plain' },
        { uri: 'file:///path/to/file2.jpg', name: 'file2.jpg', type: 'image/jpeg' },
      ];

      const formData = buildRunFormData({ prompt: 'Hello' }, attachments);

      expect(formData.getAll('files')).toHaveLength(2);
    });

    it('rejects UNC-style file attachment URIs', () => {
      const cases = [
        'file://server/share/report.txt',
        ' FILE://server/share/report.txt ',
        'file:////server/share/report.txt',
        '\\\\server\\share\\report.txt',
        '  \\\\server\\share\\report.txt  ',
        '//server/share/report.txt',
      ];

      for (const uri of cases) {
        expect(() => buildRunFormData({ prompt: 'Hello' }, [{ uri, name: 'report.txt' }])).toThrow(
          'UNC file attachment URIs are not allowed'
        );
      }
    });

    it('uses default type when attachment type is undefined', () => {
      const attachments: RunTaskAttachment[] = [
        { uri: 'file:///path/to/file.bin', name: 'file.bin' },
      ];

      const formData = buildRunFormData({ prompt: 'Hello' }, attachments);

      expect(formData.getAll('files')).toHaveLength(1);
    });

    it('handles all payload fields together', () => {
      const attachments: RunTaskAttachment[] = [
        { uri: 'file:///test.pdf', name: 'test.pdf', type: 'application/pdf' },
      ];

      const formData = buildRunFormData(
        {
          prompt: 'Process this',
          conversation_id: 'conv-abc',
          modelId: 'claude-3',
          demo: true,
        },
        attachments
      );

      expect(formData.get('prompt')).toBe('Process this');
      expect(formData.get('conversation_id')).toBe('conv-abc');
      expect(formData.get('modelId')).toBe('claude-3');
      expect(formData.get('demo')).toBe('true');
      expect(formData.getAll('files').length).toBe(1);
    });

    it('includes serialized structured payload fields', () => {
      const payload = {
        prompt: 'Hello',
        role_models: { planner: 'gpt-5', coder: 'gpt-4.1' },
        options: { computerUseEnabled: true, max_steps: 12 },
        attachments: [{ data: 'aGVsbG8=', mime_type: 'image/png' as const, name: 'img.png' }],
        audio_attachments: [{ data: 'YXVkaW8=', format: 'mp3' as const, name: 'clip.mp3' }],
        video_attachments: [
          { data: 'dmlkZW8=', mime_type: 'video/mp4' as const, name: 'clip.mp4' },
        ],
      };

      const formData = buildRunFormData(payload, []);

      expect(formData.get('role_models')).toBe(JSON.stringify(payload.role_models));
      expect(formData.get('options')).toBe(JSON.stringify(payload.options));
      expect(formData.get('attachments')).toBe(JSON.stringify(payload.attachments));
      expect(formData.get('audio_attachments')).toBe(JSON.stringify(payload.audio_attachments));
      expect(formData.get('video_attachments')).toBe(JSON.stringify(payload.video_attachments));
    });
  });
});

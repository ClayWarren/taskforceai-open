import { z } from 'zod';

export const MAX_ATTACHMENTS = 5;

// Tiered limits (industry standard)
export const MAX_IMAGE_SIZE_BYTES = 20 * 1024 * 1024; // 20MB
export const MAX_DOCUMENT_SIZE_BYTES = 20 * 1024 * 1024; // 20MB
export const MAX_AUDIO_SIZE_BYTES = 20 * 1024 * 1024; // 20MB
export const MAX_VIDEO_SIZE_BYTES = 100 * 1024 * 1024; // 100MB
export const MAX_TOTAL_ATTACHMENT_SIZE_BYTES = 100 * 1024 * 1024; // 100MB

export const MAX_INLINE_ATTACHMENT_BYTES = 256 * 1024; // 256KB

export const SUPPORTED_IMAGE_ATTACHMENT_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
] as const;

export const SUPPORTED_VIDEO_ATTACHMENT_MIME_TYPES = ['video/mp4', 'video/webm'] as const;

export const SUPPORTED_AUDIO_ATTACHMENT_MIME_TYPES = [
  'audio/wav',
  'audio/wave',
  'audio/mpeg',
  'audio/mp3',
  'audio/webm',
  'audio/ogg',
] as const;

export const SUPPORTED_DOCUMENT_ATTACHMENT_MIME_TYPES = [
  'text/plain',
  'text/markdown',
  'application/json',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
] as const;

const SUPPORTED_ATTACHMENT_MIME_TYPES = new Set<string>([
  ...SUPPORTED_IMAGE_ATTACHMENT_MIME_TYPES,
  ...SUPPORTED_VIDEO_ATTACHMENT_MIME_TYPES,
  ...SUPPORTED_AUDIO_ATTACHMENT_MIME_TYPES,
  ...SUPPORTED_DOCUMENT_ATTACHMENT_MIME_TYPES,
]);

const OFFICE_MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

const filenameExtension = (filename: string): string => {
  const basename = filename.trim().split(/[\\/]/).at(-1) ?? '';
  const dot = basename.lastIndexOf('.');
  return dot > 0 && dot < basename.length - 1 ? basename.slice(dot).toLowerCase() : '';
};

const normalizeAttachmentMime = (filename: string, mimeType?: string | null): string => {
  const normalized = (mimeType ?? '').split(';', 1)[0]?.trim().toLowerCase() ?? '';
  const extension = filenameExtension(filename);
  const officeMime = OFFICE_MIME_BY_EXTENSION[extension];
  if (
    officeMime &&
    (normalized === '' ||
      normalized === 'application/zip' ||
      normalized === 'application/octet-stream')
  ) {
    return officeMime;
  }
  if (
    extension === '.csv' &&
    (normalized === 'text/plain' || normalized === 'application/octet-stream')
  ) {
    return 'text/csv';
  }
  return normalized;
};

export const emailSchema = z.string().email('A valid email address is required');

export const fullNameSchema = z
  .string()
  .trim()
  .min(1, 'Full name is required')
  .max(128, 'Full name must be 128 characters or fewer');

export const registrationSchema = z.object({
  email: emailSchema.transform((value: string) => value.toLowerCase()),
  full_name: fullNameSchema,
});

export type RegistrationInput = z.infer<typeof registrationSchema>;

export const sourceReferenceSchema = z.object({
  title: z.string().optional(),
  url: z.string(),
  snippet: z.string().optional(),
});

export const generatedFileArtifactSchema = z
  .object({
    artifactId: z.string().optional(),
    filename: z.string(),
    filepath: z.string().optional(),
    mimeType: z.string().optional(),
    bytes: z.number().optional(),
    fileId: z.string().optional(),
    downloadUrl: z.string().optional(),
  })
  .passthrough();

export const toolUsageEventSchema = z
  .object({
    invocationId: z.string().optional(),
    timestamp: z.string().optional(),
    agentId: z.number().optional(),
    agentLabel: z.string(),
    toolName: z.string(),
    arguments: z.unknown(),
    success: z.boolean(),
    durationMs: z.number(),
    resultPreview: z.string().optional(),
    error: z.string().optional(),
    sources: z.array(sourceReferenceSchema).optional(),
    generatedFile: generatedFileArtifactSchema.optional(),
  })
  .passthrough();

export const agentStatusSchema = z
  .object({
    status: z.string(),
    agent_id: z.number().optional(),
    progress: z.number().optional(),
    result: z.string().optional(),
    reasoning: z.string().optional(),
    model: z.string().optional(),
  })
  .passthrough();

/**
 * Validates file metadata against tiered limits.
 */
export const attachmentMetadataSchema = z
  .object({
    name: z.string().min(1, 'File name is required'),
    size: z.number().min(1, 'File is empty'),
    mimeType: z.string().nullish(),
  })
  .superRefine((data, ctx) => {
    const mime = normalizeAttachmentMime(data.name, data.mimeType);
    if (mime && mime !== 'application/octet-stream' && !SUPPORTED_ATTACHMENT_MIME_TYPES.has(mime)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Unsupported attachment type "${mime}"`,
        path: ['mimeType'],
      });
      return;
    }

    let limit = MAX_DOCUMENT_SIZE_BYTES;
    let typeLabel = 'File';

    if (mime.startsWith('image/')) {
      limit = MAX_IMAGE_SIZE_BYTES;
      typeLabel = 'Image';
    } else if (mime.startsWith('video/')) {
      limit = MAX_VIDEO_SIZE_BYTES;
      typeLabel = 'Video';
    } else if (mime.startsWith('audio/')) {
      limit = MAX_AUDIO_SIZE_BYTES;
      typeLabel = 'Audio';
    }

    if (data.size > limit) {
      const limitMb = limit / (1024 * 1024);
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${typeLabel} exceeds maximum size of ${limitMb}MB`,
        path: ['size'],
      });
    }
  });

export const attachmentMetadataCollectionSchema = z
  .array(attachmentMetadataSchema)
  .max(MAX_ATTACHMENTS, `You can only attach up to ${MAX_ATTACHMENTS} files.`)
  .superRefine((attachments, ctx) => {
    const totalBytes = attachments.reduce((sum, attachment) => sum + attachment.size, 0);
    if (totalBytes > MAX_TOTAL_ATTACHMENT_SIZE_BYTES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Attachments exceed the maximum total size of ${MAX_TOTAL_ATTACHMENT_SIZE_BYTES / (1024 * 1024)}MB`,
      });
    }
  });

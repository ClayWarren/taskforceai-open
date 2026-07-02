import { z } from 'zod';

export const MAX_ATTACHMENTS = 5;

// Tiered limits (industry standard)
export const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
export const MAX_DOCUMENT_SIZE_BYTES = 20 * 1024 * 1024; // 20MB
export const MAX_AUDIO_SIZE_BYTES = 20 * 1024 * 1024; // 20MB
export const MAX_VIDEO_SIZE_BYTES = 100 * 1024 * 1024; // 100MB

export const MAX_INLINE_ATTACHMENT_BYTES = 256 * 1024; // 256KB

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
    mimeType: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    const mime = data.mimeType?.toLowerCase() || '';
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

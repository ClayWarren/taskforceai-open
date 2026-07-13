import { err, ok, type Result } from '@taskforceai/client-core/result';
import { z } from 'zod';

export const apiArtifactStatusSchema = z.enum(['PROCESSING', 'READY', 'FAILED', 'DELETED']);
export const apiArtifactTypeSchema = z.enum([
  'DOCUMENT',
  'SPREADSHEET',
  'CHART',
  'IMAGE',
  'VIDEO',
  'SITE',
  'DASHBOARD',
  'ARCHIVE',
  'OTHER',
]);
export const apiArtifactVisibilitySchema = z.enum(['PRIVATE', 'ORGANIZATION', 'PUBLIC_LINK']);

export const apiArtifactVersionSchema = z.object({
  id: z.string(),
  artifactId: z.string(),
  version: z.number(),
  fileId: z.string().optional(),
  mimeType: z.string().optional(),
  filename: z.string().optional(),
  bytes: z.number().optional(),
  renderMetadata: z.unknown().optional(),
  sourceToolName: z.string().optional(),
  sourcePrompt: z.string().optional(),
  createdByUserId: z.number().optional(),
  createdAt: z.string(),
});

export const apiArtifactSchema = z.object({
  id: z.string(),
  organizationId: z.number().optional(),
  ownerUserId: z.number(),
  conversationId: z.number().optional(),
  messageId: z.string().optional(),
  taskId: z.string().optional(),
  type: apiArtifactTypeSchema,
  title: z.string(),
  status: apiArtifactStatusSchema,
  visibility: apiArtifactVisibilitySchema,
  currentVersionId: z.string().optional(),
  currentVersion: apiArtifactVersionSchema.optional(),
  metadata: z.unknown().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const apiArtifactListSchema = z.array(apiArtifactSchema);
export const apiArtifactVersionListSchema = z.array(apiArtifactVersionSchema);
export const apiArtifactShareSchema = z.object({
  token: z.string(),
  url: z.string(),
  artifact: apiArtifactSchema,
});
export const publicArtifactMetadataSchema = z.object({
  id: z.string(),
  type: apiArtifactTypeSchema,
  title: z.string(),
  status: apiArtifactStatusSchema,
  visibility: apiArtifactVisibilitySchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export const publicArtifactVersionSchema = z.object({
  id: z.string(),
  version: z.number(),
  mimeType: z.string().optional(),
  filename: z.string().optional(),
  bytes: z.number().optional(),
  createdAt: z.string(),
});
export const publicArtifactSchema = z.object({
  artifact: publicArtifactMetadataSchema,
  version: publicArtifactVersionSchema,
});

export type ApiArtifact = z.infer<typeof apiArtifactSchema>;
export type ApiArtifactVersion = z.infer<typeof apiArtifactVersionSchema>;
export type ApiArtifactVisibility = z.infer<typeof apiArtifactVisibilitySchema>;
export type ApiArtifactShare = z.infer<typeof apiArtifactShareSchema>;
export type PublicArtifact = z.infer<typeof publicArtifactSchema>;

export function parseArtifactApiPayload<T>(
  raw: unknown,
  schema: z.ZodType<T>,
  onInvalid?: (error: z.ZodError) => void
): Result<T> {
  const parsed = schema.safeParse(raw);
  if (parsed.success) {
    return ok(parsed.data);
  }
  onInvalid?.(parsed.error);
  return err(new Error('Invalid response from server'));
}

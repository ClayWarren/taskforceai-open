export type ArtifactType =
  | 'document'
  | 'spreadsheet'
  | 'chart'
  | 'image'
  | 'video'
  | 'site'
  | 'dashboard'
  | 'archive'
  | 'other';

export type ArtifactStatus = 'processing' | 'ready' | 'failed' | 'deleted';

export type ArtifactVisibility = 'private' | 'organization' | 'public_link';

export interface ArtifactSummary {
  id: string;
  organizationId?: number;
  ownerUserId: number;
  conversationId?: number;
  messageId?: string;
  taskId?: string;
  type: ArtifactType;
  title: string;
  status: ArtifactStatus;
  visibility: ArtifactVisibility;
  currentVersionId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ArtifactVersionSummary {
  id: string;
  artifactId: string;
  version: number;
  fileId?: string;
  mimeType?: string;
  filename?: string;
  bytes?: number;
  sourceToolName?: string;
  createdByUserId?: number;
  createdAt: string;
}

export type RunTaskAttachment = {
  uri: string;
  name: string;
  type?: string;
};

type ImageAttachment = {
  data: string;
  mime_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
  name?: string;
  detail?: 'auto' | 'low' | 'high';
};

type AudioAttachment = {
  data: string;
  format: 'wav' | 'mp3';
  name?: string;
};

type VideoAttachment = {
  data: string;
  mime_type: 'video/mp4' | 'video/webm';
  name?: string;
};

type ReactNativeFilePart = {
  uri: string;
  name: string;
  type: string;
};

type ReactNativeFormData = {
  append(name: string, value: ReactNativeFilePart): void;
};

const appendReactNativeFile = (formData: FormData, field: string, file: ReactNativeFilePart) => {
  const rnFormData = formData as unknown as ReactNativeFormData;
  rnFormData.append(field, file);
};

const isUncLikeFileUri = (uri: string): boolean => {
  const trimmed = uri.trim();
  const lower = trimmed.toLowerCase();

  if (trimmed.startsWith('\\\\') || trimmed.startsWith('//')) {
    return true;
  }
  if (!lower.startsWith('file:')) {
    return false;
  }

  return !lower.startsWith('file:///') || lower.startsWith('file:////');
};

const assertSafeReactNativeFileUri = (uri: string): void => {
  if (isUncLikeFileUri(uri)) {
    throw new Error('UNC file attachment URIs are not allowed');
  }
};

export const buildRunFormData = (
  payload: {
    prompt: string;
    conversation_id?: string | null | undefined;
    modelId?: string | null | undefined;
    projectId?: number | null | undefined;
    demo?: boolean | number | undefined;
    role_models?: Record<string, string> | undefined;
    attachments?: ImageAttachment[] | undefined;
    audio_attachments?: AudioAttachment[] | undefined;
    video_attachments?: VideoAttachment[] | undefined;
    options?: Record<string, unknown> | undefined;
  },
  attachments: RunTaskAttachment[]
): FormData => {
  const formData = new FormData();
  formData.append('prompt', payload.prompt);
  if (payload.conversation_id !== undefined && payload.conversation_id !== null)
    formData.append('conversation_id', payload.conversation_id);
  if (payload.modelId) formData.append('modelId', payload.modelId);
  if (payload.projectId !== undefined && payload.projectId !== null)
    formData.append('projectId', String(payload.projectId));
  if (payload.demo !== undefined) formData.append('demo', String(payload.demo));
  if (payload.role_models !== undefined)
    formData.append('role_models', JSON.stringify(payload.role_models));
  if (payload.attachments !== undefined)
    formData.append('attachments', JSON.stringify(payload.attachments));
  if (payload.audio_attachments !== undefined)
    formData.append('audio_attachments', JSON.stringify(payload.audio_attachments));
  if (payload.video_attachments !== undefined)
    formData.append('video_attachments', JSON.stringify(payload.video_attachments));
  if (payload.options !== undefined) formData.append('options', JSON.stringify(payload.options));

  attachments.forEach((file) => {
    assertSafeReactNativeFileUri(file.uri);
    appendReactNativeFile(formData, 'files', {
      uri: file.uri,
      name: file.name,
      type: file.type ?? 'application/octet-stream',
    });
  });

  return formData;
};

import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import { useFileAttachments } from '@taskforceai/react-core';

import * as FileSystem from '../utils/file-system';
import { createModuleLogger } from '../logger';
import {
  MAX_ATTACHMENTS,
  type Attachment,
  prepareAttachment,
} from '../components/PromptInput.internal';
import { getMobileClient } from '../api/client';

const logger = createModuleLogger('usePromptAttachments');

const cleanupQueue = new Set<string>();

async function cleanupAttachmentFile(attachment: Attachment | string) {
  const uri = typeof attachment === 'string' ? attachment : attachment.uri;
  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (info.exists) {
      const isCache = uri.includes('/Caches/') || uri.includes('/cache/');
      if (isCache) {
        await FileSystem.deleteAsync(uri, { idempotent: true });
      }
      cleanupQueue.delete(uri);
    } else {
      cleanupQueue.delete(uri);
    }
  } catch (error) {
    logger.warn('Failed to cleanup attachment file, adding to deferred queue', { uri, error });
    cleanupQueue.add(uri);
    ensureCleanupQueueHandling();
  }
}

let cleanupInterval: ReturnType<typeof setInterval> | null = null;

function ensureCleanupQueueHandling() {
  if (cleanupInterval) return;
  if (typeof setInterval !== 'undefined') {
    if (cleanupInterval !== null) {
      clearInterval(cleanupInterval);
    }
    cleanupInterval = setInterval(() => {
      if (cleanupQueue.size === 0) {
        if (cleanupInterval) clearInterval(cleanupInterval);
        cleanupInterval = null;
        return;
      }
      const uris = Array.from(cleanupQueue);
      uris.forEach((uri) => void cleanupAttachmentFile(uri));
    }, 60000);
  }
}

export function usePromptAttachments() {
  const attachmentStore = useFileAttachments<Attachment>({
    getKey: (attachment) => attachment.uri,
    limitStrategy: 'truncate',
    onDuplicate: () => {
      Alert.alert('Duplicate Attachment', 'This file is already attached.');
    },
    onLimitExceeded: ({ availableSlots }) => {
      const message =
        availableSlots > 0
          ? `Only the first ${availableSlots} new attachment(s) were added.`
          : `You can attach up to ${MAX_ATTACHMENTS} files.`;
      Alert.alert('Attachment Limit Reached', message);
    },
  });
  const { addFiles, clearFiles, files: attachments, setError, setFiles } = attachmentStore;
  const attachmentsRef = useRef<Attachment[]>([]);

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  const addPreparedAttachments = useCallback(
    (results: Awaited<ReturnType<typeof prepareAttachment>>[], label: string) => {
      const successful = results
        .filter((r) => r.ok)
        .map((r) => r.value);

      const failures = results.filter((r) => !r.ok);
      if (failures.length > 0) {
        Alert.alert(
          'Attachment Errors',
          `Some ${label} could not be added:\n${failures.map((f) => `- ${f.error.message}`).join('\n')}`
        );
      }

      if (successful.length > 0) {
        addFiles(successful);
      }
    },
    [addFiles]
  );

  const pickDocuments = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        multiple: true,
        copyToCacheDirectory: true,
        type: '*/*',
      });

      if (result.canceled || !result.assets?.length) {
        return;
      }

      const results = await Promise.all(
        result.assets.map((asset) =>
          prepareAttachment({
            name: asset.name ?? 'Attachment',
            uri: asset.uri,
            size: asset.size ?? null,
            mimeType: asset.mimeType ?? null,
            kind: 'file',
          })
        )
      );

      addPreparedAttachments(results, 'files');
    } catch (error) {
      logger.error('Document picker failed', { error });
      Alert.alert('Attachment Error', 'Unable to select files right now. Please try again.');
    }
  }, [addPreparedAttachments]);

  const pickImages = useCallback(async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permission Needed', 'Please allow photo library access to attach images.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsMultipleSelection: true,
        quality: 0.8,
      });
      if (result.canceled) {
        return;
      }

      const results = await Promise.all(
        result.assets.map((asset) =>
          prepareAttachment({
            name: asset.fileName ?? `Image-${new Date().toISOString()}`,
            uri: asset.uri,
            size: asset.fileSize ?? null,
            mimeType: asset.mimeType ?? (asset.type === 'image' ? 'image/jpeg' : null),
            kind: 'image',
          })
        )
      );

      addPreparedAttachments(results, 'images');
    } catch (error) {
      logger.error('Image picker failed', { error });
      Alert.alert('Attachment Error', 'Unable to access the photo library. Please try again.');
    }
  }, [addPreparedAttachments]);

  const takePhoto = useCallback(async () => {
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permission Needed', 'Please allow camera access to take a photo.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.8,
      });
      if (result.canceled || !result.assets?.length) {
        return;
      }

      const results = await Promise.all(
        result.assets.map((asset) =>
          prepareAttachment({
            name: asset.fileName ?? `Photo-${new Date().toISOString()}.jpg`,
            uri: asset.uri,
            size: asset.fileSize ?? null,
            mimeType: asset.mimeType ?? 'image/jpeg',
            kind: 'image',
          })
        )
      );

      addPreparedAttachments(results, 'photos');
    } catch (error) {
      logger.error('Camera capture failed', { error });
      Alert.alert('Attachment Error', 'Unable to open the camera. Please try again.');
    }
  }, [addPreparedAttachments]);

  const removeAttachment = useCallback((id: string) => {
    setFiles((currentAttachments) => {
      const attachment = currentAttachments.find((candidate) => candidate.id === id);
      if (!attachment) {
        return currentAttachments;
      }
      void cleanupAttachmentFile(attachment);
      return currentAttachments.filter((candidate) => candidate.id !== id);
    });
    setError(null);
  }, [setError, setFiles]);

  const clearAttachments = useCallback(() => {
    const toCleanup = attachmentsRef.current;
    clearFiles();
    toCleanup.forEach((a) => void cleanupAttachmentFile(a));
  }, [clearFiles]);

  const uploadAttachment = useCallback(async (attachment: Attachment): Promise<string> => {
    try {
      const client = getMobileClient();
      const response = await client.tasks.uploadAttachment({
        uri: attachment.uri,
        name: attachment.name,
        type: attachment.mimeType || 'application/octet-stream',
      });
      return response.id;
    } catch (error) {
      logger.error('Failed to upload attachment', { error, name: attachment.name });
      throw error; // Re-throw so it can be handled by the caller UI (PromptInput.state.ts)
    }
  }, []);

  useEffect(() => {
    return () => {
      attachmentsRef.current.forEach((a) => void cleanupAttachmentFile(a));
      attachmentsRef.current = [];
    };
  }, []);

  return {
    attachments,
    takePhoto,
    pickDocuments,
    pickImages,
    removeAttachment,
    clearAttachments,
    uploadAttachment,
    remainingSlots: MAX_ATTACHMENTS - attachments.length,
  };
}

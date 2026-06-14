import { useEffect } from 'react';

import * as FileSystem from '../utils/file-system';
import { createModuleLogger } from '../logger';

const logger = createModuleLogger('useCacheCleanup');
const MS_IN_24_HOURS = 24 * 60 * 60 * 1000;
const PICKER_CACHE_DIRS = new Set(['DocumentPicker', 'ImagePicker']);

const isAttachmentCacheFile = (name: string): boolean =>
    name.endsWith('.jpg') ||
    name.endsWith('.jpeg') ||
    name.endsWith('.png') ||
    name.endsWith('.pdf') ||
    name.endsWith('.mp4') ||
    name.startsWith('DocumentPicker') ||
    name.startsWith('ImagePicker');

/**
 * Periodically scans the expo cache directory to remove orphaned 
 * image and document picker artifacts that weren't cleaned up due to 
 * app termination or closures.
 */
export function useCacheCleanup() {
    useEffect(() => {
        const performCleanup = async () => {
            try {
                const cacheDir = FileSystem.cacheDirectory;
                if (!cacheDir) return;

                const files = await FileSystem.readDirectoryAsync(cacheDir);
                const now = Date.now();

                let cleanedCount = 0;

                const cleanupCandidate = async (fileUri: string): Promise<void> => {
                    const info = await FileSystem.getInfoAsync(fileUri);
                    if (!info.exists || info.isDirectory) return;

                    if (info.modificationTime == null) return;

                    const modTimeMs = info.modificationTime * 1000;
                    const ageMs = now - modTimeMs;

                    if (ageMs > MS_IN_24_HOURS) {
                        await FileSystem.deleteAsync(fileUri, { idempotent: true });
                        cleanedCount++;
                    }
                };

                await Promise.allSettled(
                    files.map(async (file) => {
                        const fileUri = `${cacheDir}${file}`;
                        if (!isAttachmentCacheFile(file) && !PICKER_CACHE_DIRS.has(file)) return;

                        const info = await FileSystem.getInfoAsync(fileUri);
                        if (!info.exists) return;
                        if (info.isDirectory) {
                            if (!PICKER_CACHE_DIRS.has(file)) return;
                            const childNames = await FileSystem.readDirectoryAsync(`${fileUri}/`);
                            await Promise.allSettled(
                                childNames
                                    .filter(isAttachmentCacheFile)
                                    .map((child) => cleanupCandidate(`${fileUri}/${child}`))
                            );
                            return;
                        }

                        await cleanupCandidate(fileUri);
                    })
                );

                if (cleanedCount > 0) {
                    logger.info(`Cleaned up ${cleanedCount} orphaned attachment files from cache directory.`);
                }
            } catch (error) {
                logger.warn('Failed to perform cache cleanup routine', { error });
            }
        };

        // Run this async without blocking the app mount
        void performCleanup();
    }, []);
}

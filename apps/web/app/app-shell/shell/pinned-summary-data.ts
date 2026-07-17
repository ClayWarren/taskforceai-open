import { mergeSources } from '@taskforceai/client-core/utils/source-extraction';

import type { Message, SourceReference, ToolUsageEvent } from '../../lib/types';

export type PinnedSummaryFile = NonNullable<ToolUsageEvent['generatedFile']>;

export interface PinnedSummaryData {
  files: PinnedSummaryFile[];
  sources: SourceReference[];
}

export const pinnedSummaryFileKey = (file: PinnedSummaryFile): string =>
  file.fileId || file.downloadUrl || file.artifactId || `${file.filename}:${file.bytes ?? 0}`;

export const collectPinnedSummaryData = (messages: Message[]): PinnedSummaryData => {
  const files: PinnedSummaryFile[] = [];
  const fileKeys = new Set<string>();
  let sources: SourceReference[] = [];

  for (const message of messages) {
    const messageSources =
      message.sources && message.sources.length > 0
        ? message.sources
        : (message.toolEvents ?? []).flatMap((event) => event.sources ?? []);
    sources = mergeSources(sources, messageSources);

    for (const event of message.toolEvents ?? []) {
      const file = event.generatedFile;
      if (!file?.filename) continue;
      const key = pinnedSummaryFileKey(file);
      if (fileKeys.has(key)) continue;
      fileKeys.add(key);
      files.push(file);
    }
  }

  return { files, sources };
};

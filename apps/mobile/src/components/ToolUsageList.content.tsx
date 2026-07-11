import { Linking, Text, TouchableOpacity, View } from 'react-native';
import { safeArgsForDisplay } from '@taskforceai/presenters/tool-usage/parsers';
import {
  formatCodeLanguageLabel,
  type ToolUsageViewItem,
} from '@taskforceai/presenters/tool-usage/view-model';
import { extractDomain } from '@taskforceai/client-core/utils';
import { sanitizeHttpUrl } from '@taskforceai/client-core/utils/source-extraction';

import { mobileLogger } from '../logger';
import type { ToolUsageEvent } from '../types';
import { styles } from './ToolUsageList.styles';

const MAX_SEARCH_LINKS = 3;

const openLink = (url: string) => {
  Linking.openURL(url).catch((error) => {
    mobileLogger.warn('Failed to open URL', {
      url,
      error: error instanceof Error ? error.message : String(error),
    });
  });
};

export const SearchContent = ({
  preview,
}: {
  preview: ToolUsageViewItem['searchPreview'];
}) => {
  const chips = preview.links
    .flatMap((link) => {
      const safeUrl = sanitizeHttpUrl(link.url);
      return safeUrl ? [{ ...link, url: safeUrl }] : [];
    })
    .slice(0, MAX_SEARCH_LINKS);

  return (
    <View style={styles.section}>
      <Text style={styles.sectionText}>Search results</Text>
      {chips.length > 0 && (
        <View style={styles.chipRow}>
          {chips.map((link, index: number) => {
            const domain = extractDomain(link.url) || link.title || link.url;
            if (!domain) {
              return null;
            }
            return (
              <TouchableOpacity
                key={`${link.url}-${index}`}
                style={styles.chip}
                onPress={() => openLink(link.url)}
                activeOpacity={0.7}
              >
                <Text style={styles.chipText}>{domain}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
      {preview.totalResults && (
        <Text style={styles.sectionText}>{preview.totalResults} results</Text>
      )}
    </View>
  );
};

export const CodeContent = ({
  codeArgs,
  codePreview,
}: {
  codeArgs: ToolUsageViewItem['codeArgs'];
  codePreview: ToolUsageViewItem['codePreview'];
}) => {
  const args = codeArgs;
  const preview = codePreview;

  return (
    <View style={styles.section}>
      {args.code && (
        <>
          <Text style={styles.sectionHeading}>{formatCodeLanguageLabel(args.language)}</Text>
          <View style={styles.codeBlock}>
            <Text selectable style={styles.codeText}>
              {args.code}
            </Text>
          </View>
        </>
      )}
      {preview.output && (
        <>
          <Text style={styles.sectionHeading}>Output</Text>
          <View style={styles.logBlock}>
            <Text selectable style={styles.logText}>
              {preview.output}
            </Text>
          </View>
        </>
      )}
      {preview.errors && (
        <>
          <Text style={styles.sectionHeading}>Errors</Text>
          <View style={styles.logBlock}>
            <Text selectable style={styles.logText}>
              {preview.errors}
            </Text>
          </View>
        </>
      )}
      {preview.raw && !preview.output && !preview.errors && (
        <View style={styles.logBlock}>
          <Text selectable style={styles.logText}>
            {preview.raw}
          </Text>
        </View>
      )}
    </View>
  );
};

export const GenericContent = ({ event }: { event: ToolUsageEvent }) => {
  if (event.resultPreview) {
    return (
      <View style={styles.section}>
        <Text style={styles.sectionText}>{event.resultPreview}</Text>
      </View>
    );
  }
  const args = safeArgsForDisplay(event.arguments);
  if (args.ok) {
    return (
      <View style={styles.section}>
        <Text style={styles.sectionHeading}>Arguments</Text>
        <View style={styles.logBlock}>
          <Text selectable style={styles.logText}>
            {JSON.stringify(args.value, null, 2)}
          </Text>
        </View>
      </View>
    );
  }
  return null;
};

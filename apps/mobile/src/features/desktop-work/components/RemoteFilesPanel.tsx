import React from 'react';
import * as Clipboard from 'expo-clipboard';
import { Image, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '../../../components/Icon';
import { MarkdownView } from '../../../components/MarkdownView';
import { usePreferences } from '../../../contexts/PreferencesContext';
import { useTheme } from '../../../contexts/ThemeContext';
import { useDesktopWorkspaceFileQuery, useDesktopWorkspaceFilesQuery } from '../data/desktop-work';
import { RemoteErrorText, RemoteStatusText } from './RemoteControls';
import RemoteWebPreview from './remote-web-preview';

export function RemoteFilesSheet({
  visible,
  workspace = null,
  onVisibleChange,
}: {
  visible: boolean;
  workspace?: string | null;
  onVisibleChange: (visible: boolean) => void;
}) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={() => onVisibleChange(false)}>
      <View style={styles.sheetBackdrop}>
        <TouchableOpacity
          accessibilityLabel="Dismiss remote files"
          activeOpacity={1}
          onPress={() => onVisibleChange(false)}
          style={StyleSheet.absoluteFill}
        />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16), backgroundColor: theme.colors.background, borderColor: theme.colors.border }]}>
          <View style={[styles.grabber, { backgroundColor: theme.colors.textMuted }]} />
          <View style={styles.sheetHeader}>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close remote files" onPress={() => onVisibleChange(false)} style={[styles.closeButton, { backgroundColor: theme.colors.cardBackground }]}>
              <Icon name="X" size={20} color={theme.colors.text} />
            </TouchableOpacity>
            <Text style={{ color: theme.colors.text, fontSize: 17, fontWeight: '700' }}>Files</Text>
            <View style={{ width: 40 }} />
          </View>
          <ScrollView contentContainerStyle={styles.sheetContent} showsVerticalScrollIndicator={false}>
            <RemoteFilesPanel workspace={workspace} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// eslint-disable-next-line complexity -- File preview states intentionally coordinate independent content modes and controls.
export function RemoteFilesPanel({ workspace = null }: { workspace?: string | null }) {
  const { theme } = useTheme();
  const { remoteCodeScale, remoteWordWrap } = usePreferences();
  const [query, setQuery] = React.useState('');
  const [selectedPath, setSelectedPath] = React.useState<string | null>(null);
  const [directory, setDirectory] = React.useState('');
  const [previewMode, setPreviewMode] = React.useState<'preview' | 'source'>('preview');
  const [wrapSource, setWrapSource] = React.useState(remoteWordWrap);
  const [imageExpanded, setImageExpanded] = React.useState(false);
  const files = useDesktopWorkspaceFilesQuery(workspace, query, true);
  const selectedFile = useDesktopWorkspaceFileQuery(
    workspace,
    selectedPath,
    Boolean(selectedPath)
  );
  React.useEffect(() => {
    setPreviewMode('preview');
    setWrapSource(remoteWordWrap);
    setImageExpanded(false);
  }, [remoteWordWrap, selectedPath]);
  const entries = workspaceEntries(files.data?.files ?? [], directory, query);
  const imageExceedsPreviewLimit = Boolean(
    selectedFile.data?.truncated &&
    selectedFile.data.mimeType?.startsWith('image/') &&
    !selectedFile.data.contentBase64
  );
  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, borderRadius: 12, backgroundColor: theme.colors.cardBackground }}>
        <Icon name="Search" size={15} color={theme.colors.textMuted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search workspace files"
          placeholderTextColor={theme.colors.textMuted}
          accessibilityLabel="Search remote workspace files"
          style={{ flex: 1, color: theme.colors.text, paddingVertical: 10 }}
        />
      </View>
      {files.isLoading ? <RemoteStatusText text="Loading workspace files…" /> : null}
      {files.error instanceof Error ? <RemoteErrorText error={files.error} /> : null}
      {!workspace ? <RemoteStatusText text="Choose a project workspace to browse files." /> : null}
      {selectedPath ? (
        <View style={{ gap: 8 }}>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Back to remote workspace files" onPress={() => setSelectedPath(null)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Icon name="ChevronLeft" size={15} color={theme.colors.textMuted} />
            <Text style={{ color: theme.colors.textMuted, fontSize: 12 }}>Files</Text>
          </TouchableOpacity>
          <Text selectable style={{ color: theme.colors.text, fontWeight: '700' }}>{selectedPath}</Text>
          {selectedFile.data ? (
            <View style={styles.previewToolbar}>
              {isPreviewablePath(selectedPath) ? (
                <>
                  <PreviewButton label="Preview" selected={previewMode === 'preview'} onPress={() => setPreviewMode('preview')} />
                  <PreviewButton label="Source" selected={previewMode === 'source'} onPress={() => setPreviewMode('source')} />
                </>
              ) : null}
              {!selectedFile.data.binary && (!isPreviewablePath(selectedPath) || previewMode === 'source') ? (
                <PreviewButton label={wrapSource ? 'No wrap' : 'Wrap'} selected={wrapSource} onPress={() => setWrapSource((value) => !value)} />
              ) : null}
              {!selectedFile.data.binary ? (
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Copy remote file contents"
                  onPress={() => void Clipboard.setStringAsync(selectedFile.data!.content)}
                  style={[styles.iconButton, { borderColor: theme.colors.border }]}
                >
                  <Icon name="Copy" size={14} color={theme.colors.textMuted} />
                </TouchableOpacity>
              ) : null}
              <Text style={{ marginLeft: 'auto', color: theme.colors.textMuted, fontSize: 10 }}>
                {selectedFile.data.binary ? 'BINARY' : `${selectedFile.data.content.split('\n').length} LINES`}
              </Text>
            </View>
          ) : null}
          {selectedFile.isLoading ? <RemoteStatusText text="Loading file preview…" /> : null}
          {selectedFile.error instanceof Error ? <RemoteErrorText error={selectedFile.error} /> : null}
          {imageExceedsPreviewLimit ? (
            <RemoteStatusText text="This image is larger than the 1 MB preview limit." />
          ) : selectedFile.data?.contentBase64 && selectedFile.data.mimeType ? (
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Expand preview of ${selectedPath}`} onPress={() => setImageExpanded(true)}>
              <Image
                source={{ uri: `data:${selectedFile.data.mimeType};base64,${selectedFile.data.contentBase64}` }}
                resizeMode="contain"
                accessibilityRole="image"
                accessibilityLabel={`Preview of ${selectedPath}`}
                style={[styles.imagePreview, { backgroundColor: theme.colors.cardBackground }]}
              />
            </TouchableOpacity>
          ) : selectedFile.data?.binary ? (
            <RemoteStatusText text="This binary file type cannot be previewed." />
          ) : selectedFile.data && isMarkdownPath(selectedPath) && previewMode === 'preview' ? (
            <View style={[styles.documentPreview, { borderColor: theme.colors.border }]}>
              <MarkdownView content={selectedFile.data.content} />
            </View>
          ) : selectedFile.data && isWebPreviewPath(selectedPath) && previewMode === 'preview' ? (
            <View style={[styles.webPreview, { borderColor: theme.colors.border }]}>
              <RemoteWebPreview content={selectedFile.data.content} />
            </View>
          ) : selectedFile.data ? (
            <SourcePreview path={selectedPath} content={formatPreviewContent(selectedPath, selectedFile.data.content)} wrap={wrapSource} scale={remoteCodeScale} />
          ) : null}
          {selectedFile.data?.truncated && !imageExceedsPreviewLimit ? (
            <RemoteStatusText text="File preview truncated at 256 KB." />
          ) : null}
        </View>
      ) : (
        <View style={{ gap: 2 }}>
          {directory && !query.trim() ? (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Open parent Remote folder"
              onPress={() => setDirectory(parentDirectory(directory))}
              style={styles.fileRow}
            >
              <Icon name="ChevronLeft" size={14} color={theme.colors.textMuted} />
              <Text style={{ flex: 1, color: theme.colors.textMuted, fontSize: 12 }}>
                {directory}
              </Text>
            </TouchableOpacity>
          ) : null}
          {entries.map((entry) => (
            <TouchableOpacity
              key={`${entry.kind}:${entry.path}`}
              accessibilityRole="button"
              accessibilityLabel={`${entry.kind === 'directory' ? 'Open Remote folder' : 'Open remote file'} ${entry.path}`}
              onPress={() =>
                entry.kind === 'directory'
                  ? setDirectory(entry.path)
                  : setSelectedPath(entry.path)
              }
              style={styles.fileRow}
            >
              <Icon
                name={entry.kind === 'directory' ? 'Folder' : 'FileText'}
                size={14}
                color={entry.kind === 'directory' ? '#93c5fd' : theme.colors.textMuted}
              />
              <Text selectable style={{ flex: 1, color: theme.colors.text, fontSize: 12 }}>
                {entry.label}
              </Text>
              <Icon name="ChevronRight" size={13} color={theme.colors.textMuted} />
            </TouchableOpacity>
          ))}
        </View>
      )}
      {files.data?.truncated ? <RemoteStatusText text="Refine the search to see more files." /> : null}
      <Modal visible={imageExpanded} transparent animationType="fade" onRequestClose={() => setImageExpanded(false)}>
        <TouchableOpacity activeOpacity={1} onPress={() => setImageExpanded(false)} style={styles.imageBackdrop} accessibilityLabel="Close expanded remote image">
          {selectedFile.data?.contentBase64 && selectedFile.data.mimeType ? (
            <Image source={{ uri: `data:${selectedFile.data.mimeType};base64,${selectedFile.data.contentBase64}` }} resizeMode="contain" style={styles.expandedImage} />
          ) : null}
          <View style={styles.imageClose}><Icon name="X" size={20} color="#fff" /></View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  sheetBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.28)' },
  sheet: {
    maxHeight: '84%',
    minHeight: '56%',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: 0,
  },
  grabber: { alignSelf: 'center', width: 46, height: 5, borderRadius: 99, marginTop: 8, opacity: 0.45 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 13 },
  closeButton: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  sheetContent: { paddingHorizontal: 18, paddingBottom: 24 },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 7 },
  imagePreview: { width: '100%', height: 320, borderRadius: 14 },
  documentPreview: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, padding: 14 },
  webPreview: { minHeight: 480, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderRadius: 14 },
  previewToolbar: { minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 6 },
  previewButton: { minHeight: 30, borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, paddingHorizontal: 9, alignItems: 'center', justifyContent: 'center' },
  iconButton: { width: 32, height: 30, borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  imageBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.94)', alignItems: 'center', justifyContent: 'center' },
  expandedImage: { width: '100%', height: '88%' },
  imageClose: { position: 'absolute', top: 52, right: 20, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
});

type WorkspaceEntry = { kind: 'directory' | 'file'; label: string; path: string };

export const workspaceEntries = (
  paths: string[],
  directory: string,
  query: string
): WorkspaceEntry[] => {
  if (query.trim()) {
    return paths.map((path) => ({ kind: 'file', label: path, path }));
  }
  const prefix = directory ? `${directory}/` : '';
  const entries = new Map<string, WorkspaceEntry>();
  for (const path of paths) {
    if (!path.startsWith(prefix)) continue;
    const remainder = path.slice(prefix.length);
    const [name, ...rest] = remainder.split('/');
    if (!name) continue;
    const entryPath = prefix + name;
    entries.set(entryPath, {
      kind: rest.length > 0 ? 'directory' : 'file',
      label: name,
      path: rest.length > 0 ? entryPath : path,
    });
  }
  return [...entries.values()].toSorted((left, right) =>
    left.kind === right.kind
      ? left.label.localeCompare(right.label)
      : left.kind === 'directory'
        ? -1
        : 1
  );
};

const parentDirectory = (path: string): string => path.split('/').slice(0, -1).join('/');

const markdownExtensions = new Set(['md', 'mdx', 'markdown']);
const extensionOf = (path: string) => path.split('.').pop()?.toLowerCase() ?? '';
const isMarkdownPath = (path: string) => markdownExtensions.has(extensionOf(path));
const isWebPreviewPath = (path: string) => ['html', 'htm', 'svg'].includes(extensionOf(path));
const isPreviewablePath = (path: string) => isMarkdownPath(path) || isWebPreviewPath(path);

const formatPreviewContent = (path: string, content: string) => {
  if (!['json', 'jsonc'].includes(extensionOf(path))) return content;
  try {
    return JSON.stringify(JSON.parse(content), null, 2);
  } catch {
    return content;
  }
};

function PreviewButton({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const { theme } = useTheme();
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.previewButton, { borderColor: theme.colors.border, backgroundColor: selected ? theme.colors.cardBackground : 'transparent' }]}
    >
      <Text style={{ color: selected ? theme.colors.text : theme.colors.textMuted, fontSize: 11, fontWeight: '600' }}>{label}</Text>
    </TouchableOpacity>
  );
}

function SourcePreview({ path, content, wrap, scale }: { path: string; content: string; wrap: boolean; scale: number }) {
  return (
    <ScrollView horizontal={!wrap} style={{ borderRadius: 12, backgroundColor: '#05070a' }}>
      <View style={{ padding: 12, minWidth: wrap ? '100%' : undefined }}>
        <Text style={{ color: '#6b7280', fontFamily: 'monospace', fontSize: 10, marginBottom: 8 }}>
          {extensionOf(path).toUpperCase() || 'TEXT'}
        </Text>
        {content.split('\n').map((line, index) => (
          <View key={`${index}:${line}`} style={{ flexDirection: 'row' }}>
            <Text selectable style={{ color: '#4b5563', width: 42, fontFamily: 'monospace', fontSize: 11 * scale, lineHeight: 17 * scale }}>
              {index + 1}
            </Text>
            <Text selectable style={{ color: '#d1d5db', fontFamily: 'monospace', fontSize: 11 * scale, lineHeight: 17 * scale, flexShrink: wrap ? 1 : 0 }}>
              {sourceSegments(line).map((segment, segmentIndex) => (
                <Text key={`${segmentIndex}:${segment.text}`} style={{ color: segment.color }}>
                  {segment.text || ' '}
                </Text>
              ))}
            </Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

export const sourceSegments = (line: string): Array<{ text: string; color: string }> => {
  const commentIndex = line.search(/\/\/|#/);
  const code = commentIndex >= 0 ? line.slice(0, commentIndex) : line;
  const comment = commentIndex >= 0 ? line.slice(commentIndex) : '';
  const tokenPattern = /(['"`])(?:\\.|(?!\1).)*\1|\b(import|export|const|let|var|function|class|struct|enum|interface|type|fn|pub|async|await|return|if|else|for|while|match)\b|\b(true|false|null|undefined|None|Some)\b/g;
  const segments: Array<{ text: string; color: string }> = [];
  let cursor = 0;
  for (const match of code.matchAll(tokenPattern)) {
    const index = match.index ?? cursor;
    if (index > cursor) segments.push({ text: code.slice(cursor, index), color: '#d1d5db' });
    segments.push({
      text: match[0],
      color: match[2] ? '#c4b5fd' : match[3] ? '#93c5fd' : '#86efac',
    });
    cursor = index + match[0].length;
  }
  if (cursor < code.length) segments.push({ text: code.slice(cursor), color: '#d1d5db' });
  if (comment) segments.push({ text: comment, color: '#6b7280' });
  return segments.length ? segments : [{ text: line || ' ', color: '#d1d5db' }];
};

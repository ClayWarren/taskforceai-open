import * as Clipboard from 'expo-clipboard';
import * as Sharing from 'expo-sharing';
import React from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '../components/Icon';
import { useTheme } from '../contexts/ThemeContext';
import {
  createMobileArtifactPublicLink,
  deleteMobileArtifact,
  fetchArtifactContentBytes,
  fetchArtifactContentText,
  getArtifactFileContentUrl,
  getArtifactMetadataDownloadUrl,
  type MobileArtifact,
  type MobileArtifactVersion,
  useArtifactVersionsQuery,
  useArtifactsQuery,
} from '../hooks/api/artifacts';
import * as FileSystem from '../utils/file-system';

interface ArtifactsScreenProps {
  visible: boolean;
  onClose: () => void;
}

const artifactTypeLabels: Record<MobileArtifact['type'], string> = {
  DOCUMENT: 'Document',
  SPREADSHEET: 'Spreadsheet',
  CHART: 'Chart',
  IMAGE: 'Image',
  VIDEO: 'Video',
  SITE: 'Site',
  DASHBOARD: 'Dashboard',
  ARCHIVE: 'Archive',
  OTHER: 'Other',
};

export function ArtifactsScreen({ visible, onClose }: ArtifactsScreenProps) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const artifactsQuery = useArtifactsQuery(visible);
  const artifacts = artifactsQuery.data ?? [];
  const [busyArtifactId, setBusyArtifactId] = React.useState<string | null>(null);
  const [selectedArtifact, setSelectedArtifact] = React.useState<MobileArtifact | null>(null);

  const openArtifact = async (artifact: MobileArtifact) => {
    if (busyArtifactId) {
      return;
    }
    setBusyArtifactId(artifact.id);
    try {
      const currentVersion = artifact.currentVersion ?? null;
      const contentUrl = getArtifactFileContentUrl(currentVersion);
      if (contentUrl) {
        const result = await fetchArtifactContentBytes(contentUrl);
        if (!result.ok) {
          throw result.error;
        }
        const filename = sanitizeFilename(currentVersion?.filename ?? `${artifact.title}.txt`);
        const fileUri = `${FileSystem.documentDirectory ?? ''}${filename}`;
        await FileSystem.writeBytesAsync(fileUri, result.value);
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(fileUri);
          return;
        }
        Alert.alert('Artifact saved', fileUri);
        return;
      }

      const externalUrl = getArtifactMetadataDownloadUrl(artifact);
      if (externalUrl) {
        await Linking.openURL(externalUrl);
        return;
      }

      Alert.alert('Artifact unavailable', 'This artifact does not have downloadable content yet.');
    } catch (error) {
      Alert.alert(
        'Unable to open artifact',
        error instanceof Error ? error.message : 'Please try again.'
      );
    } finally {
      setBusyArtifactId(null);
    }
  };

  const copyPublicLink = async (artifact: MobileArtifact) => {
    if (busyArtifactId) {
      return;
    }
    setBusyArtifactId(artifact.id);
    try {
      const result = await createMobileArtifactPublicLink(artifact.id);
      if (!result.ok) {
        throw result.error;
      }
      await Clipboard.setStringAsync(result.value.url);
      Alert.alert('Public link copied', 'Anyone with the link can view this artifact.');
      await artifactsQuery.refetch();
    } catch (error) {
      Alert.alert(
        'Unable to create public link',
        error instanceof Error ? error.message : 'Please try again.'
      );
    } finally {
      setBusyArtifactId(null);
    }
  };

  const confirmDeleteArtifact = (artifact: MobileArtifact) => {
    Alert.alert('Delete artifact?', artifact.title, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void removeArtifact(artifact);
        },
      },
    ]);
  };

  const removeArtifact = async (artifact: MobileArtifact) => {
    if (busyArtifactId) {
      return;
    }
    setBusyArtifactId(artifact.id);
    try {
      const result = await deleteMobileArtifact(artifact.id);
      if (!result.ok) {
        throw result.error;
      }
      await artifactsQuery.refetch();
    } catch (error) {
      Alert.alert(
        'Unable to delete artifact',
        error instanceof Error ? error.message : 'Please try again.'
      );
    } finally {
      setBusyArtifactId(null);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <View style={[styles.header, { paddingTop: Math.max(insets.top, 16) }]}>
          <TouchableOpacity
            onPress={onClose}
            style={[styles.headerButton, { backgroundColor: theme.colors.cardBackground }]}
            accessibilityRole="button"
            accessibilityLabel="Back to chat"
          >
            <Icon name="ChevronLeft" size={20} color={theme.colors.text} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: theme.colors.text }]}>Artifacts</Text>
          <TouchableOpacity
            onPress={() => void artifactsQuery.refetch()}
            style={[styles.headerButton, { backgroundColor: theme.colors.cardBackground }]}
            accessibilityRole="button"
            accessibilityLabel="Refresh artifacts"
          >
            <Icon name="RefreshCw" size={18} color={theme.colors.text} />
          </TouchableOpacity>
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingTop: 8,
            paddingBottom: Math.max(insets.bottom, 28),
          }}
          refreshControl={
            <RefreshControl refreshing={artifactsQuery.isFetching} onRefresh={() => void artifactsQuery.refetch()} />
          }
        >
          {artifactsQuery.isLoading ? (
            <StatusBlock theme={theme} text="Loading artifacts..." loading />
          ) : artifactsQuery.isError ? (
            <StatusBlock
              theme={theme}
              text={artifactsQuery.error instanceof Error ? artifactsQuery.error.message : 'Failed to load artifacts.'}
            />
          ) : artifacts.length === 0 ? (
            <StatusBlock theme={theme} text="No artifacts yet." />
          ) : (
            <View style={styles.list}>
              {artifacts.map((artifact) => (
                <ArtifactRow
                  key={artifact.id}
                  artifact={artifact}
                  busy={busyArtifactId === artifact.id}
                  onSelect={() => setSelectedArtifact(artifact)}
                  onOpen={() => void openArtifact(artifact)}
                  onCopyPublicLink={() => void copyPublicLink(artifact)}
                  onDelete={() => confirmDeleteArtifact(artifact)}
                />
              ))}
            </View>
          )}
        </ScrollView>
        <ArtifactDetailModal
          artifact={selectedArtifact}
          busy={selectedArtifact ? busyArtifactId === selectedArtifact.id : false}
          onClose={() => setSelectedArtifact(null)}
          onOpen={(artifact) => void openArtifact(artifact)}
          onCopyPublicLink={(artifact) => void copyPublicLink(artifact)}
          onDelete={confirmDeleteArtifact}
        />
      </SafeAreaView>
    </Modal>
  );
}

function ArtifactRow({
  artifact,
  busy,
  onSelect,
  onOpen,
  onCopyPublicLink,
  onDelete,
}: {
  artifact: MobileArtifact;
  busy: boolean;
  onSelect: () => void;
  onOpen: () => void;
  onCopyPublicLink: () => void;
  onDelete: () => void;
}) {
  const { theme } = useTheme();
  const currentVersion = artifact.currentVersion ?? null;
  return (
    <View style={[styles.artifactRow, { backgroundColor: theme.colors.cardBackground }]}>
      <TouchableOpacity
        onPress={onSelect}
        activeOpacity={0.72}
        style={styles.artifactOpenTarget}
        accessibilityRole="button"
        accessibilityLabel={`View artifact ${artifact.title}`}
      >
        <View style={styles.artifactIcon}>
          <Icon name="FileText" size={18} color="#f8fafc" />
        </View>
        <View style={styles.artifactBody}>
          <Text style={[styles.artifactTitle, { color: theme.colors.text }]} numberOfLines={1}>
            {artifact.title}
          </Text>
          <Text style={styles.artifactMeta} numberOfLines={1}>
            {artifactTypeLabels[artifact.type]} - {artifact.status} -{' '}
            {formatArtifactBytes(currentVersion?.bytes)}
          </Text>
        </View>
      </TouchableOpacity>
      <View style={styles.artifactActions}>
        <TouchableOpacity
          onPress={onOpen}
          disabled={busy}
          style={styles.iconButton}
          accessibilityRole="button"
          accessibilityLabel={`Download artifact ${artifact.title}`}
        >
          <Icon name="Download" size={17} color="#f8fafc" />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onCopyPublicLink}
          disabled={busy}
          style={styles.iconButton}
          accessibilityRole="button"
          accessibilityLabel={`Copy public link for ${artifact.title}`}
        >
          <Icon name="Share" size={17} color="#f8fafc" />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onDelete}
          disabled={busy}
          style={styles.iconButton}
          accessibilityRole="button"
          accessibilityLabel={`Delete artifact ${artifact.title}`}
        >
          <Icon name="Trash2" size={17} color="#f8fafc" />
        </TouchableOpacity>
      </View>
      {busy ? <ActivityIndicator color="#f8fafc" size="small" /> : null}
    </View>
  );
}

type PreviewState =
  | { status: 'idle' | 'loading' }
  | { status: 'image'; uri: string }
  | { status: 'text'; content: string }
  | { status: 'unavailable'; message: string };

function ArtifactDetailModal({
  artifact,
  busy,
  onClose,
  onOpen,
  onCopyPublicLink,
  onDelete,
}: {
  artifact: MobileArtifact | null;
  busy: boolean;
  onClose: () => void;
  onOpen: (artifact: MobileArtifact) => void;
  onCopyPublicLink: (artifact: MobileArtifact) => void;
  onDelete: (artifact: MobileArtifact) => void;
}) {
  const { theme } = useTheme();
  const [preview, setPreview] = React.useState<PreviewState>({ status: 'idle' });
  const versionsQuery = useArtifactVersionsQuery(artifact?.id ?? null, Boolean(artifact));

  React.useEffect(() => {
    let active = true;
    if (!artifact) {
      setPreview({ status: 'idle' });
      return;
    }

    const currentVersion = artifact.currentVersion ?? null;
    const contentUrl = getArtifactFileContentUrl(currentVersion);
    const mimeType = currentVersion?.mimeType ?? '';
    if (!contentUrl) {
      setPreview({ status: 'unavailable', message: 'No preview content available.' });
      return;
    }

    setPreview({ status: 'loading' });
    void (async () => {
      try {
        if (mimeType.startsWith('image/')) {
          const result = await fetchArtifactContentBytes(contentUrl);
          if (!result.ok) {
            throw result.error;
          }
          const filename = sanitizeFilename(
            currentVersion?.filename ?? `${artifact.id}.${mimeType.split('/')[1] ?? 'img'}`
          );
          const uri = `${FileSystem.cacheDirectory ?? FileSystem.documentDirectory ?? ''}artifact-preview-${filename}`;
          await FileSystem.writeBytesAsync(uri, result.value);
          if (active) {
            setPreview({ status: 'image', uri });
          }
          return;
        }

        if (mimeType.startsWith('text/') || mimeType === 'application/json') {
          const result = await fetchArtifactContentText(contentUrl);
          if (!result.ok) {
            throw result.error;
          }
          if (active) {
            setPreview({ status: 'text', content: truncatePreview(result.value) });
          }
          return;
        }

        if (active) {
          setPreview({ status: 'unavailable', message: 'Preview unavailable for this file type.' });
        }
      } catch (error) {
        if (active) {
          setPreview({
            status: 'unavailable',
            message: error instanceof Error ? error.message : 'Preview unavailable.',
          });
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [artifact]);

  if (!artifact) {
    return null;
  }

  const currentVersion = artifact.currentVersion ?? null;

  return (
    <Modal visible={true} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <View style={styles.detailHeader}>
          <TouchableOpacity
            onPress={onClose}
            style={[styles.headerButton, { backgroundColor: theme.colors.cardBackground }]}
            accessibilityRole="button"
            accessibilityLabel="Close artifact details"
          >
            <Icon name="X" size={18} color={theme.colors.text} />
          </TouchableOpacity>
          <Text style={[styles.detailTitle, { color: theme.colors.text }]} numberOfLines={1}>
            {artifact.title}
          </Text>
          <View style={styles.headerButton} />
        </View>

        <ScrollView contentContainerStyle={styles.detailContent}>
          <View style={[styles.previewPanel, { backgroundColor: theme.colors.cardBackground }]}>
            <ArtifactPreview preview={preview} />
          </View>

          <View style={[styles.detailPanel, { backgroundColor: theme.colors.cardBackground }]}>
            <MetadataRow label="Type" value={artifactTypeLabels[artifact.type]} />
            <MetadataRow label="Status" value={artifact.status} />
            <MetadataRow label="Visibility" value={artifact.visibility} />
            <MetadataRow label="Filename" value={currentVersion?.filename ?? 'Unavailable'} />
            <MetadataRow label="Size" value={formatArtifactBytes(currentVersion?.bytes)} />
            <MetadataRow label="Updated" value={formatArtifactDate(artifact.updatedAt)} />
          </View>

          <VersionHistoryPanel
            currentVersionId={artifact.currentVersionId ?? currentVersion?.id ?? null}
            error={versionsQuery.error}
            isFetching={versionsQuery.isFetching}
            versions={versionsQuery.data ?? []}
          />

          <View style={styles.detailActions}>
            <TouchableOpacity
              onPress={() => onOpen(artifact)}
              disabled={busy}
              style={[styles.detailActionButton, { backgroundColor: theme.colors.cardBackground }]}
              accessibilityRole="button"
              accessibilityLabel={`Download artifact ${artifact.title}`}
            >
              <Icon name="Download" size={18} color="#f8fafc" />
              <Text style={styles.detailActionText}>Download</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => onCopyPublicLink(artifact)}
              disabled={busy}
              style={[styles.detailActionButton, { backgroundColor: theme.colors.cardBackground }]}
              accessibilityRole="button"
              accessibilityLabel={`Copy public link for ${artifact.title}`}
            >
              <Icon name="Share" size={18} color="#f8fafc" />
              <Text style={styles.detailActionText}>Copy link</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => onDelete(artifact)}
              disabled={busy}
              style={[styles.detailActionButton, { backgroundColor: theme.colors.cardBackground }]}
              accessibilityRole="button"
              accessibilityLabel={`Delete artifact ${artifact.title}`}
            >
              <Icon name="Trash2" size={18} color="#f8fafc" />
              <Text style={styles.detailActionText}>Delete</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function ArtifactPreview({ preview }: { preview: PreviewState }) {
  if (preview.status === 'loading') {
    return (
      <View style={styles.previewStatus}>
        <ActivityIndicator color="#f8fafc" size="small" />
        <Text style={styles.previewStatusText}>Loading preview...</Text>
      </View>
    );
  }
  if (preview.status === 'image') {
    return <Image source={{ uri: preview.uri }} style={styles.imagePreview} resizeMode="contain" />;
  }
  if (preview.status === 'text') {
    return (
      <ScrollView style={styles.textPreview}>
        <Text style={styles.textPreviewContent}>{preview.content}</Text>
      </ScrollView>
    );
  }
  const message =
    preview.status === 'unavailable' ? preview.message : 'Select an artifact to preview it.';
  return (
    <View style={styles.previewStatus}>
      <Icon name="FileText" size={24} color="#f8fafc" />
      <Text style={styles.previewStatusText}>{message}</Text>
    </View>
  );
}

function VersionHistoryPanel({
  currentVersionId,
  error,
  isFetching,
  versions,
}: {
  currentVersionId: string | null;
  error: unknown;
  isFetching: boolean;
  versions: MobileArtifactVersion[];
}) {
  const { theme } = useTheme();
  return (
    <View style={[styles.detailPanel, { backgroundColor: theme.colors.cardBackground }]}>
      <View style={styles.versionHeader}>
        <Text style={styles.versionTitle}>Versions</Text>
        {isFetching ? <ActivityIndicator color="#f8fafc" size="small" /> : null}
      </View>
      {error ? (
        <Text style={styles.previewStatusText}>
          {error instanceof Error ? error.message : 'Failed to load versions.'}
        </Text>
      ) : versions.length === 0 ? (
        <Text style={styles.previewStatusText}>No versions</Text>
      ) : (
        versions.map((version) => (
          <View key={version.id} style={styles.versionRow}>
            <Text style={styles.versionLabel}>
              Version {version.version}
              {version.id === currentVersionId ? ' - Current' : ''}
            </Text>
            <Text style={styles.versionMeta}>
              {[version.filename, formatArtifactBytes(version.bytes), formatArtifactDate(version.createdAt)]
                .filter(Boolean)
                .join(' - ')}
            </Text>
          </View>
        ))
      )}
    </View>
  );
}

function MetadataRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metadataRow}>
      <Text style={styles.metadataLabel}>{label}</Text>
      <Text style={styles.metadataValue} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

function StatusBlock({
  theme,
  text,
  loading = false,
}: {
  theme: ReturnType<typeof useTheme>['theme'];
  text: string;
  loading?: boolean;
}) {
  return (
    <View style={[styles.statusBlock, { backgroundColor: theme.colors.cardBackground }]}>
      {loading ? <ActivityIndicator color="#f8fafc" size="small" /> : null}
      <Text style={[styles.statusText, { color: theme.colors.text }]}>{text}</Text>
    </View>
  );
}

function formatArtifactBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) {
    return 'Unknown size';
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    const value = bytes / 1024;
    return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} KB`;
  }
  const value = bytes / (1024 * 1024);
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} MB`;
}

function sanitizeFilename(value: string): string {
  const cleaned = value.trim().replace(/[/\\?%*:|"<>]/g, '-');
  return cleaned || 'artifact.txt';
}

function truncatePreview(value: string): string {
  return value.length > 4_000 ? `${value.slice(0, 4_000)}\n...` : value;
}

function formatArtifactDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

const styles = StyleSheet.create({
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 14,
    paddingHorizontal: 16,
  },
  headerButton: {
    alignItems: 'center',
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
  },
  list: {
    gap: 10,
  },
  artifactRow: {
    alignItems: 'center',
    borderRadius: 12,
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  artifactOpenTarget: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: 12,
    minWidth: 0,
  },
  artifactIcon: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderRadius: 16,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  artifactBody: {
    flex: 1,
    minWidth: 0,
  },
  artifactTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  artifactMeta: {
    color: 'rgba(248,250,252,0.58)',
    fontSize: 12,
    marginTop: 3,
  },
  artifactActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  iconButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 15,
    height: 30,
    justifyContent: 'center',
    width: 30,
  },
  statusBlock: {
    alignItems: 'center',
    borderRadius: 12,
    gap: 10,
    marginTop: 24,
    padding: 18,
  },
  statusText: {
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  detailHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  detailTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  detailContent: {
    gap: 12,
    padding: 16,
    paddingBottom: 28,
  },
  previewPanel: {
    borderRadius: 12,
    minHeight: 220,
    overflow: 'hidden',
  },
  previewStatus: {
    alignItems: 'center',
    flex: 1,
    gap: 10,
    justifyContent: 'center',
    minHeight: 220,
    padding: 18,
  },
  previewStatusText: {
    color: 'rgba(248,250,252,0.72)',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  imagePreview: {
    height: 260,
    width: '100%',
  },
  textPreview: {
    maxHeight: 260,
    padding: 14,
  },
  textPreviewContent: {
    color: '#f8fafc',
    fontFamily: 'Courier',
    fontSize: 12,
    lineHeight: 18,
  },
  detailPanel: {
    borderRadius: 12,
    padding: 14,
  },
  versionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  versionTitle: {
    color: '#f8fafc',
    fontSize: 15,
    fontWeight: '700',
  },
  versionRow: {
    borderTopColor: 'rgba(255,255,255,0.08)',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: 9,
  },
  versionLabel: {
    color: '#f8fafc',
    fontSize: 13,
    fontWeight: '700',
  },
  versionMeta: {
    color: 'rgba(248,250,252,0.58)',
    fontSize: 12,
    marginTop: 3,
  },
  metadataRow: {
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  metadataLabel: {
    color: 'rgba(248,250,252,0.55)',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  metadataValue: {
    color: '#f8fafc',
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'right',
  },
  detailActions: {
    flexDirection: 'row',
    gap: 8,
  },
  detailActionButton: {
    alignItems: 'center',
    borderRadius: 12,
    flex: 1,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 10,
  },
  detailActionText: {
    color: '#f8fafc',
    fontSize: 13,
    fontWeight: '700',
  },
});

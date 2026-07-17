import React from 'react';
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '../../../components/Icon';
import { useTheme } from '../../../contexts/ThemeContext';
import {
  useCloneDesktopProjectMutation,
  useCreateDesktopProjectMutation,
  useDesktopWorkspaceFilesQuery,
  useDesktopGitHubRepositoriesQuery,
  type DesktopProject,
} from '../data/desktop-work';
import { RemoteErrorText } from './RemoteControls';

// eslint-disable-next-line complexity -- Project creation coordinates independent workspace, repository, and validation states.
export function RemoteProjectSheet({
  visible,
  onClose,
  onCreated,
}: {
  visible: boolean;
  onClose: () => void;
  onCreated: (project: DesktopProject) => void;
}) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const [mode, setMode] = React.useState<'folder' | 'clone'>('folder');
  const [name, setName] = React.useState('');
  const [workspace, setWorkspace] = React.useState('~/Developer/');
  const [remoteUrl, setRemoteUrl] = React.useState('');
  const [folderBrowserVisible, setFolderBrowserVisible] = React.useState(false);
  const [githubBrowserVisible, setGithubBrowserVisible] = React.useState(false);
  const [githubSearch, setGithubSearch] = React.useState('');
  const browser = useDesktopWorkspaceFilesQuery(workspace, '', visible && folderBrowserVisible);
  const github = useDesktopGitHubRepositoriesQuery(
    githubSearch,
    visible && mode === 'clone' && githubBrowserVisible
  );
  const createProject = useCreateDesktopProjectMutation();
  const cloneProject = useCloneDesktopProjectMutation();
  const pending = createProject.isPending || cloneProject.isPending;
  const error = createProject.error ?? cloneProject.error;
  const canSubmit =
    Boolean(name.trim()) &&
    Boolean(workspace.trim()) &&
    (mode === 'folder' || Boolean(remoteUrl.trim())) &&
    !pending;

  const submit = () => {
    if (!canSubmit) return;
    const options = {
      onSuccess: (result: { project: DesktopProject }) => {
        onCreated(result.project);
        onClose();
      },
    };
    if (mode === 'folder') {
      createProject.mutate({ name, workspace }, options);
    } else {
      cloneProject.mutate({ name, remoteUrl, destination: workspace }, options);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <TouchableOpacity
          accessibilityLabel="Dismiss Remote project creation"
          activeOpacity={1}
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <View
          style={[
            styles.sheet,
            {
              paddingBottom: Math.max(insets.bottom, 18),
              backgroundColor: theme.colors.background,
              borderColor: theme.colors.border,
            },
          ]}
        >
          <View style={[styles.grabber, { backgroundColor: theme.colors.textMuted }]} />
          <View style={styles.header}>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Close Remote project creation"
              onPress={onClose}
              style={[styles.closeButton, { backgroundColor: theme.colors.cardBackground }]}
            >
              <Icon name="X" size={20} color={theme.colors.text} />
            </TouchableOpacity>
            <Text style={{ color: theme.colors.text, fontSize: 17, fontWeight: '700' }}>
              Add project
            </Text>
            <View style={{ width: 40 }} />
          </View>
          <ScrollView
            contentContainerStyle={{ gap: 14, paddingHorizontal: 18, paddingBottom: 18 }}
            keyboardShouldPersistTaps="handled"
          >
            <View style={[styles.segment, { backgroundColor: theme.colors.cardBackground }]}>
              <ModeButton
                label="Existing folder"
                selected={mode === 'folder'}
                onPress={() => setMode('folder')}
              />
              <ModeButton
                label="Clone repository"
                selected={mode === 'clone'}
                onPress={() => setMode('clone')}
              />
            </View>
            <Field
              label="Project name"
              value={name}
              placeholder="My project"
              onChangeText={setName}
            />
            {mode === 'clone' ? (
              <View style={{ gap: 8 }}>
                <TouchableOpacity accessibilityRole="button" accessibilityLabel="Browse GitHub repositories" onPress={() => setGithubBrowserVisible((value) => !value)} style={[styles.browserToggle, { borderColor: theme.colors.border }]}>
                  <Icon name="GitPullRequest" size={16} color={theme.colors.text} />
                  <Text style={{ color: theme.colors.text, fontWeight: '600' }}>{githubBrowserVisible ? 'Hide GitHub repositories' : 'Browse GitHub repositories'}</Text>
                </TouchableOpacity>
                {githubBrowserVisible ? (
                  <View style={[styles.browser, { borderColor: theme.colors.border }]}>
                    <Field label="Search GitHub" value={githubSearch} placeholder="Repository name" autoCapitalize="none" onChangeText={setGithubSearch} />
                    {github.isLoading ? <ActivityIndicator color={theme.colors.text} /> : null}
                    {github.error instanceof Error ? <RemoteErrorText error={github.error} /> : null}
                    {github.data?.repositories.map((repository) => (
                      <TouchableOpacity key={repository.url} accessibilityRole="button" accessibilityLabel={`Clone GitHub repository ${repository.nameWithOwner}`} onPress={() => {
                        const repositoryName = repository.nameWithOwner.split('/').at(-1) ?? repository.nameWithOwner;
                        setRemoteUrl(repository.url);
                        setName(repositoryName);
                        setWorkspace((current) => remoteJoinPath(current, repositoryName));
                      }} style={styles.repositoryRow}>
                        <View style={{ flex: 1, gap: 2 }}>
                          <Text selectable style={{ color: theme.colors.text, fontWeight: '600' }}>{repository.nameWithOwner}</Text>
                          {repository.description ? <Text numberOfLines={2} style={{ color: theme.colors.textMuted, fontSize: 11 }}>{repository.description}</Text> : null}
                        </View>
                        {repository.isPrivate ? <Text style={{ color: theme.colors.textMuted, fontSize: 10 }}>PRIVATE</Text> : null}
                      </TouchableOpacity>
                    ))}
                  </View>
                ) : null}
                <Field
                  label="Git URL"
                  value={remoteUrl}
                  placeholder="https://github.com/org/repo.git"
                  autoCapitalize="none"
                  keyboardType="url"
                  onChangeText={setRemoteUrl}
                />
              </View>
            ) : null}
            <Field
              label={mode === 'clone' ? 'Clone destination on Mac' : 'Folder on Mac'}
              value={workspace}
              placeholder="~/Developer/project"
              autoCapitalize="none"
              onChangeText={setWorkspace}
            />
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Browse folders on Remote Mac" onPress={() => setFolderBrowserVisible((value) => !value)} style={[styles.browserToggle, { borderColor: theme.colors.border }]}>
              <Icon name="Folder" size={16} color={theme.colors.text} />
              <Text style={{ color: theme.colors.text, fontWeight: '600' }}>{folderBrowserVisible ? 'Hide folders' : 'Browse folders on Mac'}</Text>
            </TouchableOpacity>
            {folderBrowserVisible ? (
              <RemoteFolderBrowser
                path={workspace}
                files={browser.data?.files ?? []}
                loading={browser.isLoading}
                error={browser.error}
                onPathChange={(path) => {
                  setWorkspace(path);
                  if (!name.trim()) setName(remotePathName(path));
                }}
              />
            ) : null}
            <Text style={{ color: theme.colors.textMuted, fontSize: 12, lineHeight: 17 }}>
              The path is resolved and accessed on the selected Remote Mac.
            </Text>
            {error instanceof Error ? <RemoteErrorText error={error} /> : null}
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={mode === 'clone' ? 'Clone Remote project' : 'Add Remote project'}
              accessibilityState={{ disabled: !canSubmit }}
              disabled={!canSubmit}
              onPress={submit}
              style={[
                styles.submit,
                { backgroundColor: canSubmit ? theme.colors.primary : theme.colors.border },
              ]}
            >
              {pending ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <Text style={{ color: '#ffffff', fontWeight: '700' }}>
                  {mode === 'clone' ? 'Clone and add' : 'Add project'}
                </Text>
              )}
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function RemoteFolderBrowser({ path, files, loading, error, onPathChange }: { path: string; files: string[]; loading: boolean; error: unknown; onPathChange: (path: string) => void }) {
  const { theme } = useTheme();
  const folders = React.useMemo(() => [...new Set(files.flatMap((file) => {
    const [first, ...rest] = file.split('/');
    return first && rest.length > 0 ? [first] : [];
  }))].toSorted(), [files]);
  return (
    <View style={[styles.browser, { borderColor: theme.colors.border }]}>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Browse parent folder on Remote Mac" onPress={() => onPathChange(remoteParentPath(path))} style={styles.folderRow}>
        <Icon name="ChevronLeft" size={15} color={theme.colors.textMuted} />
        <Text selectable style={{ flex: 1, color: theme.colors.textMuted }} numberOfLines={1}>{path}</Text>
      </TouchableOpacity>
      {loading ? <ActivityIndicator color={theme.colors.text} /> : null}
      {error instanceof Error ? <RemoteErrorText error={error} /> : null}
      {folders.map((folder) => (
        <TouchableOpacity key={folder} accessibilityRole="button" accessibilityLabel={`Open Remote folder ${folder}`} onPress={() => onPathChange(remoteJoinPath(path, folder))} style={styles.folderRow}>
          <Icon name="Folder" size={15} color="#93c5fd" />
          <Text selectable style={{ flex: 1, color: theme.colors.text }}>{folder}</Text>
          <Icon name="ChevronRight" size={14} color={theme.colors.textMuted} />
        </TouchableOpacity>
      ))}
      {!loading && !error && folders.length === 0 ? <Text style={{ color: theme.colors.textMuted, fontSize: 12 }}>No child folders found.</Text> : null}
    </View>
  );
}

const remoteJoinPath = (base: string, child: string) => `${base.replace(/\/$/, '')}/${child}`;
const remoteParentPath = (path: string) => {
  const normalized = path.replace(/\/$/, '');
  const index = normalized.lastIndexOf('/');
  if (index <= 0) return normalized.startsWith('~') ? '~/' : '/';
  return normalized.slice(0, index);
};
const remotePathName = (path: string) => path.replace(/\/$/, '').split('/').at(-1) ?? '';

function ModeButton({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const { theme } = useTheme();
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[
        styles.modeButton,
        selected ? { backgroundColor: theme.colors.background } : null,
      ]}
    >
      <Text style={{ color: selected ? theme.colors.text : theme.colors.textMuted, fontWeight: '600' }}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function Field({ label, ...props }: React.ComponentProps<typeof TextInput> & { label: string }) {
  const { theme } = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: theme.colors.textMuted, fontSize: 12, fontWeight: '600' }}>{label}</Text>
      <TextInput
        {...props}
        placeholderTextColor={theme.colors.textMuted}
        style={[
          styles.input,
          {
            color: theme.colors.text,
            backgroundColor: theme.colors.cardBackground,
            borderColor: theme.colors.border,
          },
          props.style,
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.28)' },
  sheet: {
    maxHeight: '86%',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: 0,
  },
  grabber: { alignSelf: 'center', width: 46, height: 5, borderRadius: 99, marginTop: 8, opacity: 0.45 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 13 },
  closeButton: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  segment: { flexDirection: 'row', borderRadius: 12, padding: 3 },
  modeButton: { flex: 1, alignItems: 'center', borderRadius: 10, paddingVertical: 9 },
  input: { minHeight: 46, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  submit: { minHeight: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  browserToggle: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12 },
  browser: { gap: 6, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 10 },
  folderRow: { minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 8 },
  repositoryRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
});

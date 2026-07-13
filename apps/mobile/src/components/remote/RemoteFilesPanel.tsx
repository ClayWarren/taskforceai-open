import React from 'react';
import { ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { useTheme } from '../../contexts/ThemeContext';
import { useDesktopWorkspaceFileQuery, useDesktopWorkspaceFilesQuery } from '../../hooks/api/desktopWork';
import { Icon } from '../Icon';
import { RemoteErrorText, RemoteStatusText } from './RemoteControls';

export function RemoteFilesPanel() {
  const { theme } = useTheme();
  const [query, setQuery] = React.useState('');
  const [selectedPath, setSelectedPath] = React.useState<string | null>(null);
  const files = useDesktopWorkspaceFilesQuery(query, true);
  const selectedFile = useDesktopWorkspaceFileQuery(selectedPath, Boolean(selectedPath));
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
      {selectedPath ? (
        <View style={{ gap: 8 }}>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Back to remote workspace files" onPress={() => setSelectedPath(null)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Icon name="ChevronLeft" size={15} color={theme.colors.textMuted} />
            <Text style={{ color: theme.colors.textMuted, fontSize: 12 }}>Files</Text>
          </TouchableOpacity>
          <Text selectable style={{ color: theme.colors.text, fontWeight: '700' }}>{selectedPath}</Text>
          {selectedFile.isLoading ? <RemoteStatusText text="Loading file preview…" /> : null}
          {selectedFile.error instanceof Error ? <RemoteErrorText error={selectedFile.error} /> : null}
          {selectedFile.data?.binary ? <RemoteStatusText text="Binary files cannot be previewed." /> : null}
          {selectedFile.data && !selectedFile.data.binary ? (
            <ScrollView horizontal style={{ borderRadius: 12, backgroundColor: '#05070a' }}>
              <Text selectable style={{ color: '#d1d5db', padding: 12, fontFamily: 'monospace', fontSize: 11, lineHeight: 17 }}>
                {selectedFile.data.content}
              </Text>
            </ScrollView>
          ) : null}
          {selectedFile.data?.truncated ? <RemoteStatusText text="File preview truncated at 256 KB." /> : null}
        </View>
      ) : files.data?.files.map((path) => (
        <TouchableOpacity key={path} accessibilityRole="button" accessibilityLabel={`Open remote file ${path}`} onPress={() => setSelectedPath(path)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5 }}>
          <Icon name="FileText" size={14} color={theme.colors.textMuted} />
          <Text selectable style={{ flex: 1, color: theme.colors.text, fontSize: 12 }}>{path}</Text>
          <Icon name="ChevronRight" size={13} color={theme.colors.textMuted} />
        </TouchableOpacity>
      ))}
      {files.data?.truncated ? <RemoteStatusText text="Refine the search to see more files." /> : null}
    </View>
  );
}

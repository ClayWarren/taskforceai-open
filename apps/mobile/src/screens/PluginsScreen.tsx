import React from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import {
  pluginCatalog,
  type PluginCatalogEntry,
} from "@taskforceai/client-core/mcp/catalog";

import { Icon, type IconName } from "../components/Icon";
import { useTheme } from "../contexts/ThemeContext";
import { parseMobileMcpEndpoint } from "../mcp/client";
import type { MobileMcpServerConfig } from "../mcp/manager";
import {
  loadStoredMobileMcpServers,
  persistMobileMcpServers,
  subscribeMobileMcpServers,
} from "../mcp/store";

type FeaturedPlugin = PluginCatalogEntry & { icon: IconName };

const mobilePluginIcons: Record<string, IconName> = {
  box: "Archive",
  calendar: "Clock3",
  chart: "ChartNoAxesColumnIncreasing",
  "circle-dot": "Activity",
  cloud: "Cloud",
  github: "GitPullRequest",
  handshake: "Handshake",
  landmark: "Landmark",
  notebook: "FileText",
  "trending-up": "TrendingUp",
};

const featuredPlugins: FeaturedPlugin[] = pluginCatalog.map((plugin) => ({
  id: plugin.id,
  name: plugin.name,
  description: plugin.description,
  category: plugin.category,
  icon: mobilePluginIcons[plugin.icon] ?? "Cpu",
  tint: plugin.tint,
}));

interface PluginsScreenProps {
  visible: boolean;
  onClose: () => void;
}

export function PluginsScreen({ visible, onClose }: PluginsScreenProps) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const [installed, setInstalled] = React.useState<MobileMcpServerConfig[]>([]);
  const [query, setQuery] = React.useState("");
  const [editorVisible, setEditorVisible] = React.useState(false);
  const [draftName, setDraftName] = React.useState("");
  const [draftEndpoint, setDraftEndpoint] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  const refresh = React.useCallback(async () => {
    setInstalled(await loadStoredMobileMcpServers());
  }, []);

  React.useEffect(() => {
    if (!visible) return;
    void refresh();
    return subscribeMobileMcpServers(() => void refresh());
  }, [refresh, visible]);

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleInstalled = installed.filter((plugin) =>
    `${plugin.name} ${plugin.endpoint}`
      .toLocaleLowerCase()
      .includes(normalizedQuery),
  );
  const visibleFeatured = featuredPlugins.filter((plugin) =>
    `${plugin.name} ${plugin.description}`
      .toLocaleLowerCase()
      .includes(normalizedQuery),
  );

  const openEditor = (plugin?: FeaturedPlugin) => {
    setDraftName(plugin?.name ?? "");
    setDraftEndpoint("");
    setEditorVisible(true);
  };

  const savePlugin = async () => {
    const name = draftName.trim();
    const endpoint = draftEndpoint.trim();
    if (!name || !endpoint || saving) return;
    try {
      parseMobileMcpEndpoint(endpoint);
      setSaving(true);
      const next = [
        ...installed.filter(
          (plugin) =>
            plugin.name.toLocaleLowerCase() !== name.toLocaleLowerCase(),
        ),
        { name, endpoint, enabled: true },
      ];
      await persistMobileMcpServers(next);
      setEditorVisible(false);
      setDraftName("");
      setDraftEndpoint("");
    } catch (error) {
      Alert.alert(
        "Unable to add plugin",
        error instanceof Error
          ? error.message
          : "Enter a public HTTPS MCP endpoint.",
      );
    } finally {
      setSaving(false);
    }
  };

  const togglePlugin = async (plugin: MobileMcpServerConfig) => {
    await persistMobileMcpServers(
      installed.map((item) =>
        item.name === plugin.name ? { ...item, enabled: !item.enabled } : item,
      ),
    );
  };

  const removePlugin = (plugin: MobileMcpServerConfig) => {
    Alert.alert("Remove plugin?", plugin.name, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () =>
          void persistMobileMcpServers(
            installed.filter((item) => item.name !== plugin.name),
          ),
      },
    ]);
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <SafeAreaView
        edges={["bottom"]}
        style={[styles.safeArea, { backgroundColor: theme.colors.background }]}
      >
        <View
          style={[styles.header, { paddingTop: Math.max(insets.top, 16) }]}
        >
          <TouchableOpacity
            onPress={onClose}
            style={[styles.headerButton, { borderColor: theme.colors.border }]}
            accessibilityRole="button"
            accessibilityLabel="Back to chat"
          >
            <Icon name="Menu" size={23} color={theme.colors.text} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: theme.colors.text }]}>
            Plugins
          </Text>
          <TouchableOpacity
            onPress={() => openEditor()}
            style={[styles.headerButton, { borderColor: theme.colors.border }]}
            accessibilityRole="button"
            accessibilityLabel="Add custom plugin"
          >
            <Icon name="Settings" size={22} color={theme.colors.text} />
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          contentInsetAdjustmentBehavior="automatic"
        >
          <View
            style={[
              styles.search,
              {
                backgroundColor: theme.colors.inputBackground,
                borderColor: theme.colors.border,
              },
            ]}
          >
            <Icon name="Search" size={19} color={theme.colors.textMuted} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search plugins"
              placeholderTextColor={theme.colors.textMuted}
              style={[styles.searchInput, { color: theme.colors.text }]}
              accessibilityLabel="Search plugins"
            />
          </View>

          <SectionTitle title="Installed" color={theme.colors.text} />
          {visibleInstalled.length ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.installedRow}
            >
              {visibleInstalled.map((plugin) => (
                <TouchableOpacity
                  key={plugin.name}
                  onPress={() => void togglePlugin(plugin)}
                  onLongPress={() => removePlugin(plugin)}
                  style={[
                    styles.installedPlugin,
                    {
                      backgroundColor: theme.colors.cardBackground,
                      borderColor: plugin.enabled
                        ? theme.colors.primary
                        : theme.colors.border,
                    },
                  ]}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: plugin.enabled }}
                  accessibilityLabel={`${plugin.name} plugin`}
                  accessibilityHint="Tap to enable or disable. Long press to remove."
                >
                  <Icon
                    name="SquareTerminal"
                    size={24}
                    color={theme.colors.text}
                  />
                  <Text
                    style={[styles.installedName, { color: theme.colors.text }]}
                    numberOfLines={1}
                  >
                    {plugin.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          ) : (
            <Text style={[styles.emptyText, { color: theme.colors.textMuted }]}>
              No installed plugins.
            </Text>
          )}

          {(["Featured", "Productivity"] as const).map((category) => {
            const plugins = visibleFeatured.filter(
              (plugin) => plugin.category === category,
            );
            if (!plugins.length) return null;
            return (
              <View key={category} style={styles.category}>
                <SectionTitle title={category} color={theme.colors.text} />
                {plugins.map((plugin) => (
                  <TouchableOpacity
                    key={plugin.name}
                    onPress={() => openEditor(plugin)}
                    activeOpacity={0.72}
                    style={styles.featuredRow}
                    accessibilityRole="button"
                    accessibilityLabel={`Add ${plugin.name} plugin`}
                  >
                    <View
                      style={[
                        styles.pluginIcon,
                        { backgroundColor: plugin.tint },
                      ]}
                    >
                      <Icon
                        name={plugin.icon}
                        size={24}
                        color="#fff"
                        strokeWidth={2}
                      />
                    </View>
                    <View style={styles.pluginCopy}>
                      <Text
                        style={[
                          styles.pluginName,
                          { color: theme.colors.text },
                        ]}
                      >
                        {plugin.name}
                      </Text>
                      <Text
                        style={[
                          styles.pluginDescription,
                          { color: theme.colors.textMuted },
                        ]}
                        numberOfLines={1}
                      >
                        {plugin.description}
                      </Text>
                    </View>
                    <Icon name="Plus" size={24} color={theme.colors.text} />
                  </TouchableOpacity>
                ))}
              </View>
            );
          })}
        </ScrollView>

        <Modal
          visible={editorVisible}
          animationType="slide"
          transparent
          onRequestClose={() => setEditorVisible(false)}
        >
          <KeyboardAvoidingView
            style={styles.editorBackdrop}
            behavior={Platform.OS === "ios" ? "padding" : undefined}
          >
            <TouchableOpacity
              style={StyleSheet.absoluteFill}
              activeOpacity={1}
              onPress={() => setEditorVisible(false)}
            />
            <View
              style={[
                styles.editor,
                {
                  backgroundColor: theme.colors.surface,
                  borderColor: theme.colors.border,
                },
              ]}
            >
              <Text style={[styles.editorTitle, { color: theme.colors.text }]}>
                Add plugin
              </Text>
              <Text
                style={[styles.editorHelp, { color: theme.colors.textMuted }]}
              >
                Connect a public HTTPS MCP endpoint.
              </Text>
              <TextInput
                value={draftName}
                onChangeText={setDraftName}
                placeholder="Plugin name"
                placeholderTextColor={theme.colors.textMuted}
                style={[
                  styles.editorInput,
                  {
                    borderColor: theme.colors.border,
                    color: theme.colors.text,
                  },
                ]}
                accessibilityLabel="Plugin name"
              />
              <TextInput
                value={draftEndpoint}
                onChangeText={setDraftEndpoint}
                placeholder="https://example.com/mcp"
                placeholderTextColor={theme.colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                style={[
                  styles.editorInput,
                  {
                    borderColor: theme.colors.border,
                    color: theme.colors.text,
                  },
                ]}
                accessibilityLabel="Plugin endpoint"
              />
              <View style={styles.editorActions}>
                <TouchableOpacity
                  onPress={() => setEditorVisible(false)}
                  style={styles.editorAction}
                  accessibilityRole="button"
                >
                  <Text
                    style={[
                      styles.editorActionText,
                      { color: theme.colors.text },
                    ]}
                  >
                    Cancel
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => void savePlugin()}
                  disabled={
                    !draftName.trim() || !draftEndpoint.trim() || saving
                  }
                  style={[
                    styles.editorAction,
                    styles.addAction,
                    { backgroundColor: theme.colors.primary },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Save plugin"
                >
                  <Text style={styles.addActionText}>
                    {saving ? "Adding…" : "Add"}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>
      </SafeAreaView>
    </Modal>
  );
}

function SectionTitle({ title, color }: { title: string; color: string }) {
  return <Text style={[styles.sectionTitle, { color }]}>{title}</Text>;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  header: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 22,
    paddingVertical: 14,
  },
  headerButton: {
    alignItems: "center",
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    height: 48,
    justifyContent: "center",
    width: 48,
  },
  title: { fontSize: 21, fontWeight: "700" },
  content: { paddingBottom: 60, paddingHorizontal: 24 },
  search: {
    alignItems: "center",
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    marginBottom: 34,
    marginTop: 8,
    paddingHorizontal: 16,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    paddingHorizontal: 10,
    paddingVertical: 13,
  },
  sectionTitle: { fontSize: 17, fontWeight: "600", marginBottom: 16 },
  installedRow: { gap: 12, paddingBottom: 30 },
  installedPlugin: {
    alignItems: "center",
    borderRadius: 16,
    borderWidth: 1,
    gap: 8,
    justifyContent: "center",
    minHeight: 82,
    paddingHorizontal: 14,
    paddingVertical: 12,
    width: 104,
  },
  installedName: { fontSize: 12, fontWeight: "600", maxWidth: 84 },
  emptyText: { fontSize: 14, marginBottom: 30, marginTop: -4 },
  category: { marginBottom: 26 },
  featuredRow: {
    alignItems: "center",
    flexDirection: "row",
    minHeight: 84,
    paddingVertical: 10,
  },
  pluginIcon: {
    alignItems: "center",
    borderRadius: 14,
    height: 52,
    justifyContent: "center",
    width: 52,
  },
  pluginCopy: { flex: 1, marginHorizontal: 16 },
  pluginName: { fontSize: 16, fontWeight: "600", marginBottom: 3 },
  pluginDescription: { fontSize: 14 },
  editorBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  editor: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: StyleSheet.hairlineWidth,
    paddingBottom: 34,
    paddingHorizontal: 24,
    paddingTop: 26,
  },
  editorTitle: { fontSize: 22, fontWeight: "700" },
  editorHelp: { fontSize: 14, marginBottom: 20, marginTop: 6 },
  editorInput: {
    borderRadius: 14,
    borderWidth: 1,
    fontSize: 16,
    marginBottom: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  editorActions: {
    flexDirection: "row",
    gap: 10,
    justifyContent: "flex-end",
    marginTop: 8,
  },
  editorAction: {
    borderRadius: 14,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  editorActionText: { fontSize: 16, fontWeight: "600" },
  addAction: { minWidth: 88 },
  addActionText: {
    color: "#07101f",
    fontSize: 16,
    fontWeight: "700",
    textAlign: "center",
  },
});

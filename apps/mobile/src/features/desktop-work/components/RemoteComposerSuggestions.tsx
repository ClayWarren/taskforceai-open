import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';

import { Icon } from '../../../components/Icon';
import { useTheme } from '../../../contexts/ThemeContext';
import {
  useDesktopWorkspaceFilesQuery,
  type DesktopSkill,
} from '../data/desktop-work';

export type RemoteComposerCommand = {
  name: string;
  description: string;
  icon: React.ComponentProps<typeof Icon>['name'];
  run: () => void;
};

export type RemoteComposerTrigger = {
  kind: 'command' | 'reference' | 'skill';
  query: string;
  start: number;
};

export const remoteComposerTrigger = (input: string): RemoteComposerTrigger | null => {
  const match = input.match(/(?:^|\s)([/@$])([^\s]*)$/);
  if (!match || match.index === undefined) return null;
  const marker = match[1];
  const markerOffset = match[0].lastIndexOf(marker);
  return {
    kind: marker === '/' ? 'command' : marker === '@' ? 'reference' : 'skill',
    query: match[2] ?? '',
    start: match.index + markerOffset,
  };
};

export const applyRemoteComposerSuggestion = (
  input: string,
  trigger: RemoteComposerTrigger,
  value: string
) => `${input.slice(0, trigger.start)}${value}${input.slice(trigger.start + trigger.query.length + 1)}`;

const suggestionAccessibilityLabel = (kind: RemoteComposerTrigger['kind']) => {
  if (kind === 'command') return 'Remote commands';
  if (kind === 'skill') return 'Remote skills';
  return 'Remote workspace references';
};

function RemoteSuggestionRows({
  input,
  trigger,
  commands,
  skills,
  files,
  onInputChange,
}: {
  input: string;
  trigger: RemoteComposerTrigger;
  commands: RemoteComposerCommand[];
  skills: DesktopSkill[];
  files: string[];
  onInputChange: (input: string) => void;
}) {
  if (trigger.kind === 'command') {
    return commands.map((command) => (
      <SuggestionRow
        key={command.name}
        icon={command.icon}
        title={command.name}
        subtitle={command.description}
        onPress={() => {
          onInputChange(applyRemoteComposerSuggestion(input, trigger, ''));
          command.run();
        }}
      />
    ));
  }
  if (trigger.kind === 'skill') {
    return skills.map((skill) => (
      <SuggestionRow
        key={`${skill.source}:${skill.name}`}
        icon="Zap"
        title={`$${skill.name}`}
        subtitle={skill.description || `Use ${skill.name}`}
        onPress={() =>
          onInputChange(applyRemoteComposerSuggestion(input, trigger, `$${skill.name} `))
        }
      />
    ));
  }
  return files.map((path) => (
    <SuggestionRow
      key={path}
      icon="FileText"
      title={path}
      subtitle="Reference workspace file"
      onPress={() => onInputChange(applyRemoteComposerSuggestion(input, trigger, `@${path} `))}
    />
  ));
}

function RemoteSuggestionPanel({
  input,
  trigger,
  workspace,
  commands,
  skills,
  files,
  filesLoading,
  onInputChange,
}: {
  input: string;
  trigger: RemoteComposerTrigger;
  workspace?: string | null;
  commands: RemoteComposerCommand[];
  skills: DesktopSkill[];
  files: string[];
  filesLoading: boolean;
  onInputChange: (input: string) => void;
}) {
  const { theme } = useTheme();
  const matchingCommands = commands.filter((command) =>
    command.name.slice(1).startsWith(trigger.query.toLowerCase())
  );
  const matchingSkills = skills
    .filter(
      (skill) =>
        skill.enabled && skill.name.toLowerCase().includes(trigger.query.toLowerCase())
    )
    .slice(0, 7);
  const referencedFiles = files.slice(0, 7);
  if (trigger.kind === 'command' && matchingCommands.length === 0) return null;
  if (trigger.kind === 'skill' && matchingSkills.length === 0) return null;
  if (trigger.kind === 'reference' && !workspace) return null;

  return (
    <View
      accessibilityLabel={suggestionAccessibilityLabel(trigger.kind)}
      style={{
        overflow: 'hidden',
        borderRadius: 14,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.background,
      }}
    >
      {trigger.kind === 'reference' && filesLoading ? (
        <Text style={{ color: theme.colors.textMuted, padding: 11, fontSize: 12 }}>
          Searching workspace…
        </Text>
      ) : null}
      {trigger.kind === 'reference' && !filesLoading && referencedFiles.length === 0 ? (
        <Text style={{ color: theme.colors.textMuted, padding: 11, fontSize: 12 }}>
          No matching workspace files
        </Text>
      ) : null}
      <RemoteSuggestionRows
        input={input}
        trigger={trigger}
        commands={matchingCommands}
        skills={matchingSkills}
        files={referencedFiles}
        onInputChange={onInputChange}
      />
    </View>
  );
}

export function RemoteComposerSuggestions({
  input,
  workspace,
  commands = [],
  skills = [],
  onInputChange,
}: {
  input: string;
  workspace?: string | null;
  commands?: RemoteComposerCommand[];
  skills?: DesktopSkill[];
  onInputChange: (input: string) => void;
}) {
  const trigger = remoteComposerTrigger(input);
  const fileQuery = trigger?.kind === 'reference' ? trigger.query : '';
  const [debouncedFileQuery, setDebouncedFileQuery] = React.useState(fileQuery);
  React.useEffect(() => {
    const timer = globalThis.setTimeout(() => setDebouncedFileQuery(fileQuery), 180);
    return () => globalThis.clearTimeout(timer);
  }, [fileQuery]);
  const files = useDesktopWorkspaceFilesQuery(
    workspace ?? null,
    debouncedFileQuery,
    Boolean(workspace && trigger?.kind === 'reference')
  );
  if (!trigger) return null;

  return (
    <RemoteSuggestionPanel
      input={input}
      trigger={trigger}
      workspace={workspace}
      commands={commands}
      skills={skills}
      files={files.data?.files ?? []}
      filesLoading={files.isLoading}
      onInputChange={onInputChange}
    />
  );
}

function SuggestionRow({
  icon,
  title,
  subtitle,
  onPress,
}: {
  icon: React.ComponentProps<typeof Icon>['name'];
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  const { theme } = useTheme();
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={`${title}: ${subtitle}`}
      onPress={onPress}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 11, paddingVertical: 9 }}
    >
      <Icon name={icon} size={15} color={theme.colors.textMuted} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: theme.colors.text, fontSize: 12, fontWeight: '700' }}>{title}</Text>
        <Text style={{ color: theme.colors.textMuted, fontSize: 11, marginTop: 1 }}>{subtitle}</Text>
      </View>
    </TouchableOpacity>
  );
}

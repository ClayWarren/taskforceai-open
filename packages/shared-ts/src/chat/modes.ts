export type ModeId = 'agent-teams' | 'autonomous' | 'computer-use' | 'custom-models' | 'quick-mode';

export interface ModeBadge {
  id: ModeId | (string & {});
  label: string;
  icon?: string;
  iconName?: string; // For Lucide/mobile
  enabled: boolean;
  onPress?: () => void;
  onClick?: () => void; // For web
  onDismiss?: () => void;
}

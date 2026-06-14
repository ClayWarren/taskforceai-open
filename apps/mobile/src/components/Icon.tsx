import type { LucideIcon, LucideProps } from 'lucide-react-native';
import * as LucideIcons from 'lucide-react-native';

import { colors } from '../theme/colors';

const iconNames = [
  'Activity',
  'AlertTriangle',
  'ArrowUpRight',
  'Bell',
  'Check',
  'ChevronDown',
  'ChevronLeft',
  'ChevronRight',
  'ChevronUp',
  'Copy',
  'Cpu',
  'Database',
  'Globe',
  'HardDrive',
  'Maximize',
  'Menu',
  'Mic',
  'Minimize',
  'Monitor',
  'MoreHorizontal',
  'MoreVertical',
  'Paperclip',
  'Plus',
  'Search',
  'Send',
  'Share',
  'ShieldCheck',
  'SlidersHorizontal',
  'Square',
  'SquarePen',
  'ThumbsDown',
  'ThumbsUp',
  'Trash2',
  'UserRound',
  'Users',
  'Volume2',
  'X',
  'Zap',
] as const;

const iconRegistry = Object.fromEntries(
  iconNames.map((name) => [name, LucideIcons[name] as LucideIcon])
) as Record<(typeof iconNames)[number], LucideIcon>;

export type IconName = keyof typeof iconRegistry;

type IconProps = Omit<LucideProps, 'color'> & {
  name: IconName;
  color?: string;
};

export function Icon({
  name,
  color = colors.textPrimary,
  size = 20,
  strokeWidth = 1.5,
  ...rest
}: IconProps) {
  const Component = iconRegistry[name];

  if (!Component) {
    return null;
  }

  return <Component color={color} size={size} strokeWidth={strokeWidth} {...rest} />;
}

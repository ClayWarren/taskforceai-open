import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  AudioLines,
  Bell,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Copy,
  CreditCard,
  Cpu,
  Database,
  Download,
  FileText,
  Gauge,
  Globe,
  HardDrive,
  Maximize,
  Menu,
  Mic,
  Minimize,
  Monitor,
  MoreHorizontal,
  MoreVertical,
  Paperclip,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  Send,
  Share,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  Square,
  SquarePen,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  UserRound,
  Users,
  Volume2,
  X,
  Zap,
  type LucideIcon,
  type LucideProps,
} from 'lucide-react-native';

import { colors } from '../theme/colors';

const iconRegistry = {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  AudioLines,
  Bell,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Copy,
  CreditCard,
  Cpu,
  Database,
  Download,
  FileText,
  Gauge,
  Globe,
  HardDrive,
  Maximize,
  Menu,
  Mic,
  Minimize,
  Monitor,
  MoreHorizontal,
  MoreVertical,
  Paperclip,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  Send,
  Share,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  Square,
  SquarePen,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  UserRound,
  Users,
  Volume2,
  X,
  Zap,
} satisfies Record<string, LucideIcon>;

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

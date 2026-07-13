import type React from 'react';
import { Text, View } from 'react-native';

import { useTheme } from '../../contexts/ThemeContext';
import { threadItemText, type DesktopThread, type DesktopThreadItem } from '../../hooks/api/desktopWork';
import { Icon } from '../Icon';
import { RemoteStatusText } from './RemoteControls';

export function RemoteThreadActivity({ thread, loading }: { thread: DesktopThread; loading: boolean }) {
  const { theme } = useTheme();
  const items = thread.turns.flatMap((turn) => turn.items);
  if (loading && items.length === 0) return <RemoteStatusText text="Loading remote activity…" />;
  if (items.length === 0) return <RemoteStatusText text="No activity has been recorded yet." />;
  return (
    <View style={{ gap: 8 }}>
      {items.map((item) => (
        <View key={item.id} style={{ gap: 5, padding: 12, borderRadius: 14, borderCurve: 'continuous', backgroundColor: theme.colors.cardBackground }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
            <Icon name={activityIcon(item)} size={14} color={theme.colors.textMuted} />
            <Text style={{ color: theme.colors.textMuted, fontSize: 11, fontWeight: '700' }}>{activityLabel(item)}</Text>
            <Text style={{ marginLeft: 'auto', color: statusColor(item.status), fontSize: 10 }}>{formatStatus(item.status)}</Text>
          </View>
          {threadItemText(item) ? (
            <Text selectable style={{ color: theme.colors.text, lineHeight: 19 }}>{threadItemText(item)}</Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}

const activityIcon = (item: DesktopThreadItem): React.ComponentProps<typeof Icon>['name'] => {
  if (item.type === 'userMessage' || item.type === 'steeringMessage') return 'UserRound';
  if (item.type === 'toolCall') return 'Zap';
  if (item.type === 'approval') return 'ShieldCheck';
  if (item.type === 'error') return 'AlertTriangle';
  return 'Activity';
};
const activityLabel = (item: DesktopThreadItem) => item.type.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (value) => value.toUpperCase());
const formatStatus = (status: string) => status.replace(/([a-z])([A-Z])/g, '$1 $2');
const statusColor = (status: string) => status === 'failed' || status === 'declined' ? '#fca5a5' : status === 'inProgress' ? '#93c5fd' : '#86efac';

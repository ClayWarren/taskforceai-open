import { ScrollView, Text, TouchableOpacity, View } from 'react-native';

import { Icon } from '../Icon';
import { formatBytes, type Attachment } from './internal';

type AttachmentsBarProps = {
  attachments: Attachment[];
  onRemove: (id: string) => void;
  errorColor: string;
};

export function AttachmentsBar({ attachments, onRemove, errorColor }: AttachmentsBarProps) {
  if (attachments.length === 0) {
    return null;
  }

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingBottom: 8, alignItems: 'center' }}
    >
      {attachments.map((attachment) => (
        <View
          key={attachment.id}
          className="mr-sm px-sm py-xs flex-row items-center rounded-2xl border border-white/15 bg-white/10"
          style={{ maxWidth: 220 }}
        >
          <Text className="flex-1 text-xs text-white" numberOfLines={1}>
            {attachment.name} • {formatBytes(attachment.size)}
          </Text>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={`Remove ${attachment.name}`}
            accessibilityHint="Removes this attachment"
            onPress={() => onRemove(attachment.id)}
            className="ml-xs px-xs"
          >
            <Icon name="X" size={14} color={errorColor} />
          </TouchableOpacity>
        </View>
      ))}
    </ScrollView>
  );
}

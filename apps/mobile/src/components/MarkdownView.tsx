import { extractGeneratedMediaResult, stripGeneratedMediaMarkup } from '@taskforceai/shared';
import { VideoView, useVideoPlayer } from 'expo-video';
import { Image, Linking, Platform, Pressable, Text, TextStyle, View } from 'react-native';
import Markdown from 'react-native-markdown-display';
import { useTheme } from '../contexts/ThemeContext';
import { createModuleLogger } from '../logger';

const logger = createModuleLogger('MarkdownView');

interface MarkdownViewProps {
  content: string | null | undefined;
  isUser?: boolean;
}

interface GeneratedVideoPreviewProps {
  uri: string;
  styles: {
    generatedVideoContainer: any;
    generatedVideo: any;
    generatedVideoLink: any;
    generatedVideoLinkText: TextStyle;
  };
  textColor: string;
}

const staticStyles = {
  generatedMediaContainer: {
    gap: 10,
    marginBottom: 10,
  } as any,
  generatedImage: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  } as any,
  generatedVideoContainer: {
    width: '100%',
    gap: 8,
  } as any,
  generatedVideo: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: 12,
    backgroundColor: '#000000',
    overflow: 'hidden',
  } as any,
  code_inline: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    paddingHorizontal: 4,
    borderRadius: 4,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  } as TextStyle,
  code_block: {
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    padding: 12,
    borderRadius: 8,
    marginVertical: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  } as any,
  fence: {
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    padding: 12,
    borderRadius: 8,
    marginVertical: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  } as any,
  bullet_list: {
    marginVertical: 8,
  } as any,
  ordered_list: {
    marginVertical: 8,
  } as any,
  list_item: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 4,
  } as any,
};

const canOpenGeneratedMediaUri = (uri: string): boolean => {
  try {
    const protocol = new URL(uri).protocol;
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
};

function GeneratedVideoPreview({ uri, styles, textColor }: GeneratedVideoPreviewProps) {
  const player = useVideoPlayer(uri);
  const canOpenUri = canOpenGeneratedMediaUri(uri);

  return (
    <View
      testID="generated-media-video"
      accessible
      accessibilityRole="image"
      accessibilityLabel="Generated video"
      style={styles.generatedVideoContainer}
    >
      <VideoView
        player={player}
        style={styles.generatedVideo}
        nativeControls
        fullscreenOptions={{ enable: true }}
        contentFit="contain"
      />
      <Pressable
        testID="generated-media-video-open"
        accessibilityRole="button"
        accessibilityLabel="Open generated video"
        disabled={!canOpenUri}
        onPress={() => {
          if (canOpenUri) void Linking.openURL(uri);
        }}
        style={styles.generatedVideoLink}
      >
        <Text style={[styles.generatedVideoLinkText, { color: textColor }]}>
          Open generated video
        </Text>
      </Pressable>
    </View>
  );
}

export function MarkdownView({ content, isUser }: MarkdownViewProps) {
  const { theme } = useTheme();

  // 1. Hard Prop Safety
  if (content === null || content === undefined) {
    return null;
  }

  // 2. String Safety
  const safeContent = typeof content === 'string' ? content : String(content);
  if (!safeContent.trim()) {
    return null;
  }

  // 3. Theme Safety
  const colors = theme?.colors || {
    text: '#e2e8f0',
    textMuted: '#94a3b8',
    primary: '#3b82f6',
    border: 'rgba(255, 255, 255, 0.1)',
  };

  const textColor = isUser ? '#ffffff' : colors.text;

  const styles = {
    ...staticStyles,
    generatedVideoLink: {
      alignSelf: 'flex-start',
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: 'rgba(255, 255, 255, 0.08)',
      paddingHorizontal: 14,
      paddingVertical: 10,
    } as any,
    generatedVideoLinkText: {
      color: textColor,
      fontSize: 15,
      fontWeight: '600',
    } as TextStyle,
    body: {
      color: textColor,
      fontSize: 16,
      lineHeight: 22,
    } as TextStyle,
    paragraph: {
      marginTop: 0,
      marginBottom: 10,
    } as any,
    strong: {
      fontWeight: 'bold',
      color: textColor,
    } as TextStyle,
    em: {
      fontStyle: 'italic',
    } as TextStyle,
    link: {
      color: colors.primary,
      textDecorationLine: 'underline',
    } as TextStyle,
    code_inline: {
      ...staticStyles.code_inline,
      color: colors.primary,
    } as TextStyle,
    bullet_list_icon: {
      color: colors.textMuted,
      fontSize: 20,
      lineHeight: 22,
      marginRight: 8,
    } as TextStyle,
    bullet_list_content: {
      flex: 1,
      color: textColor,
    } as TextStyle,
    hr: {
      backgroundColor: colors.border,
      height: 1,
      marginVertical: 12,
    } as any,
    blockquote: {
      backgroundColor: 'rgba(255, 255, 255, 0.05)',
      borderLeftWidth: 4,
      borderLeftColor: colors.primary,
      paddingHorizontal: 12,
      paddingVertical: 8,
      marginVertical: 8,
    } as any,
  };

  // 4. Component Definition Safety
  if (!Markdown || (typeof Markdown !== 'function' && !(Markdown as any).$$typeof)) {
    return (
      <Text style={{ color: textColor, fontSize: 16, lineHeight: 22 }}>
        {safeContent}
      </Text>
    );
  }

  // 5. Runtime Rendering Safety
  try {
    const generatedMedia = extractGeneratedMediaResult(safeContent);
    if (generatedMedia) {
      const remainingContent = stripGeneratedMediaMarkup(safeContent);
      const canLoadMedia = canOpenGeneratedMediaUri(generatedMedia.uri);
      return (
        <View style={styles.generatedMediaContainer}>
          {generatedMedia.kind === 'image' && canLoadMedia ? (
            <Image
              testID="generated-media-image"
              source={{ uri: generatedMedia.uri }}
              style={styles.generatedImage}
              resizeMode="contain"
              accessibilityIgnoresInvertColors
              accessible
              accessibilityRole="image"
              accessibilityLabel="Generated image"
            />
          ) : generatedMedia.kind === 'video' && canLoadMedia ? (
            <GeneratedVideoPreview
              uri={generatedMedia.uri}
              styles={styles}
              textColor={textColor}
            />
          ) : null}
          {remainingContent ? <Markdown style={styles}>{remainingContent}</Markdown> : null}
        </View>
      );
    }

    return (
      <Markdown style={styles}>
        {safeContent}
      </Markdown>
    );
  } catch (err) {
    logger.warn('Render failed, falling back to Text', { error: err });
    return (
      <Text style={{ color: textColor, fontSize: 16, lineHeight: 22 }}>
        {safeContent}
      </Text>
    );
  }
}

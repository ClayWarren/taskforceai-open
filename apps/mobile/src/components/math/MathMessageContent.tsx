import { splitMarkdownAndLatex } from '@taskforceai/shared/utils/math';
import React, { Fragment } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { MarkdownView } from '../MarkdownView';

interface MathMessageContentProps {
  content: string | null | undefined;
  isUser?: boolean;
  enableLatexRendering?: boolean;
}

const MOBILE_LATEX_RENDERING_DEFAULT = false;

const styles = StyleSheet.create({
  blockMathContainer: {
    marginVertical: 8,
  },
  blockMathText: {
    fontFamily: 'monospace',
    fontSize: 16,
    lineHeight: 24,
    textAlign: 'center',
  },
  inlineMathText: {
    fontFamily: 'monospace',
    fontSize: 16,
    lineHeight: 22,
  },
});

export function MathMessageContent({
  content,
  isUser,
  enableLatexRendering = MOBILE_LATEX_RENDERING_DEFAULT,
}: MathMessageContentProps) {
  if (!enableLatexRendering) {
    return <MarkdownView content={content} isUser={isUser} />;
  }

  const segments = splitMarkdownAndLatex(content ?? '');
  const textColor = isUser ? '#ffffff' : '#e2e8f0';

  return (
    <View>
      {segments.map((segment, index) => {
        if (segment.type === 'markdown') {
          return (
            <Fragment key={`${segment.type}-${index}`}>
              <MarkdownView content={segment.raw} isUser={isUser} />
            </Fragment>
          );
        }

        if (segment.type === 'block-math') {
          return (
            <View key={`${segment.type}-${index}`} style={styles.blockMathContainer}>
              <Text style={[styles.blockMathText, { color: textColor }]}>{segment.expression}</Text>
            </View>
          );
        }

        return (
          <Text
            key={`${segment.type}-${index}`}
            style={[styles.inlineMathText, { color: textColor }]}
          >
            {segment.expression}
          </Text>
        );
      })}
    </View>
  );
}

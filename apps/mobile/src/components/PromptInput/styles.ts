import { spacingTokens } from '@taskforceai/design-tokens';
import { StyleSheet } from 'react-native';

import { ICON_BUTTON_SIZE } from './internal';

export const styles = StyleSheet.create({
  rowWrapper: {
    width: '100%',
    alignItems: 'center',
    paddingHorizontal: spacingTokens.sm,
  },
  inlineIconButton: {
    height: ICON_BUTTON_SIZE - 6,
    width: ICON_BUTTON_SIZE - 6,
    borderRadius: (ICON_BUTTON_SIZE - 6) / 2,
    borderWidth: 1,
    borderColor: 'rgba(59,130,246,0.25)',
    backgroundColor: 'rgba(12,19,38,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  promptBubble: {
    flexDirection: 'column',
    borderWidth: 1,
    borderRadius: 24,
    paddingTop: spacingTokens.sm,
    paddingBottom: spacingTokens.xs,
    paddingHorizontal: spacingTokens.md,
    flexGrow: 1,
    flexShrink: 1,
    width: '100%',
    alignSelf: 'center',
    overflow: 'visible',
    marginHorizontal: spacingTokens.sm / 2,
  },
  promptBody: {
    paddingHorizontal: spacingTokens.xs,
    paddingBottom: spacingTokens.xs,
  },
  promptActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  promptActionsLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingTokens.xs,
  },
  promptActionsRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingTokens.xs,
  },
  privateChatDisclosure: {
    alignSelf: 'center',
    maxWidth: 620,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingTokens.xs,
    paddingHorizontal: spacingTokens.md,
    paddingVertical: spacingTokens.sm,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(110,231,183,0.28)',
    backgroundColor: 'rgba(6,78,59,0.22)',
    marginBottom: spacingTokens.sm,
  },
  privateChatDisclosureText: {
    flex: 1,
    color: '#d1fae5',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
  },
  textInput: {
    fontSize: 16,
    lineHeight: 22,
    color: '#ffffff',
    minHeight: 28,
    maxHeight: 120,
    paddingTop: spacingTokens.xs,
    paddingBottom: spacingTokens.xs,
    textAlignVertical: 'top',
  },
});

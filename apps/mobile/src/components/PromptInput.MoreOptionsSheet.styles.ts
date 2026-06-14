import { spacingTokens } from '@taskforceai/design-tokens';
import { StyleSheet } from 'react-native';

export const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  card: {
    width: '88%',
    maxWidth: 420,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: spacingTokens.md,
    paddingTop: spacingTokens.md,
    paddingBottom: spacingTokens.sm,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: spacingTokens.sm,
  },
  content: {
    gap: spacingTokens.xs,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacingTokens.sm,
    paddingHorizontal: spacingTokens.xs,
    borderRadius: 12,
  },
  optionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: spacingTokens.sm,
  },
  iconContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionText: {
    flex: 1,
  },
  optionLabel: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },
  optionDescription: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 12,
    marginTop: 1,
  },
  divider: {
    height: 1,
    marginVertical: spacingTokens.xs,
  },
  agentCountSection: {
    paddingVertical: spacingTokens.sm,
    paddingHorizontal: spacingTokens.xs,
    gap: spacingTokens.sm,
  },
  countGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacingTokens.xs,
    justifyContent: 'flex-start',
    paddingLeft: 48,
  },
  countButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  countButtonText: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.6)',
  },
});

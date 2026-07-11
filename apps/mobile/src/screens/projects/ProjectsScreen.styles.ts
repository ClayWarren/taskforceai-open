import { spacingTokens } from '@taskforceai/design-tokens';
import { StyleSheet } from 'react-native';

export const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacingTokens.lg,
    paddingBottom: spacingTokens.md,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#ffffff',
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  createButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacingTokens.sm,
    marginHorizontal: spacingTokens.lg,
    marginBottom: spacingTokens.md,
    paddingVertical: spacingTokens.md,
    borderRadius: 12,
  },
  createButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  listContent: {
    paddingHorizontal: spacingTokens.lg,
    paddingBottom: spacingTokens.xl,
  },
  projectItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacingTokens.md,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: spacingTokens.sm,
  },
  projectInfo: {
    flex: 1,
    marginRight: spacingTokens.sm,
  },
  projectName: {
    fontSize: 16,
    fontWeight: '600',
  },
  projectDescription: {
    fontSize: 13,
    marginTop: 2,
  },
  projectActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingTokens.sm,
  },
  emptyState: {
    alignItems: 'center',
    paddingTop: spacingTokens.xl * 2,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
  },
  emptySubtext: {
    fontSize: 14,
    marginTop: spacingTokens.xs,
    textAlign: 'center',
  },
  modalOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacingTokens.lg,
  },
  createModal: {
    width: '100%',
    maxWidth: 400,
    borderRadius: 16,
    padding: spacingTokens.lg,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacingTokens.lg,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    padding: spacingTokens.md,
    fontSize: 16,
    color: '#ffffff',
    marginBottom: spacingTokens.md,
  },
  textArea: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacingTokens.sm,
    marginTop: spacingTokens.sm,
  },
  cancelButton: {
    paddingVertical: spacingTokens.sm,
    paddingHorizontal: spacingTokens.lg,
  },
  cancelButtonText: {
    fontSize: 16,
  },
  submitButton: {
    paddingVertical: spacingTokens.sm,
    paddingHorizontal: spacingTokens.lg,
    borderRadius: 8,
  },
  submitButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
  },
});

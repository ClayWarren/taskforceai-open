import React from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { useTheme } from '../../contexts/ThemeContext';
import { useRespondDesktopInteractionMutation, type DesktopInteractionRequest } from '../../hooks/api/desktopWork';

export function RemoteInteractionCards({ interactions }: { interactions: DesktopInteractionRequest[] }) {
  const respond = useRespondDesktopInteractionMutation();
  if (interactions.length === 0) return null;
  return (
    <View style={styles.list} accessibilityLabel="Desktop approvals">
      {interactions.map((interaction) => (
        <RemoteInteractionCard
          key={`${interaction.method}-${interaction.id}`}
          interaction={interaction}
          pending={respond.isPending}
          onRespond={(response) => respond.mutate({ requestId: interaction.id, ...response })}
        />
      ))}
    </View>
  );
}

function RemoteInteractionCard({ interaction, pending, onRespond }: {
  interaction: DesktopInteractionRequest;
  pending: boolean;
  onRespond: (response: { decision?: 'accept' | 'decline'; response?: unknown }) => void;
}) {
  const { theme } = useTheme();
  const questions = Array.isArray(interaction.params.questions) ? interaction.params.questions as Array<Record<string, unknown>> : [];
  const [answers, setAnswers] = React.useState<Record<string, string>>({});
  const isUserInput = interaction.method === 'item/tool/requestUserInput' && questions.length > 0;
  const submitAnswers = () => onRespond({
    response: {
      answers: Object.fromEntries(questions.map((question) => {
        const id = typeof question.id === 'string' ? question.id : 'answer';
        return [id, { answers: [answers[id] ?? ''] }];
      })),
    },
  });
  const missingAnswer = isUserInput && questions.some((question, index) => {
    const id = typeof question.id === 'string' ? question.id : `question-${index}`;
    return !answers[id]?.trim();
  });

  return (
    <View style={[styles.card, { backgroundColor: theme.colors.cardBackground }]}>
      <Text style={[styles.title, { color: theme.colors.text }]}>{isUserInput ? 'Needs input' : 'Needs approval'}</Text>
      <Text selectable style={[styles.body, { color: theme.colors.textMuted }]}>{interactionSummary(interaction)}</Text>
      {isUserInput ? questions.map((question, index) => {
        const id = typeof question.id === 'string' ? question.id : `question-${index}`;
        const prompt = typeof question.question === 'string' ? question.question : 'Your response';
        const options = Array.isArray(question.options) ? question.options as Array<Record<string, unknown>> : [];
        return (
          <View key={id} style={{ gap: 7 }}>
            <Text selectable style={{ color: theme.colors.text, fontSize: 12 }}>{prompt}</Text>
            {options.length > 0 ? <View style={{ gap: 6 }}>{options.map((option) => {
              const label = typeof option.label === 'string' ? option.label : 'Option';
              return (
                <TouchableOpacity key={label} accessibilityRole="button" accessibilityLabel={`Answer ${prompt}: ${label}`} accessibilityState={{ selected: answers[id] === label }} onPress={() => setAnswers((current) => ({ ...current, [id]: label }))} style={[styles.button, { borderColor: answers[id] === label ? '#60a5fa' : theme.colors.border }]}>
                  <Text style={{ color: theme.colors.text }}>{label}</Text>
                </TouchableOpacity>
              );
            })}</View> : (
              <TextInput value={answers[id] ?? ''} onChangeText={(value) => setAnswers((current) => ({ ...current, [id]: value }))} placeholder="Type your response" placeholderTextColor={theme.colors.textMuted} accessibilityLabel={`Answer ${prompt}`} style={[styles.input, { color: theme.colors.text, borderColor: theme.colors.border }]} />
            )}
          </View>
        );
      }) : null}
      <View style={styles.actions}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Decline desktop request ${interaction.id}`} disabled={pending} onPress={() => onRespond({ decision: 'decline' })} style={[styles.button, { borderColor: theme.colors.border }]}>
          <Text style={{ color: theme.colors.text }}>{isUserInput ? 'Cancel' : 'Decline'}</Text>
        </TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={`${isUserInput ? 'Submit' : 'Approve'} desktop request ${interaction.id}`} disabled={pending || missingAnswer} onPress={isUserInput ? submitAnswers : () => onRespond({ decision: 'accept' })} style={[styles.button, styles.approve]}>
          <Text style={styles.approveText}>{isUserInput ? 'Submit' : 'Approve'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const interactionSummary = (interaction: DesktopInteractionRequest): string => {
  const reason = interaction.params.reason;
  if (typeof reason === 'string' && reason.trim()) return reason;
  if (interaction.method.includes('commandExecution')) return 'Run a command on the paired desktop.';
  if (interaction.method.includes('fileChange')) return 'Apply file changes on the paired desktop.';
  if (interaction.method === 'item/tool/requestUserInput') return 'The remote task needs your response.';
  return 'Allow the requested action on the paired desktop.';
};

const styles = StyleSheet.create({
  list: { gap: 10 },
  card: { borderRadius: 18, gap: 8, padding: 14 },
  title: { fontSize: 14, fontWeight: '700' },
  body: { fontSize: 13, lineHeight: 19 },
  input: { borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, minHeight: 42, paddingHorizontal: 11, paddingVertical: 9 },
  actions: { flexDirection: 'row', gap: 10, justifyContent: 'flex-end', marginTop: 4 },
  button: { borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14, paddingVertical: 9 },
  approve: { backgroundColor: '#ffffff', borderColor: '#ffffff' },
  approveText: { color: '#000000', fontWeight: '700' },
});

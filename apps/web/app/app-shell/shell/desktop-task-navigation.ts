import type { ConversationRecord } from '../../lib/platform/platform-interfaces';

export type TaskNavigationDirection = -1 | 1;

export function adjacentTask(
  tasks: readonly ConversationRecord[],
  activeConversationId: string | null | undefined,
  direction: TaskNavigationDirection
): ConversationRecord | null {
  const availableTasks = tasks.filter((task) => !task.isArchived);
  if (availableTasks.length === 0) return null;

  const activeIndex = activeConversationId
    ? availableTasks.findIndex((task) => task.conversationId === activeConversationId)
    : -1;
  if (activeIndex === -1) {
    return direction === 1 ? availableTasks[0]! : availableTasks.at(-1)!;
  }

  const nextIndex = (activeIndex + direction + availableTasks.length) % availableTasks.length;
  return availableTasks[nextIndex] ?? null;
}

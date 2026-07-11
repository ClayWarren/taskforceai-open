package orchestrator

import "context"

func (s *TeamService) ListTasks(ctx context.Context, teamName string) ([]TeamTask, error) {
	return s.store.GetTasks(ctx, teamName)
}

func (s *TeamService) UpdateTasks(ctx context.Context, teamName string, tasks []TeamTask) error {
	resolved := s.resolveDependencies(tasks)
	return s.store.SaveTasks(ctx, teamName, resolved)
}

func (s *TeamService) AddTasks(ctx context.Context, teamName string, newTasks []TeamTask) error {
	existing, err := s.ListTasks(ctx, teamName)
	if err != nil {
		return err
	}
	resolved := s.resolveDependencies(append(existing, newTasks...))
	return s.store.SaveTasks(ctx, teamName, resolved)
}

func (s *TeamService) ClaimTask(ctx context.Context, teamName, taskID, memberName string) (bool, error) {
	tasks, err := s.ListTasks(ctx, teamName)
	if err != nil {
		return false, err
	}

	claimed := false
	for i, task := range tasks {
		if task.ID == taskID {
			if task.Status != TaskStatusPending || task.Assignee != "" {
				return false, nil
			}

			if s.isTaskBlocked(task, tasks) {
				return false, nil
			}

			tasks[i].Status = TaskStatusInProgress
			tasks[i].Assignee = memberName
			claimed = true
			break
		}
	}

	if !claimed {
		return false, nil
	}

	if err := s.store.SaveTasks(ctx, teamName, tasks); err != nil {
		return false, err
	}

	return true, nil
}

func (s *TeamService) isTaskBlocked(task TeamTask, allTasks []TeamTask) bool {
	if len(task.DependsOn) == 0 {
		return false
	}
	for _, depID := range task.DependsOn {
		found := false
		for _, t := range allTasks {
			if t.ID == depID {
				found = true
				if t.Status != TaskStatusCompleted && t.Status != TaskStatusCancelled {
					return true
				}
				break
			}
		}
		if !found {
			return true
		}
	}
	return false
}

func (s *TeamService) CompleteTask(ctx context.Context, teamName, taskID string) error {
	tasks, err := s.ListTasks(ctx, teamName)
	if err != nil {
		return err
	}

	found := false
	for i, task := range tasks {
		if task.ID == taskID {
			tasks[i].Status = TaskStatusCompleted
			found = true
			break
		}
	}

	if !found {
		return nil
	}

	resolved := s.resolveDependencies(tasks)
	return s.store.SaveTasks(ctx, teamName, resolved)
}

func (s *TeamService) resolveDependencies(tasks []TeamTask) []TeamTask {
	validIDs := make(map[string]bool)
	for _, t := range tasks {
		validIDs[t.ID] = true
	}

	out := make([]TeamTask, len(tasks))
	for i, task := range tasks {
		if len(task.DependsOn) > 0 {
			var filtered []string
			for _, id := range task.DependsOn {
				if validIDs[id] && id != task.ID {
					filtered = append(filtered, id)
				}
			}
			task.DependsOn = filtered
		}

		if len(task.DependsOn) == 0 {
			if task.Status == TaskStatusBlocked {
				task.Status = TaskStatusPending
			}
			out[i] = task
			continue
		}

		unresolved := false
		for _, depID := range task.DependsOn {
			for _, t := range tasks {
				if t.ID == depID {
					if t.Status != TaskStatusCompleted && t.Status != TaskStatusCancelled {
						unresolved = true
					}
					break
				}
			}
			if unresolved {
				break
			}
		}

		if unresolved && task.Status == TaskStatusPending {
			task.Status = TaskStatusBlocked
		} else if !unresolved && task.Status == TaskStatusBlocked {
			task.Status = TaskStatusPending
		}
		out[i] = task
	}

	return out
}

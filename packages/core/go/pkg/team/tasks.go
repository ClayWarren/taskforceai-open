package team

import "context"

func (s *Service) ListTasks(ctx context.Context, teamName string) ([]Task, error) {
	return s.store.GetTasks(ctx, teamName)
}

func (s *Service) UpdateTasks(ctx context.Context, teamName string, tasks []Task) error {
	resolved := s.resolveDependencies(tasks)
	return s.store.SaveTasks(ctx, teamName, resolved)
}

func (s *Service) AddTasks(ctx context.Context, teamName string, newTasks []Task) error {
	existing, err := s.ListTasks(ctx, teamName)
	if err != nil {
		return err
	}
	resolved := s.resolveDependencies(append(existing, newTasks...))
	return s.store.SaveTasks(ctx, teamName, resolved)
}

func (s *Service) ClaimTask(ctx context.Context, teamName, taskID, memberName string) (bool, error) {
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

func (s *Service) isTaskBlocked(task Task, allTasks []Task) bool {
	statuses := taskStatuses(allTasks)
	for _, depID := range task.DependsOn {
		status, found := statuses[depID]
		if !found || !isResolvedTaskStatus(status) {
			return true
		}
	}
	return false
}

func (s *Service) CompleteTask(ctx context.Context, teamName, taskID string) error {
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

func (s *Service) resolveDependencies(tasks []Task) []Task {
	statuses := taskStatuses(tasks)
	out := make([]Task, len(tasks))
	for i, task := range tasks {
		unresolved := false
		if len(task.DependsOn) > 0 {
			var filtered []string
			for _, id := range task.DependsOn {
				status, valid := statuses[id]
				if !valid || id == task.ID {
					continue
				}
				filtered = append(filtered, id)
				unresolved = unresolved || !isResolvedTaskStatus(status)
			}
			task.DependsOn = filtered
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

func taskStatuses(tasks []Task) map[string]TaskStatus {
	statuses := make(map[string]TaskStatus, len(tasks))
	for _, task := range tasks {
		if _, exists := statuses[task.ID]; !exists {
			statuses[task.ID] = task.Status
		}
	}
	return statuses
}

func isResolvedTaskStatus(status TaskStatus) bool {
	return status == TaskStatusCompleted || status == TaskStatusCancelled
}

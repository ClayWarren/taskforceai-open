package run

import (
	taskregistry "github.com/TaskForceAI/go-engine/pkg/run/internal/taskregistry"
	taskcontract "github.com/TaskForceAI/go-engine/pkg/run/task"
)

type TaskStatus = taskcontract.Status

const (
	StatusProcessing = taskcontract.StatusProcessing
	StatusCompleted  = taskcontract.StatusCompleted
	StatusFailed     = taskcontract.StatusFailed
	StatusCanceled   = taskcontract.StatusCanceled
	StatusAwaiting   = taskcontract.StatusAwaiting
	TaskTTL          = taskcontract.TTL
)

type TaskState = taskcontract.State
type BudgetUsage = taskcontract.BudgetUsage
type PendingApproval = taskcontract.PendingApproval
type TaskRegistrar = taskcontract.Registrar
type TaskListOptions = taskcontract.ListOptions
type TaskRegistry = taskregistry.TaskRegistry

var defaultRegistry TaskRegistrar = &TaskRegistry{}

func GetRegistry() TaskRegistrar {
	return defaultRegistry
}

var SetRegistry = func(registry TaskRegistrar) {
	defaultRegistry = registry
}

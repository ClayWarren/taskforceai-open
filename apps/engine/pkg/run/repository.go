package run

import (
	"github.com/TaskForceAI/adapters/pkg/db"
	runrepository "github.com/TaskForceAI/go-engine/pkg/run/internal/runrepository"
)

type TaskRecord = runrepository.TaskRecord
type Repository = runrepository.Repository

func NewRepositoryFromQueries(q *db.Queries) *Repository {
	return runrepository.NewRepositoryFromQueries(q)
}

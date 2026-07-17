package runrepository

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/core/pkg/orchestrator"
	"github.com/jackc/pgx/v5/pgtype"
)

type TaskRecord struct {
	TaskID    string
	Prompt    string
	UserID    *string
	ModelID   *string
	CreatedAt time.Time
	ExpiresAt time.Time
}

type executionTraceRow struct {
	ID        string
	TaskID    string
	UserID    *int32
	Goal      string
	Plan      []byte
	Steps     []byte
	SelfEval  []byte
	Artifacts []byte
}

type createTaskInput struct {
	TaskID    string
	Prompt    string
	UserID    *string
	ModelID   *string
	ExpiresAt time.Time
}

type taskRow struct {
	TaskID    string
	Prompt    string
	UserID    *string
	ModelID   *string
	CreatedAt time.Time
	ExpiresAt time.Time
}

type upsertExecutionTraceInput struct {
	ID        string
	TaskID    string
	UserID    *int32
	Goal      string
	Plan      []byte
	Steps     []byte
	SelfEval  []byte
	Artifacts []byte
}

type Store interface {
	UpsertExecutionTrace(ctx context.Context, input upsertExecutionTraceInput) error
	GetExecutionTrace(ctx context.Context, taskID string) (executionTraceRow, error)
	CreateTask(ctx context.Context, input createTaskInput) (taskRow, error)
	GetTask(ctx context.Context, taskID string) (taskRow, error)
}

type sqlcRunStore struct {
	q *db.Queries
}

type Repository struct {
	q Store
}

func NewRepository(store Store) *Repository {
	return &Repository{q: store}
}

func NewRepositoryFromQueries(q *db.Queries) *Repository {
	return NewRepository(sqlcRunStore{q: q})
}

func (s sqlcRunStore) UpsertExecutionTrace(ctx context.Context, input upsertExecutionTraceInput) error {
	_, err := s.q.UpsertExecutionTrace(ctx, db.UpsertExecutionTraceParams{
		ID:        input.ID,
		TaskID:    input.TaskID,
		UserID:    input.UserID,
		Goal:      input.Goal,
		Plan:      input.Plan,
		Steps:     input.Steps,
		SelfEval:  input.SelfEval,
		Artifacts: input.Artifacts,
	})
	return err
}

func (s sqlcRunStore) GetExecutionTrace(ctx context.Context, taskID string) (executionTraceRow, error) {
	row, err := s.q.GetExecutionTrace(ctx, taskID)
	if err != nil {
		return executionTraceRow{}, err
	}
	return executionTraceRow{
		ID:        row.ID,
		TaskID:    row.TaskID,
		UserID:    row.UserID,
		Goal:      row.Goal,
		Plan:      row.Plan,
		Steps:     row.Steps,
		SelfEval:  row.SelfEval,
		Artifacts: row.Artifacts,
	}, nil
}

func (s sqlcRunStore) CreateTask(ctx context.Context, input createTaskInput) (taskRow, error) {
	row, err := s.q.CreateTask(ctx, db.CreateTaskParams{
		TaskID:    input.TaskID,
		Prompt:    input.Prompt,
		UserID:    input.UserID,
		ModelID:   input.ModelID,
		ExpiresAt: toTimestamp(input.ExpiresAt),
	})
	if err != nil {
		return taskRow{}, err
	}
	return taskRow{
		TaskID:    row.TaskID,
		Prompt:    row.Prompt,
		UserID:    row.UserID,
		ModelID:   row.ModelID,
		CreatedAt: row.CreatedAt.Time,
		ExpiresAt: row.ExpiresAt.Time,
	}, nil
}

func (s sqlcRunStore) GetTask(ctx context.Context, taskID string) (taskRow, error) {
	row, err := s.q.GetTask(ctx, taskID)
	if err != nil {
		return taskRow{}, err
	}
	return taskRow{
		TaskID:    row.TaskID,
		Prompt:    row.Prompt,
		UserID:    row.UserID,
		ModelID:   row.ModelID,
		CreatedAt: row.CreatedAt.Time,
		ExpiresAt: row.ExpiresAt.Time,
	}, nil
}

func (r *Repository) SaveExecutionTrace(ctx context.Context, trace *orchestrator.ExecutionTrace) error {
	planJSON, err := json.Marshal(trace.Plan)
	if err != nil {
		return fmt.Errorf("marshal trace plan: %w", err)
	}
	stepsJSON, err := json.Marshal(trace.Steps)
	if err != nil {
		return fmt.Errorf("marshal trace steps: %w", err)
	}
	selfEvalJSON, err := json.Marshal(trace.SelfEval)
	if err != nil {
		return fmt.Errorf("marshal trace self-eval: %w", err)
	}
	artifactsJSON, err := json.Marshal(trace.Artifacts)
	if err != nil {
		return fmt.Errorf("marshal trace artifacts: %w", err)
	}

	id := trace.ID
	if id == "" {
		id = fmt.Sprintf("trace_%d", time.Now().UnixNano())
	}

	err = r.q.UpsertExecutionTrace(ctx, upsertExecutionTraceInput{
		ID:        id,
		TaskID:    trace.TaskID,
		UserID:    trace.UserID,
		Goal:      trace.Goal,
		Plan:      planJSON,
		Steps:     stepsJSON,
		SelfEval:  selfEvalJSON,
		Artifacts: artifactsJSON,
	})
	return err
}

func (r *Repository) GetExecutionTrace(ctx context.Context, taskID string) (*orchestrator.ExecutionTrace, error) {
	t, err := r.q.GetExecutionTrace(ctx, taskID)
	if err != nil {
		return nil, err
	}

	var plan []string
	if err := json.Unmarshal(t.Plan, &plan); err != nil {
		return nil, fmt.Errorf("unmarshal trace plan: %w", err)
	}

	var steps []orchestrator.AgentResult
	if err := json.Unmarshal(t.Steps, &steps); err != nil {
		return nil, fmt.Errorf("unmarshal trace steps: %w", err)
	}

	var selfEval map[string]any
	if err := json.Unmarshal(t.SelfEval, &selfEval); err != nil {
		return nil, fmt.Errorf("unmarshal trace self-eval: %w", err)
	}

	var artifacts map[string]any
	if err := json.Unmarshal(t.Artifacts, &artifacts); err != nil {
		return nil, fmt.Errorf("unmarshal trace artifacts: %w", err)
	}

	return &orchestrator.ExecutionTrace{
		ID:        t.ID,
		TaskID:    t.TaskID,
		UserID:    t.UserID,
		Goal:      t.Goal,
		Plan:      plan,
		Steps:     steps,
		SelfEval:  selfEval,
		Artifacts: artifacts,
	}, nil
}

func (r *Repository) CreateTask(ctx context.Context, taskID, prompt string, userID, modelID *string, ttl time.Duration) (*TaskRecord, error) {
	expiresAt := time.Now().Add(ttl)
	t, err := r.q.CreateTask(ctx, createTaskInput{
		TaskID:    taskID,
		Prompt:    prompt,
		UserID:    userID,
		ModelID:   modelID,
		ExpiresAt: expiresAt,
	})
	if err != nil {
		return nil, err
	}

	return &TaskRecord{
		TaskID:    t.TaskID,
		Prompt:    t.Prompt,
		UserID:    t.UserID,
		ModelID:   t.ModelID,
		CreatedAt: t.CreatedAt,
		ExpiresAt: t.ExpiresAt,
	}, nil
}

func (r *Repository) GetTask(ctx context.Context, taskID string) (*TaskRecord, error) {
	t, err := r.q.GetTask(ctx, taskID)
	if err != nil {
		return nil, err
	}

	return &TaskRecord{
		TaskID:    t.TaskID,
		Prompt:    t.Prompt,
		UserID:    t.UserID,
		ModelID:   t.ModelID,
		CreatedAt: t.CreatedAt,
		ExpiresAt: t.ExpiresAt,
	}, nil
}

func toTimestamp(value time.Time) pgtype.Timestamp {
	return pgtype.Timestamp{Time: value, Valid: true}
}

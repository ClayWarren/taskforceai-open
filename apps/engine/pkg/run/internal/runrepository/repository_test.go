package runrepository

import (
	"context"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/adapters/pkg/db/dbtest"
	"github.com/TaskForceAI/core/pkg/orchestrator"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/pashagolub/pgxmock/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNewRepository(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	q := db.New(mock)
	repo := NewRepositoryFromQueries(q)

	assert.NotNil(t, repo)
}

func TestRepository_CreateTask_Success(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	q := db.New(mock)
	repo := NewRepositoryFromQueries(q)
	ctx := context.Background()

	userID := "user_123"
	modelID := "gpt-4"

	columns := []string{"task_id", "prompt", "user_id", "model_id", "created_at", "expires_at"}
	mock.ExpectQuery(`INSERT INTO tasks`).
		WithArgs("task-1", "test prompt", &userID, &modelID, pgxmock.AnyArg()).
		WillReturnRows(pgxmock.NewRows(columns).AddRow(
			"task-1",
			"test prompt",
			&userID,
			&modelID,
			time.Now(),
			time.Now().Add(time.Hour),
		))

	task, err := repo.CreateTask(ctx, "task-1", "test prompt", &userID, &modelID, time.Hour)

	require.NoError(t, err)
	assert.NotNil(t, task)
	assert.Equal(t, "task-1", task.TaskID)
	assert.Equal(t, "test prompt", task.Prompt)
	assert.Equal(t, &userID, task.UserID)
	assert.Equal(t, &modelID, task.ModelID)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestRepository_CreateTask_Error(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	q := db.New(mock)
	repo := NewRepositoryFromQueries(q)
	ctx := context.Background()

	mock.ExpectQuery(`INSERT INTO tasks`).
		WithArgs(pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnError(assert.AnError)

	task, err := repo.CreateTask(ctx, "task-1", "test prompt", nil, nil, time.Hour)

	require.Error(t, err)
	assert.Nil(t, task)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestRepository_GetTask_Success(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	q := db.New(mock)
	repo := NewRepositoryFromQueries(q)
	ctx := context.Background()

	userID := "user_123"
	modelID := "gpt-4"
	createdAt := time.Now().Add(-time.Hour)
	expiresAt := time.Now().Add(time.Hour)

	columns := []string{"task_id", "prompt", "user_id", "model_id", "created_at", "expires_at"}
	mock.ExpectQuery(`SELECT .+ FROM tasks WHERE task_id`).
		WithArgs("task-1").
		WillReturnRows(pgxmock.NewRows(columns).AddRow(
			"task-1",
			"test prompt",
			&userID,
			&modelID,
			createdAt,
			expiresAt,
		))

	task, err := repo.GetTask(ctx, "task-1")

	require.NoError(t, err)
	assert.NotNil(t, task)
	assert.Equal(t, "task-1", task.TaskID)
	assert.Equal(t, "test prompt", task.Prompt)
	assert.Equal(t, &userID, task.UserID)
	assert.Equal(t, &modelID, task.ModelID)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestRepository_GetTask_NotFound(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	q := db.New(mock)
	repo := NewRepositoryFromQueries(q)
	ctx := context.Background()

	mock.ExpectQuery(`SELECT .+ FROM tasks WHERE task_id`).
		WithArgs("nonexistent").
		WillReturnError(assert.AnError)

	task, err := repo.GetTask(ctx, "nonexistent")

	require.Error(t, err)
	assert.Nil(t, task)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestTaskRecord_Struct(t *testing.T) {
	userID := "user_123"
	modelID := "gpt-4"
	now := time.Now()
	later := now.Add(time.Hour)

	record := TaskRecord{
		TaskID:    "task-1",
		Prompt:    "test prompt",
		UserID:    &userID,
		ModelID:   &modelID,
		CreatedAt: now,
		ExpiresAt: later,
	}

	assert.Equal(t, "task-1", record.TaskID)
	assert.Equal(t, "test prompt", record.Prompt)
	assert.Equal(t, &userID, record.UserID)
	assert.Equal(t, &modelID, record.ModelID)
	assert.Equal(t, now, record.CreatedAt)
	assert.Equal(t, later, record.ExpiresAt)
}

func TestRepository_SaveExecutionTrace_Success(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	q := db.New(mock)
	repo := NewRepositoryFromQueries(q)
	ctx := context.Background()

	userID := int32(42)
	trace := &orchestrator.ExecutionTrace{
		TaskID:    "task-trace-1",
		UserID:    &userID,
		Goal:      "Ship feature",
		Plan:      map[string]any{"steps": []string{"analyze", "execute"}},
		Steps:     []map[string]any{{"agent": "planner", "status": "done"}},
		SelfEval:  map[string]any{"confidence": "high"},
		Artifacts: map[string]any{"output": "ok"},
	}

	columns := []string{"id", "task_id", "user_id", "goal", "plan", "steps", "self_eval", "report", "artifacts", "created_at"}
	mock.ExpectQuery(`INSERT INTO execution_traces`).
		WithArgs(
			pgxmock.AnyArg(),
			trace.TaskID,
			trace.UserID,
			trace.Goal,
			pgxmock.AnyArg(),
			pgxmock.AnyArg(),
			pgxmock.AnyArg(),
			pgxmock.AnyArg(),
		).
		WillReturnRows(
			pgxmock.NewRows(columns).AddRow(
				"trace_1",
				trace.TaskID,
				trace.UserID,
				trace.Goal,
				[]byte(`{"steps":["analyze","execute"]}`),
				[]byte(`[{"agent":"planner","status":"done"}]`),
				[]byte(`{"confidence":"high"}`),
				[]byte(`{}`),
				[]byte(`{"output":"ok"}`),
				time.Now(),
			),
		)

	err := repo.SaveExecutionTrace(ctx, trace)
	require.NoError(t, err)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestRepository_SaveExecutionTrace_Error(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	q := db.New(mock)
	repo := NewRepositoryFromQueries(q)
	ctx := context.Background()

	trace := &orchestrator.ExecutionTrace{
		TaskID:    "task-trace-2",
		Goal:      "Handle error",
		Plan:      map[string]any{"step": "prepare"},
		Steps:     []string{"prepare"},
		SelfEval:  map[string]any{"confidence": "low"},
		Artifacts: map[string]any{"output": "none"},
	}

	mock.ExpectQuery(`INSERT INTO execution_traces`).
		WithArgs(
			pgxmock.AnyArg(),
			trace.TaskID,
			trace.UserID,
			trace.Goal,
			pgxmock.AnyArg(),
			pgxmock.AnyArg(),
			pgxmock.AnyArg(),
			pgxmock.AnyArg(),
		).
		WillReturnError(assert.AnError)

	err := repo.SaveExecutionTrace(ctx, trace)
	require.Error(t, err)
	require.ErrorIs(t, err, assert.AnError)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestRepository_SaveExecutionTraceMarshalErrors(t *testing.T) {
	repo := &Repository{}
	ctx := context.Background()

	tests := []struct {
		name  string
		trace *orchestrator.ExecutionTrace
		want  string
	}{
		{
			name:  "plan",
			trace: &orchestrator.ExecutionTrace{Plan: func() {}},
			want:  "marshal trace plan",
		},
		{
			name:  "steps",
			trace: &orchestrator.ExecutionTrace{Plan: map[string]any{}, Steps: func() {}},
			want:  "marshal trace steps",
		},
		{
			name:  "self eval",
			trace: &orchestrator.ExecutionTrace{Plan: map[string]any{}, Steps: []string{}, SelfEval: func() {}},
			want:  "marshal trace self-eval",
		},
		{
			name:  "artifacts",
			trace: &orchestrator.ExecutionTrace{Plan: map[string]any{}, Steps: []string{}, SelfEval: map[string]any{}, Artifacts: func() {}},
			want:  "marshal trace artifacts",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := repo.SaveExecutionTrace(ctx, tt.trace)
			require.ErrorContains(t, err, tt.want)
		})
	}
}

func TestRepository_GetExecutionTrace_UnmarshalErrors(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	repo := NewRepositoryFromQueries(db.New(mock))
	ctx := context.Background()
	now := time.Now()
	ts := pgtype.Timestamp{Time: now, Valid: true}
	userID := int32(9)

	baseRow := func(plan, steps, selfEval, artifacts []byte) *pgxmock.Rows {
		return pgxmock.NewRows([]string{
			"id", "task_id", "user_id", "goal", "plan", "steps", "self_eval", "report", "artifacts", "created_at",
		}).AddRow("trace-1", "task-1", &userID, "goal", plan, steps, selfEval, []byte(`{}`), artifacts, ts)
	}

	mock.ExpectQuery("GetExecutionTrace").WithArgs("task-1").WillReturnRows(baseRow([]byte(`{`), []byte(`[]`), []byte(`{}`), []byte(`{}`)))
	_, err := repo.GetExecutionTrace(ctx, "task-1")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "plan")

	mock.ExpectQuery("GetExecutionTrace").WithArgs("task-1").WillReturnRows(baseRow([]byte(`[]`), []byte(`{`), []byte(`{}`), []byte(`{}`)))
	_, err = repo.GetExecutionTrace(ctx, "task-1")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "steps")

	mock.ExpectQuery("GetExecutionTrace").WithArgs("task-1").WillReturnRows(baseRow([]byte(`[]`), []byte(`[]`), []byte(`{`), []byte(`{}`)))
	_, err = repo.GetExecutionTrace(ctx, "task-1")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "self-eval")

	mock.ExpectQuery("GetExecutionTrace").WithArgs("task-1").WillReturnRows(baseRow([]byte(`[]`), []byte(`[]`), []byte(`{}`), []byte(`{`)))
	_, err = repo.GetExecutionTrace(ctx, "task-1")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "artifacts")

	require.NoError(t, mock.ExpectationsWereMet())
}

func TestRepository_GetExecutionTrace_SuccessAndStoreError(t *testing.T) {
	t.Run("success", func(t *testing.T) {
		mock := dbtest.NewMockPool(t)
		repo := NewRepositoryFromQueries(db.New(mock))
		userID := int32(9)
		mock.ExpectQuery("GetExecutionTrace").WithArgs("task-1").WillReturnRows(
			pgxmock.NewRows([]string{
				"id", "task_id", "user_id", "goal", "plan", "steps", "self_eval", "report", "artifacts", "created_at",
			}).AddRow(
				"trace-1", "task-1", &userID, "goal", []byte(`["plan"]`), []byte(`[]`),
				[]byte(`{"score":1}`), []byte(`{}`), []byte(`{"output":"ok"}`), time.Now(),
			),
		)

		trace, err := repo.GetExecutionTrace(context.Background(), "task-1")
		require.NoError(t, err)
		assert.Equal(t, "trace-1", trace.ID)
		assert.Equal(t, []string{"plan"}, trace.Plan)
		require.NoError(t, mock.ExpectationsWereMet())
	})

	t.Run("store error", func(t *testing.T) {
		mock := dbtest.NewMockPool(t)
		repo := NewRepositoryFromQueries(db.New(mock))
		mock.ExpectQuery("GetExecutionTrace").WithArgs("task-1").WillReturnError(assert.AnError)

		trace, err := repo.GetExecutionTrace(context.Background(), "task-1")
		assert.Nil(t, trace)
		require.ErrorIs(t, err, assert.AnError)
		require.NoError(t, mock.ExpectationsWereMet())
	})
}

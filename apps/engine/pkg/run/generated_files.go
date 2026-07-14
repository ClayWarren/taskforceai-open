package run

import (
	"context"
	"time"

	"github.com/TaskForceAI/core/pkg/agent"
	generatedfiles "github.com/TaskForceAI/go-engine/pkg/run/internal/generatedfiles"
)

type GeneratedFilePersistenceInput = generatedfiles.GeneratedFilePersistenceInput

func persistGeneratedFileArtifacts(ctx context.Context, input GeneratedFilePersistenceInput) ([]agent.ToolEvent, error) {
	return generatedfiles.Persist(ctx, input, generatedfiles.Dependencies{
		DBQueriesGetter: DBQueriesGetter,
		StartObservation: func(ctx context.Context, toolName, mimeType, artifactType string) (context.Context, generatedfiles.ObservationFinisher) {
			fileCtx, span := startGeneratedFileSpan(ctx, toolName, mimeType, artifactType)
			return fileCtx, func(startedAt time.Time, bytes int64, status string, err error) {
				finishGeneratedFileObservation(fileCtx, span, startedAt, toolName, mimeType, artifactType, bytes, status, err)
			}
		},
	})
}

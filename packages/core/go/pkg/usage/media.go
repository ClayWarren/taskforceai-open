package usage

import (
	"context"
	"encoding/json"
	"regexp"
	"strconv"
	"strings"
)

const (
	imageGenerationModelID = "google/gemini-2.5-flash-image"
	videoGenerationModelID = "xai/grok-imagine-video-1.5"
)

var videoDurationPattern = regexp.MustCompile(`(?i)\b(\d{1,2})\s*(?:-| )?(?:s|sec|secs|second|seconds)\b`)

type MediaEventParams struct {
	TaskID         string
	ConversationID *int
	UserID         *string
	OrganizationID *int
	Plan           *string
	Source         string
	Model          string
	Prompt         string
}

// RecordMediaUsage records non-token media billing units after successful generation.
func RecordMediaUsage(ctx context.Context, repo EventRepository, params MediaEventParams) error {
	model := strings.ToLower(strings.TrimSpace(params.Model))
	var quantity, costMicros float64
	var modality, unit string
	metadata := map[string]string{}
	switch model {
	case imageGenerationModelID:
		modality, unit, quantity, costMicros = "image", "images", 1, 39_000
	case videoGenerationModelID:
		duration := videoDurationSeconds(params.Prompt)
		modality, unit, quantity, costMicros = "video", "seconds", float64(duration), float64(duration)*140_000
		metadata["resolution"] = "1280x720"
	default:
		return nil
	}
	metadataJSON, _ := json.Marshal(metadata) //nolint:errchkjson // String map values are always JSON-encodable.
	taskID := params.TaskID
	return repo.CreateUsageEvents(ctx, []EventRow{{
		TaskID: &taskID, ConversationID: params.ConversationID, UserID: params.UserID,
		OrganizationID: params.OrganizationID, Plan: params.Plan, Source: params.Source,
		Modality: modality, Operation: "generation", Model: &model, Quantity: quantity,
		Unit: unit, CostMicros: int64(costMicros), Metadata: metadataJSON,
	}})
}

func videoDurationSeconds(prompt string) int {
	duration := 10
	if match := videoDurationPattern.FindStringSubmatch(prompt); len(match) == 2 {
		if parsed, err := strconv.Atoi(match[1]); err == nil {
			duration = parsed
		}
	}
	return min(15, max(1, duration))
}

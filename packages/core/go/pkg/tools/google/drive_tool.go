package google

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/TaskForceAI/core/pkg/enginecore/util"
	"github.com/TaskForceAI/core/pkg/tools"
)

type GoogleDriveClient interface {
	ListFiles(ctx context.Context, query string) (string, error)
	ReadFile(ctx context.Context, fileID string) (string, error)
}

type ListGoogleDriveFilesTool struct {
	tools.BaseTool
	client GoogleDriveClient
}

func CreateListGoogleDriveFilesTool(client GoogleDriveClient) *ListGoogleDriveFilesTool {
	return &ListGoogleDriveFilesTool{
		BaseTool: *tools.NewBaseTool(
			"google_drive_list",
			"List files in the user's Google Drive. Use a search query to filter files.",
			tools.ToolParameters{
				Type: "object",
				Properties: map[string]any{
					"query": map[string]any{
						"type":        "string",
						"description": "Google Drive search query (e.g., 'name contains \"report\"' or just a filename)",
					},
				},
			},
			nil, // Execute is overridden
		),
		client: client,
	}
}

func (t *ListGoogleDriveFilesTool) Execute(ctx context.Context, args string) (tools.ToolResult, error) {
	if t.client == nil {
		return nil, fmt.Errorf("google drive client not initialized")
	}

	var params struct {
		Query string `json:"query"`
	}
	if err := json.Unmarshal([]byte(args), &params); err != nil {
		return nil, fmt.Errorf("invalid arguments: %w", err)
	}
	res, err := t.client.ListFiles(ctx, params.Query)
	if err != nil {
		return nil, err
	}

	return tools.ToolResult{"content": res}, nil
}

type ReadGoogleDriveFileTool struct {
	tools.BaseTool
	client GoogleDriveClient
}

func CreateReadGoogleDriveFileTool(client GoogleDriveClient) *ReadGoogleDriveFileTool {
	return &ReadGoogleDriveFileTool{
		BaseTool: *tools.NewBaseTool(
			"google_drive_read",
			"Read the content of a specific file from Google Drive using its ID.",
			tools.ToolParameters{
				Type: "object",
				Properties: map[string]any{
					"file_id": map[string]any{
						"type":        "string",
						"description": "The unique ID of the Google Drive file",
					},
				},
				Required: []string{"file_id"},
			},
			nil, // Execute is overridden
		),
		client: client,
	}
}

func (t *ReadGoogleDriveFileTool) Execute(ctx context.Context, args string) (tools.ToolResult, error) {
	if t.client == nil {
		return nil, fmt.Errorf("google drive client not initialized")
	}

	var params struct {
		FileID string `json:"file_id" validate:"required"`
	}
	if err := json.Unmarshal([]byte(args), &params); err != nil {
		return nil, fmt.Errorf("invalid arguments: %w", err)
	}
	if err := util.ValidateStruct(&params); err != nil {
		return nil, fmt.Errorf("invalid arguments: %w", err)
	}
	res, err := t.client.ReadFile(ctx, params.FileID)
	if err != nil {
		return nil, err
	}

	return tools.ToolResult{"content": res}, nil
}

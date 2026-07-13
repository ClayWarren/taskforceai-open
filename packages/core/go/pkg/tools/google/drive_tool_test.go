package google

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type mockDriveClient struct {
	listFiles func(ctx context.Context, query string) (string, error)
	readFile  func(ctx context.Context, fileID string) (string, error)
}

func (m *mockDriveClient) ListFiles(ctx context.Context, query string) (string, error) {
	if m.listFiles == nil {
		return "", nil
	}
	return m.listFiles(ctx, query)
}

func (m *mockDriveClient) ReadFile(ctx context.Context, fileID string) (string, error) {
	if m.readFile == nil {
		return "", nil
	}
	return m.readFile(ctx, fileID)
}

func TestListGoogleDriveFilesToolExecute(t *testing.T) {
	called := false
	tool := CreateListGoogleDriveFilesTool(&mockDriveClient{
		listFiles: func(ctx context.Context, query string) (string, error) {
			called = true
			assert.Equal(t, "name contains 'report'", query)
			return "file-a,file-b", nil
		},
	})

	result, err := tool.Execute(context.Background(), `{"query":"name contains 'report'"}`)
	require.NoError(t, err)
	assert.True(t, called)
	assert.Equal(t, "file-a,file-b", result["content"])
}

func TestListGoogleDriveFilesToolErrors(t *testing.T) {
	toolWithoutClient := CreateListGoogleDriveFilesTool(nil)
	result, err := toolWithoutClient.Execute(context.Background(), `{}`)
	require.Error(t, err)
	assert.Nil(t, result)
	assert.Contains(t, err.Error(), "not initialized")

	toolWithClient := CreateListGoogleDriveFilesTool(&mockDriveClient{})
	result, err = toolWithClient.Execute(context.Background(), "not-json")
	require.Error(t, err)
	assert.Nil(t, result)
	assert.Contains(t, err.Error(), "invalid arguments")

	toolWithClient = CreateListGoogleDriveFilesTool(&mockDriveClient{
		listFiles: func(ctx context.Context, query string) (string, error) {
			return "", errors.New("drive unavailable")
		},
	})
	result, err = toolWithClient.Execute(context.Background(), `{"query":"report"}`)
	require.Error(t, err)
	assert.Nil(t, result)
	assert.EqualError(t, err, "drive unavailable")
}

func TestReadGoogleDriveFileToolExecute(t *testing.T) {
	called := false
	tool := CreateReadGoogleDriveFileTool(&mockDriveClient{
		readFile: func(ctx context.Context, fileID string) (string, error) {
			called = true
			assert.Equal(t, "file-123", fileID)
			return "file content", nil
		},
	})

	result, err := tool.Execute(context.Background(), `{"file_id":"file-123"}`)
	require.NoError(t, err)
	assert.True(t, called)
	assert.Equal(t, "file content", result["content"])
}

func TestReadGoogleDriveFileToolValidationAndClientError(t *testing.T) {
	toolWithoutClient := CreateReadGoogleDriveFileTool(nil)
	result, err := toolWithoutClient.Execute(context.Background(), `{"file_id":"file-123"}`)
	require.Error(t, err)
	assert.Nil(t, result)
	assert.Contains(t, err.Error(), "not initialized")

	tool := CreateReadGoogleDriveFileTool(&mockDriveClient{})

	result, err = tool.Execute(context.Background(), "not-json")
	require.Error(t, err)
	assert.Nil(t, result)
	assert.Contains(t, err.Error(), "invalid arguments")

	result, err = tool.Execute(context.Background(), `{}`)
	require.Error(t, err)
	assert.Nil(t, result)
	assert.Contains(t, err.Error(), "invalid arguments")

	tool = CreateReadGoogleDriveFileTool(&mockDriveClient{
		readFile: func(ctx context.Context, fileID string) (string, error) {
			return "", errors.New("drive unavailable")
		},
	})

	result, err = tool.Execute(context.Background(), `{"file_id":"file-123"}`)
	require.Error(t, err)
	assert.Nil(t, result)
	assert.EqualError(t, err, "drive unavailable")
}

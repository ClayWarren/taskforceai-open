package attachments

import (
	"context"
	"errors"
	"io"
	"testing"
	"time"

	"github.com/TaskForceAI/core/pkg/agent"
	coreengine "github.com/TaskForceAI/core/pkg/engine"
	redis "github.com/TaskForceAI/infrastructure/redis/pkg"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type nativeUploader struct {
	uri string
	err error
}

func (u *nativeUploader) CreateChatCompletion(context.Context, agent.ChatCompletionCreateParams) (*agent.ChatCompletion, error) {
	return nil, nil
}

func (u *nativeUploader) CreateChatCompletionStream(context.Context, agent.ChatCompletionCreateParams, func(agent.ChatCompletionChunk)) error {
	return nil
}

func (u *nativeUploader) UploadFile(context.Context, io.Reader, string, string) (string, error) {
	return u.uri, u.err
}

func TestAttachmentContentAndValidationCoverage(t *testing.T) {
	empty := BuildUserMessage("hello", Attachments{})
	assert.Equal(t, "hello", empty.Content)

	files := []FileAttachment{
		{ID: "image", Name: "image.png", MimeType: "image/png", Data: []byte("img")},
		{ID: "wav", Name: "audio.wav", MimeType: "audio/wav", Data: []byte("wav")},
		{ID: "mp3", Name: "audio.mp3", MimeType: "audio/mpeg", Data: []byte("mp3")},
		{ID: "video", Name: "video.mp4", MimeType: "video/mp4", Data: []byte("video")},
		{ID: "pdf", Name: "doc.pdf", MimeType: "application/pdf", Data: []byte("pdf")},
		{ID: "raw", Name: "raw.bin", MimeType: "application/octet-stream", Data: []byte("raw")},
	}
	attachments := Attachments{Files: files}
	msg := BuildUserMessage("hello", attachments)
	assert.Equal(t, agent.RoleUser, msg.Role)
	assert.Len(t, msg.ContentParts, 6)
	parts := ContentParts(attachments)
	assert.Len(t, parts, 5)
	assert.Equal(t, agent.ContentPartImageURL, parts[0].Type)
	assert.Equal(t, "wav", parts[1].InputAudio.Format)
	assert.Equal(t, "mp3", parts[2].InputAudio.Format)
	assert.Equal(t, "video", parts[3].FileData.FileURI)

	require.NoError(t, ValidateTaskAttachments(Attachments{}))
	require.NoError(t, ValidateTaskAttachments(Attachments{Files: files[:1]}))
	tooMany := make([]FileAttachment, coreengine.MaxAttachments+1)
	require.Error(t, ValidateTaskAttachments(Attachments{Files: tooMany}))
	require.Error(t, ValidateTaskAttachments(Attachments{Files: []FileAttachment{{MimeType: "application/octet-stream"}}}))
	require.Error(t, ValidateTaskAttachments(Attachments{Files: []FileAttachment{{Name: "large.png", MimeType: "image/png", Data: make([]byte, coreengine.MaxAttachmentBytes+1)}}}))
	total := make([]FileAttachment, 2)
	for i := range total {
		total[i] = FileAttachment{Name: "large.mp4", MimeType: "video/mp4", Data: make([]byte, coreengine.MaxTotalAttachmentBytes/2+1)}
	}
	require.Error(t, ValidateTaskAttachments(Attachments{Files: total}))
}

func TestAttachmentStorageAndFetchCoverage(t *testing.T) {
	ctx := context.Background()
	client := redis.NewMockClient()
	deps := attachmentTestDependencies(client)
	collection := Attachments{Files: []FileAttachment{{ID: "file-1", Name: "one.png", MimeType: "image/png"}}}

	require.NoError(t, StoreFile(ctx, "file-1", []byte("blob"), time.Minute, deps))
	require.NoError(t, StoreCollection(ctx, collection, "task-1", time.Minute, deps))
	got, err := GetFile(ctx, "file-1", deps)
	require.NoError(t, err)
	assert.Equal(t, []byte("blob"), got)
	fetched, err := Fetch(ctx, "task-1", deps)
	require.NoError(t, err)
	assert.Equal(t, []byte("blob"), fetched.Files[0].Data)

	missing, err := Fetch(ctx, "missing", deps)
	require.NoError(t, err)
	assert.Empty(t, missing.Files)
	require.NoError(t, client.Set(ctx, AttachmentKeyPrefix+"bad", []byte("{"), time.Minute))
	bad, err := Fetch(ctx, "bad", deps)
	require.NoError(t, err)
	assert.Empty(t, bad.Files)
	missingBlobCollection := Attachments{Files: []FileAttachment{{ID: "file-missing", Name: "missing.png", MimeType: "image/png"}}}
	require.NoError(t, StoreCollection(ctx, missingBlobCollection, "missing-blob", time.Minute, deps))
	_, err = Fetch(ctx, "missing-blob", deps)
	require.Error(t, err)

	unavailable := attachmentTestDependencies(nil)
	unavailable.RedisClient = func() (redis.Cmdable, error) { return nil, errors.New("offline") }
	fetched, err = Fetch(ctx, "task", unavailable)
	require.NoError(t, err)
	assert.Empty(t, fetched.Files)
	require.Error(t, StoreCollection(ctx, collection, "task", time.Minute, unavailable))
	require.Error(t, StoreFile(ctx, "file", nil, time.Minute, unavailable))
	_, err = GetFile(ctx, "file", unavailable)
	require.Error(t, err)

	marshalFailure := attachmentTestDependencies(client)
	marshalFailure.MarshalCollection = func(any) ([]byte, error) { return nil, errors.New("encode") }
	require.Error(t, StoreCollection(ctx, collection, "task", time.Minute, marshalFailure))
	setFailure := attachmentTestDependencies(&attachmentSetFailClient{MockClient: redis.NewMockClient()})
	require.Error(t, StoreCollection(ctx, collection, "task", time.Minute, setFailure))
	require.Error(t, StoreFile(ctx, "file", nil, time.Minute, setFailure))
	getFailure := attachmentTestDependencies(&attachmentGetFailClient{MockClient: redis.NewMockClient()})
	_, err = GetFile(ctx, "file", getFailure)
	require.Error(t, err)
	_, err = Fetch(ctx, "task", getFailure)
	require.NoError(t, err)
}

func TestUploadNativeCoverage(t *testing.T) {
	ctx := context.Background()
	collection := &Attachments{Files: []FileAttachment{
		{ID: "local-video", Name: "video.mp4", MimeType: "video/mp4", Data: []byte("video")},
		{ID: "file-existing", Name: "existing.pdf", MimeType: "application/pdf"},
		{ID: "raw", Name: "raw.bin", MimeType: "application/octet-stream"},
	}}
	uploader := &nativeUploader{uri: "file-uploaded"}
	require.NoError(t, UploadNative(ctx, uploader, "model", collection))
	assert.Equal(t, "file-uploaded", collection.Files[0].ID)
	require.NoError(t, UploadNative(ctx, uploader, "model", &Attachments{}))
	require.NoError(t, UploadNative(ctx, nil, "model", collection))

	uploader.err = errors.New("upload failed")
	collection.Files[0].ID = "retry-video"
	require.Error(t, UploadNative(ctx, uploader, "model", collection))
	assert.True(t, attachmentAlreadyUploaded("https://example.com/file"))
	assert.False(t, attachmentAlreadyUploaded("local"))
	assert.True(t, shouldUploadNatively("application/pdf"))
	assert.False(t, shouldUploadNatively("application/octet-stream"))
}

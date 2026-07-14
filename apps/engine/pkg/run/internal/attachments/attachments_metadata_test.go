package attachments

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	redis "github.com/TaskForceAI/infrastructure/redis/pkg"
)

func attachmentTestDependencies(client redis.Cmdable) Dependencies {
	return Dependencies{
		RedisClient:       func() (redis.Cmdable, error) { return client, nil },
		MarshalCollection: json.Marshal,
		MarshalInfo:       json.Marshal,
	}
}

type attachmentSetFailClient struct{ *redis.MockClient }

func (c *attachmentSetFailClient) Set(context.Context, string, []byte, time.Duration) error {
	return errors.New("set failed")
}

type attachmentGetFailClient struct{ *redis.MockClient }

func (c *attachmentGetFailClient) Get(context.Context, string) (string, error) {
	return "", errors.New("get failed")
}

func TestNormalizeUploadedAttachmentMIME_OfficeZipByExtension(t *testing.T) {
	got := NormalizeUploadedAttachmentMIME("report.docx", "application/zip")
	want := "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
	if got != want {
		t.Fatalf("expected %q, got %q", want, got)
	}
}

func TestNormalizeUploadedAttachmentMIME_CSVFromTextPlain(t *testing.T) {
	got := NormalizeUploadedAttachmentMIME("data.csv", "text/plain; charset=utf-8")
	if got != "text/csv" {
		t.Fatalf("expected text/csv, got %q", got)
	}
}

func TestNormalizeUploadedAttachmentMIME_PreservesKnownMime(t *testing.T) {
	got := NormalizeUploadedAttachmentMIME("image.png", "image/png")
	if got != "image/png" {
		t.Fatalf("expected image/png, got %q", got)
	}
}

func TestAttachmentMIMESupport(t *testing.T) {
	if !IsSupportedDocumentMIME("application/pdf") {
		t.Fatal("expected PDF to be supported")
	}
	if IsSupportedDocumentMIME("application/zip") {
		t.Fatal("expected zip to be rejected as document MIME")
	}
}

func TestAttachmentContentPartRejectsUnsupportedMime(t *testing.T) {
	_, ok := ContentPart(FileAttachment{
		ID:       "file-raw",
		MimeType: "application/octet-stream",
		Data:     []byte("raw"),
	})
	if ok {
		t.Fatal("expected unsupported MIME to be rejected")
	}
}

func TestStoreAndGetAttachmentInfo(t *testing.T) {
	deps := attachmentTestDependencies(redis.NewMockClient())

	info := AttachmentInfo{MimeType: "text/plain", Name: "notes.txt", Size: 5}
	if err := StoreInfo(context.Background(), "file-1", info, time.Minute, deps); err != nil {
		t.Fatalf("store metadata: %v", err)
	}

	got, found, err := GetInfo(context.Background(), "file-1", deps)
	if err != nil {
		t.Fatalf("get metadata: %v", err)
	}
	if !found || got == nil || got.Name != "notes.txt" || got.MimeType != "text/plain" || got.Size != 5 {
		t.Fatalf("unexpected metadata: %#v", got)
	}
}

func TestStoreAndGetAttachmentInfoErrors(t *testing.T) {
	deps := attachmentTestDependencies(redis.NewMockClient())
	deps.MarshalInfo = func(any) ([]byte, error) { return nil, errors.New("encode failed") }
	if err := StoreInfo(context.Background(), "encode-fail", AttachmentInfo{}, time.Minute, deps); err == nil || !strings.Contains(err.Error(), "encode attachment metadata") {
		t.Fatalf("expected metadata encode failure, got %v", err)
	}

	unavailableDeps := attachmentTestDependencies(nil)
	unavailableDeps.RedisClient = func() (redis.Cmdable, error) { return nil, errors.New("redis offline") }
	if err := StoreInfo(context.Background(), "file-1", AttachmentInfo{}, time.Minute, unavailableDeps); err == nil || !strings.Contains(err.Error(), "redis unavailable") {
		t.Fatalf("expected redis unavailable storing metadata, got %v", err)
	}
	if info, found, err := GetInfo(context.Background(), "file-1", unavailableDeps); err == nil || found || info != nil {
		t.Fatalf("expected redis unavailable loading metadata, got info=%#v err=%v", info, err)
	}

	mockRedis := redis.NewMockClient()
	deps = attachmentTestDependencies(mockRedis)
	if info, found, err := GetInfo(context.Background(), "missing", deps); err != nil || found || info != nil {
		t.Fatalf("missing metadata should return nil without error, got info=%#v err=%v", info, err)
	}
	if err := mockRedis.Set(context.Background(), AttachmentInfoKeyPrefix+"blank", []byte("   "), time.Minute); err != nil {
		t.Fatalf("seed blank metadata: %v", err)
	}
	if info, found, err := GetInfo(context.Background(), "blank", deps); err != nil || found || info != nil {
		t.Fatalf("blank metadata should return nil without error, got info=%#v err=%v", info, err)
	}
	if err := mockRedis.Set(context.Background(), AttachmentInfoKeyPrefix+"bad", []byte("{"), time.Minute); err != nil {
		t.Fatalf("seed bad metadata: %v", err)
	}
	if info, found, err := GetInfo(context.Background(), "bad", deps); err == nil || found || info != nil {
		t.Fatalf("invalid metadata should fail, got info=%#v err=%v", info, err)
	}

	deps = attachmentTestDependencies(&attachmentSetFailClient{MockClient: redis.NewMockClient()})
	if err := StoreInfo(context.Background(), "set-fail", AttachmentInfo{}, time.Minute, deps); err == nil || !strings.Contains(err.Error(), "failed to store attachment metadata") {
		t.Fatalf("expected store failure, got %v", err)
	}

	deps = attachmentTestDependencies(&attachmentGetFailClient{MockClient: redis.NewMockClient()})
	if info, found, err := GetInfo(context.Background(), "get-fail", deps); err == nil || found || info != nil {
		t.Fatalf("expected get failure, got info=%#v err=%v", info, err)
	}
}

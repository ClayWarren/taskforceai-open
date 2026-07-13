package run

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	redis "github.com/TaskForceAI/infrastructure/redis/pkg"
)

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
	if !isSupportedDocumentMIME("application/pdf") {
		t.Fatal("expected PDF to be supported")
	}
	if isSupportedDocumentMIME("application/zip") {
		t.Fatal("expected zip to be rejected as document MIME")
	}
}

func TestAttachmentContentPartRejectsUnsupportedMime(t *testing.T) {
	_, ok := attachmentContentPart(FileAttachment{
		ID:       "file-raw",
		MimeType: "application/octet-stream",
		Data:     []byte("raw"),
	})
	if ok {
		t.Fatal("expected unsupported MIME to be rejected")
	}
}

func TestStoreAndGetAttachmentInfo(t *testing.T) {
	withMockRedis(t)

	info := AttachmentInfo{MimeType: "text/plain", Name: "notes.txt", Size: 5}
	if err := StoreAttachmentInfo(context.Background(), "file-1", info, time.Minute); err != nil {
		t.Fatalf("store metadata: %v", err)
	}

	got, found, err := GetAttachmentInfo(context.Background(), "file-1")
	if err != nil {
		t.Fatalf("get metadata: %v", err)
	}
	if !found || got == nil || got.Name != "notes.txt" || got.MimeType != "text/plain" || got.Size != 5 {
		t.Fatalf("unexpected metadata: %#v", got)
	}
}

func TestStoreAndGetAttachmentInfoErrors(t *testing.T) {
	restore(t, &marshalAttachmentInfo)
	marshalAttachmentInfo = func(any) ([]byte, error) { return nil, errors.New("encode failed") }
	withMockRedis(t)
	if err := StoreAttachmentInfo(context.Background(), "encode-fail", AttachmentInfo{}, time.Minute); err == nil || !strings.Contains(err.Error(), "encode attachment metadata") {
		t.Fatalf("expected metadata encode failure, got %v", err)
	}
	marshalAttachmentInfo = json.Marshal

	withUnavailableRedis(t, errors.New("redis offline"))
	if err := StoreAttachmentInfo(context.Background(), "file-1", AttachmentInfo{}, time.Minute); err == nil || !strings.Contains(err.Error(), "redis unavailable") {
		t.Fatalf("expected redis unavailable storing metadata, got %v", err)
	}
	if info, found, err := GetAttachmentInfo(context.Background(), "file-1"); err == nil || found || info != nil {
		t.Fatalf("expected redis unavailable loading metadata, got info=%#v err=%v", info, err)
	}

	mockRedis := withMockRedis(t)
	if info, found, err := GetAttachmentInfo(context.Background(), "missing"); err != nil || found || info != nil {
		t.Fatalf("missing metadata should return nil without error, got info=%#v err=%v", info, err)
	}
	if err := mockRedis.Set(context.Background(), AttachmentInfoKeyPrefix+"blank", []byte("   "), time.Minute); err != nil {
		t.Fatalf("seed blank metadata: %v", err)
	}
	if info, found, err := GetAttachmentInfo(context.Background(), "blank"); err != nil || found || info != nil {
		t.Fatalf("blank metadata should return nil without error, got info=%#v err=%v", info, err)
	}
	if err := mockRedis.Set(context.Background(), AttachmentInfoKeyPrefix+"bad", []byte("{"), time.Minute); err != nil {
		t.Fatalf("seed bad metadata: %v", err)
	}
	if info, found, err := GetAttachmentInfo(context.Background(), "bad"); err == nil || found || info != nil {
		t.Fatalf("invalid metadata should fail, got info=%#v err=%v", info, err)
	}

	setRedisClientGetterForTest(t, func() (redis.Cmdable, error) {
		return &approvalSetFailClient{MockClient: redis.NewMockClient()}, nil
	})
	if err := StoreAttachmentInfo(context.Background(), "set-fail", AttachmentInfo{}, time.Minute); err == nil || !strings.Contains(err.Error(), "failed to store attachment metadata") {
		t.Fatalf("expected store failure, got %v", err)
	}

	setRedisClientGetterForTest(t, func() (redis.Cmdable, error) {
		return &redisGetFailClient{MockClient: redis.NewMockClient()}, nil
	})
	if info, found, err := GetAttachmentInfo(context.Background(), "get-fail"); err == nil || found || info != nil {
		t.Fatalf("expected get failure, got info=%#v err=%v", info, err)
	}
}

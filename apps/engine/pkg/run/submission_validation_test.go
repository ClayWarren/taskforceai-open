package run

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSubmitTask_ValidationAndStorageErrors(t *testing.T) {
	registry := &captureRegistry{}
	sender := &captureInngest{}

	_, err := SubmitTask(context.Background(), TaskSubmissionRequest{
		UserID:  1,
		Prompt:  "hello",
		ModelID: "openai/gpt-5.6-sol",
		Attachments: Attachments{
			Files: []FileAttachment{{Data: []byte("hello"), MimeType: "image/bmp", Name: "bad.bmp"}},
		},
	}, TaskSubmissionDeps{
		Registry: registry,
		Inngest:  sender,
	})
	if err == nil {
		t.Fatal("expected validation error")
	}
	var subErr *TaskSubmissionError
	if !errors.As(err, &subErr) || subErr.Code != TaskSubmissionValidation {
		t.Fatalf("expected validation TaskSubmissionError, got %v", err)
	}

	_, err = SubmitTask(context.Background(), TaskSubmissionRequest{
		UserID:  1,
		Prompt:  "hello",
		ModelID: "openai/gpt-5.6-sol",
		Attachments: Attachments{
			Files: []FileAttachment{{Data: []byte("hello"), MimeType: "video/mp4", Name: "clip.mp4"}},
		},
	}, TaskSubmissionDeps{
		Registry: registry,
		Inngest:  sender,
	})
	if err == nil {
		t.Fatal("expected video-model validation error")
	}

	_, err = SubmitTask(context.Background(), TaskSubmissionRequest{
		UserID:  1,
		Prompt:  "animate this clip",
		ModelID: "xai/grok-imagine-video-1.5",
		Attachments: Attachments{
			Files: []FileAttachment{{Data: []byte("hello"), MimeType: "video/mp4", Name: "clip.mp4"}},
		},
	}, TaskSubmissionDeps{
		Registry: registry,
		Inngest:  sender,
	})
	if err == nil {
		t.Fatal("expected Grok video-model validation error")
	}

	_, err = SubmitTask(context.Background(), TaskSubmissionRequest{
		UserID:  1,
		Prompt:  "hello",
		ModelID: "google/gemini-3.1-pro-preview",
		Attachments: Attachments{
			Files: []FileAttachment{{Data: []byte("hello"), MimeType: "image/png", Name: "ok.png"}},
		},
	}, TaskSubmissionDeps{
		Registry: registry,
		Inngest:  sender,
		StoreAttachments: func(ctx context.Context, attachments Attachments, taskID string) error {
			return errors.New("storage failed")
		},
	})
	if err == nil {
		t.Fatal("expected storage error")
	}
	if !errors.As(err, &subErr) || subErr.Code != TaskSubmissionStorage {
		t.Fatalf("expected storage TaskSubmissionError, got %v", err)
	}
}

func TestSubmitTask_VideoRequiresVideoCapableModel(t *testing.T) {
	_, err := SubmitTask(context.Background(), TaskSubmissionRequest{
		UserID:  1,
		Prompt:  "analyze",
		ModelID: "openai/gpt-5.6-sol",
		Attachments: Attachments{
			Files: []FileAttachment{{MimeType: "video/mp4", Name: "clip.mp4", Data: []byte("v")}},
		},
	}, TaskSubmissionDeps{
		Registry: &captureRegistry{tasks: map[string]*TaskState{}},
		Inngest:  &captureInngest{},
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "video-capable")
}

func TestTaskSubmissionErrorUnwrap(t *testing.T) {
	inner := errors.New("inner failure")
	wrapped := &TaskSubmissionError{Err: inner}
	assert.Equal(t, inner, wrapped.Unwrap())
	assert.Equal(t, "inner failure", wrapped.Error())

	var nilErr *TaskSubmissionError
	assert.NoError(t, nilErr.Unwrap())
}

func TestTaskSubmissionErrorUnwrapNil(t *testing.T) {
	var err *TaskSubmissionError
	assert.NoError(t, err.Unwrap())
}

func TestTaskSubmissionError_Methods(t *testing.T) {
	var nilErr *TaskSubmissionError
	if nilErr.Error() != "task submission failed" {
		t.Fatalf("unexpected nil error message: %s", nilErr.Error())
	}
	if nilErr.Unwrap() != nil {
		t.Fatal("expected nil unwrap for nil receiver")
	}

	err := &TaskSubmissionError{Code: TaskSubmissionQueue, Err: errors.New("failed")}
	if err.Error() != "failed" {
		t.Fatalf("unexpected wrapped error message: %s", err.Error())
	}
}

func TestTaskSubmissionIdempotencyHelpers(t *testing.T) {
	withUnavailableRedis(t, errors.New("redis offline"))
	_, reserved, err := reserveTaskSubmissionIdempotency(context.Background(), 7, "key", "task-1")
	if err == nil || reserved {
		t.Fatalf("expected reservation error, reserved=%v err=%v", reserved, err)
	}
	if err := releaseTaskSubmissionIdempotency(context.Background(), 7, "key"); err == nil {
		t.Fatal("expected release error")
	}

	withMockRedis(t)
	taskID, reserved, err := reserveTaskSubmissionIdempotency(context.Background(), 7, "key", "task-1")
	if err != nil || !reserved || taskID != "task-1" {
		t.Fatalf("expected first reservation success, taskID=%q reserved=%v err=%v", taskID, reserved, err)
	}
	taskID, reserved, err = reserveTaskSubmissionIdempotency(context.Background(), 7, "key", "task-2")
	if err != nil || reserved || taskID != "task-1" {
		t.Fatalf("expected existing reservation, taskID=%q reserved=%v err=%v", taskID, reserved, err)
	}
	if err := releaseTaskSubmissionIdempotency(context.Background(), 7, "key"); err != nil {
		t.Fatalf("release reservation: %v", err)
	}
}

func TestValidateTaskAttachments(t *testing.T) {
	tooMany := make([]FileAttachment, MaxAttachments+1)
	for i := range tooMany {
		tooMany[i] = FileAttachment{Data: []byte("hello"), MimeType: "image/png", Name: "img"}
	}

	cases := []struct {
		name    string
		files   []FileAttachment
		wantErr string // empty means the attachments are expected to be valid
	}{
		{"binary image", []FileAttachment{{Data: []byte("raw"), MimeType: "image/png", Name: "raw.png"}}, ""},
		{"text plain", []FileAttachment{{Data: []byte("hello"), MimeType: "text/plain", Name: "notes.txt"}}, ""},
		{"too many attachments", tooMany, "too many attachments"},
		{"unsupported audio", []FileAttachment{{Data: []byte("hello"), MimeType: "audio/aac", Name: "bad.aac"}}, "unsupported audio format"},
		{"unsupported video", []FileAttachment{{Data: []byte("hello"), MimeType: "video/avi", Name: "bad.avi"}}, "unsupported video type"},
		{"unsupported type", []FileAttachment{{Data: []byte("zip"), MimeType: "application/zip", Name: "archive.zip"}}, "unsupported attachment type"},
		{"image too large", []FileAttachment{{Data: make([]byte, MaxAttachmentBytes+1), MimeType: "image/png", Name: "big.png"}}, "exceeds maximum size of 20 MB"},
		{"audio too large", []FileAttachment{{Data: make([]byte, MaxAttachmentBytes+1), MimeType: "audio/wav", Name: "big.wav"}}, "exceeds maximum size of 20 MB"},
		{"video too large", []FileAttachment{{Data: make([]byte, MaxVideoBytes+1), MimeType: "video/mp4", Name: "big.mp4"}}, "exceeds maximum size of 100 MB"},
		{"total payload too large", []FileAttachment{
			{Data: make([]byte, (MaxTotalAttachmentBytes/2)+1), MimeType: "video/mp4", Name: "v1.mp4"},
			{Data: make([]byte, MaxTotalAttachmentBytes/2), MimeType: "video/mp4", Name: "v2.mp4"},
		}, "total attachment payload exceeds maximum size"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := ValidateTaskAttachments(Attachments{Files: tc.files})
			if tc.wantErr == "" {
				require.NoError(t, err)
				return
			}
			require.Error(t, err)
			assert.Contains(t, err.Error(), tc.wantErr)
		})
	}
}

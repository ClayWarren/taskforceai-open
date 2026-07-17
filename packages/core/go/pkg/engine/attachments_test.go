package engine

import "testing"

func TestAttachmentMIMEPolicy(t *testing.T) {
	tests := []struct {
		name          string
		mime          string
		wantLimit     int64
		wantSupported bool
		wantTemplate  string
	}{
		{name: "image", mime: "image/png", wantLimit: MaxAttachmentBytes, wantSupported: true},
		{name: "video", mime: "video/mp4", wantLimit: MaxVideoAttachmentBytes, wantSupported: true},
		{name: "audio", mime: "audio/mpeg; charset=utf-8", wantLimit: MaxAttachmentBytes, wantSupported: true},
		{name: "document", mime: "application/pdf", wantLimit: MaxAttachmentBytes, wantSupported: true},
		{name: "spreadsheet", mime: "text/csv", wantLimit: MaxAttachmentBytes, wantSupported: true},
		{name: "unsupported video", mime: "video/avi", wantLimit: MaxVideoAttachmentBytes, wantTemplate: `unsupported video type "%s"; allowed: video/mp4, video/webm`},
		{name: "unsupported image", mime: "image/bmp", wantLimit: MaxAttachmentBytes, wantTemplate: `unsupported image type "%s"; allowed: image/jpeg, image/png, image/gif, image/webp`},
		{name: "unsupported audio", mime: "audio/aac", wantLimit: MaxAttachmentBytes, wantTemplate: `unsupported audio format "%s"; allowed: wav, mp3, webm, ogg`},
		{name: "unsupported generic", mime: "application/zip", wantLimit: MaxAttachmentBytes, wantTemplate: `unsupported attachment type "%s"`},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			limit, supported, template := AttachmentByteLimit(tt.mime)
			if limit != tt.wantLimit {
				t.Fatalf("limit = %d; want %d", limit, tt.wantLimit)
			}
			if supported != tt.wantSupported {
				t.Fatalf("supported = %v; want %v", supported, tt.wantSupported)
			}
			if template != tt.wantTemplate {
				t.Fatalf("template = %q; want %q", template, tt.wantTemplate)
			}
		})
	}
}

func TestAttachmentHelperEdges(t *testing.T) {
	if IsSupportedAudioAttachmentMIME(" text/plain ") {
		t.Fatal("expected non-audio MIME to be rejected")
	}
	if !IsVideoAttachmentMIME(" video/mp4; codecs=h264 ") {
		t.Fatal("expected video MIME to be detected")
	}
	if got := filenameExtension(" "); got != "" {
		t.Fatalf("blank filename extension = %q; want empty", got)
	}
	if got := filenameExtension("archive."); got != "" {
		t.Fatalf("trailing dot extension = %q; want empty", got)
	}
	if got := filenameExtension(`/tmp/report.final.pdf`); got != ".pdf" {
		t.Fatalf("path filename extension = %q; want .pdf", got)
	}
}

func TestNormalizeUploadedAttachmentMIME(t *testing.T) {
	tests := []struct {
		name     string
		filename string
		detected string
		want     string
	}{
		{name: "docx zip", filename: "report.docx", detected: "application/zip", want: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"},
		{name: "xlsx octet stream", filename: `C:\temp\sheet.xlsx`, detected: "application/octet-stream", want: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"},
		{name: "csv plain text", filename: "data.csv", detected: "text/plain; charset=utf-8", want: "text/csv"},
		{name: "known image", filename: "image.png", detected: " image/png ", want: "image/png"},
		{name: "unknown keeps normalized mime", filename: "archive.zip", detected: "application/zip; charset=binary", want: "application/zip"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := NormalizeUploadedAttachmentMIME(tt.filename, tt.detected); got != tt.want {
				t.Fatalf("mime = %q; want %q", got, tt.want)
			}
		})
	}
}

func TestAttachmentModelPolicy(t *testing.T) {
	if !ModelSupportsVideoAttachments(" google/Gemini-3.1-pro ") {
		t.Fatal("expected Gemini models to support video attachments")
	}
	if ModelSupportsVideoAttachments("openai/gpt-5") {
		t.Fatal("expected non-video-capable model to reject video attachments")
	}
	if !IsMediaGenerationModelID(VideoGenerationModelID) {
		t.Fatal("expected video generation model to be media generation")
	}
	if !IsMediaGenerationModelID("google/gemini-2.5-flash-image-preview") {
		t.Fatal("expected image generation model marker to be media generation")
	}
	if !IsImageGenerationModelID("google/gemini-2.5-flash-image-preview") {
		t.Fatal("expected image generation model marker to be image generation")
	}
	if IsImageGenerationModelID(VideoGenerationModelID) {
		t.Fatal("expected video generation model not to be image generation")
	}
	if got := NormalizeImageGenerationModelID("google/gemini-2.5-flash-image"); got != ImageGenerationModelID {
		t.Fatalf("canonical image generation model = %q; want %q", got, ImageGenerationModelID)
	}
	if got := NormalizeImageGenerationModelID(" gemini-2.5-flash-image "); got != ImageGenerationModelID {
		t.Fatalf("canonical short image generation model = %q; want %q", got, ImageGenerationModelID)
	}
	if got := NormalizeImageGenerationModelID(" google/other-image-model "); got != "google/other-image-model" {
		t.Fatalf("non-image model = %q; want trimmed model", got)
	}
}

package orchestrator

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestIsGeneratedFileRequestExportedAPI(t *testing.T) {
	tests := []struct {
		name string
		text string
		want bool
	}{
		{
			name: "spreadsheet request",
			text: "Create an XLSX forecast workbook",
			want: true,
		},
		{
			name: "chart image request",
			text: "Generate a chart image for revenue by month",
			want: true,
		},
		{
			name: "mentions file type without action",
			text: "Can you explain what a CSV is?",
			want: false,
		},
		{
			name: "action without downloadable file",
			text: "Create a summary of the meeting",
			want: false,
		},
		{
			name: "empty punctuation",
			text: "?!",
			want: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, IsGeneratedFileRequest(tt.text))
		})
	}
}

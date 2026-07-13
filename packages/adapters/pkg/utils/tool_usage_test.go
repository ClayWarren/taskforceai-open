package utils

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestToolUsageUtils(t *testing.T) {
	t.Run("IsCodeExecutionEvent", func(t *testing.T) {
		name := "execute_code"
		assert.True(t, IsCodeExecutionEvent(ToolUsageEventLike{ToolName: &name}))

		other := "other"
		assert.False(t, IsCodeExecutionEvent(ToolUsageEventLike{ToolName: &other}))
		assert.False(t, IsCodeExecutionEvent(ToolUsageEventLike{ToolName: nil}))
	})

	t.Run("IsSearchEvent", func(t *testing.T) {
		name := "search_web"
		assert.True(t, IsSearchEvent(ToolUsageEventLike{ToolName: &name}))
	})

	t.Run("ExtractCodeExecutionArgs", func(t *testing.T) {
		args := `{"code": "print(1)", "language": "python"}`
		res, err := ExtractCodeExecutionArgs(args)
		require.NoError(t, err)
		assert.Equal(t, "print(1)", res.Code)
		assert.Equal(t, "python", res.Language)
	})

	t.Run("ExtractSearchArgs", func(t *testing.T) {
		args := `{"query": "golang"}`
		res, err := ExtractSearchArgs(args)
		require.NoError(t, err)
		assert.Equal(t, "golang", res.Query)
	})

	t.Run("ParseCodeExecutionPreview", func(t *testing.T) {
		p := `{"output": "hello"}`
		res, err := ParseCodeExecutionPreview(p)
		require.NoError(t, err)
		assert.Equal(t, "hello", res.Output)

		p2 := "raw text"
		res2, err := ParseCodeExecutionPreview(p2)
		require.Error(t, err)
		assert.Equal(t, "raw text", res2.Raw)
	})

	t.Run("ParseSearchPreview", func(t *testing.T) {
		p := `{"results": [{"url": "http://test.com", "title": "test"}]}`
		res, err := ParseSearchPreview(p)
		require.NoError(t, err)
		assert.Len(t, res.Results, 1)
		assert.Equal(t, "test", res.Results[0].Title)

		// Test links fallback
		p2 := `{"links": [{"url": "http://test2.com", "title": "test2"}]}`
		res2, err := ParseSearchPreview(p2)
		require.NoError(t, err)
		assert.Len(t, res2.Results, 1)
		assert.Equal(t, "test2", res2.Results[0].Title)

		// Test totalResults
		p3 := `{"results": [], "totalResults": 10}`
		res3, err := ParseSearchPreview(p3)
		require.NoError(t, err)
		assert.Equal(t, 10, res3.TotalResults)

		// Test missing totalResults
		p3b := `{"results": [{"url": "x"}]}`
		res3b, err := ParseSearchPreview(p3b)
		require.NoError(t, err)
		assert.Equal(t, 1, res3b.TotalResults)

		// Test both empty
		p3c := `{"results": [], "links": []}`
		res3c, err := ParseSearchPreview(p3c)
		require.NoError(t, err)
		assert.Empty(t, res3c.Results)
		assert.Equal(t, 0, res3c.TotalResults)

		// Test invalid JSON
		res4, err := ParseSearchPreview("{")
		require.Error(t, err)
		assert.Empty(t, res4.Results)

		// Test valid JSON but not object (triggers unmarshal error to struct)
		res5, err := ParseSearchPreview("123")
		require.Error(t, err)
		assert.Empty(t, res5.Results)
	})

	t.Run("SafeArgsForDisplay", func(t *testing.T) {
		args := map[string]any{"q": "test"}
		res := SafeArgsForDisplay(args)
		assert.True(t, res.Ok)
		assert.Equal(t, "test", res.Value["q"])

		res2 := SafeArgsForDisplay("invalid")
		assert.False(t, res2.Ok)
	})

	t.Run("ErrorBranches", func(t *testing.T) {
		_, err := ExtractCodeExecutionArgs("{")
		require.Error(t, err)
		_, err = ExtractCodeExecutionArgs(make(chan int))
		require.Error(t, err)
		_, err = ExtractCodeExecutionArgs(map[string]any{"code": 123})
		require.Error(t, err)
		_, err = ExtractSearchArgs("{")
		require.Error(t, err)
		_, err = ExtractSearchArgs(make(chan int))
		require.Error(t, err)
		_, err = ExtractSearchArgs(map[string]any{"query": 123})
		require.Error(t, err)

		res := SafeArgsForDisplay("{")
		assert.False(t, res.Ok)
	})

	t.Run("PreviewFallbacks", func(t *testing.T) {
		preview, err := ParseCodeExecutionPreview(`{"status":"ok"}`)
		require.NoError(t, err)
		assert.JSONEq(t, `{"status":"ok"}`, preview.Raw)

		res := SafeArgsForDisplay(`{"q":"json"}`)
		assert.True(t, res.Ok)
		assert.Equal(t, "json", res.Value["q"])

		args, err := ExtractSearchArgs(map[string]any{"query": "golang"})
		require.NoError(t, err)
		assert.Equal(t, "golang", args.Query)
	})
}

var (
	benchmarkSearchArgsResult SearchArgs
	benchmarkSearchPreview    SearchPreview
)

func BenchmarkExtractSearchArgsJSONString(b *testing.B) {
	input := `{"query":"golang performance tuning"}`
	for b.Loop() {
		var err error
		benchmarkSearchArgsResult, err = ExtractSearchArgs(input)
		if err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkParseSearchPreviewJSONString(b *testing.B) {
	input := `{"results":[{"url":"https://example.com/a","title":"A","snippet":"alpha"},{"url":"https://example.com/b","title":"B","snippet":"beta"}],"totalResults":2}`
	for b.Loop() {
		var err error
		benchmarkSearchPreview, err = ParseSearchPreview(input)
		if err != nil {
			b.Fatal(err)
		}
	}
}

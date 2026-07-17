package patch

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestParseAdd(t *testing.T) {
	ops, err := Parse("*** Begin Patch\n*** Add File: hello.txt\n+Hello world\n+Second line\n*** End Patch")
	require.NoError(t, err)
	require.Len(t, ops, 1)
	assert.Equal(t, Add, ops[0].Kind)
	assert.Equal(t, "hello.txt", ops[0].Path)
	assert.Equal(t, []string{"Hello world", "Second line"}, ops[0].AddLines)
}

func TestParseDelete(t *testing.T) {
	ops, err := Parse("*** Begin Patch\n*** Delete File: gone.txt\n*** End Patch")
	require.NoError(t, err)
	require.Len(t, ops, 1)
	assert.Equal(t, Delete, ops[0].Kind)
	assert.Equal(t, "gone.txt", ops[0].Path)
}

func TestParseUpdateWithMove(t *testing.T) {
	ops, err := Parse("*** Begin Patch\n*** Update File: old.txt\n*** Move to: new.txt\n@@\n-content\n+moved content\n*** End Patch")
	require.NoError(t, err)
	require.Len(t, ops, 1)
	assert.Equal(t, Update, ops[0].Kind)
	assert.Equal(t, "old.txt", ops[0].Path)
	assert.Equal(t, "new.txt", ops[0].MoveTo)
	require.Len(t, ops[0].Hunks, 1)
}

func TestParseEmptyBody(t *testing.T) {
	ops, err := Parse("*** Begin Patch\n*** End Patch")
	require.NoError(t, err)
	assert.Empty(t, ops)
}

func TestParseInvalidGrammar(t *testing.T) {
	cases := map[string]string{
		"missing begin marker": "*** Add File: a.txt\n+x\n*** End Patch",
		"missing end marker":   "*** Begin Patch\n*** Add File: a.txt\n+x",
		"bad add line prefix":  "*** Begin Patch\n*** Add File: a.txt\nnotplus\n*** End Patch",
		"unexpected line":      "*** Begin Patch\nnonsense\n*** End Patch",
		"update with no hunks": "*** Begin Patch\n*** Update File: a.txt\n*** End Patch",
	}
	for name, text := range cases {
		t.Run(name, func(t *testing.T) {
			_, err := Parse(text)
			assert.Error(t, err)
		})
	}
}

func TestParseUpdateHunkEdges(t *testing.T) {
	ops, err := Parse("*** Begin Patch\n\n*** Update File: a.txt\n@@\n\n-a\n+b\n@@ second\n b\n*** Delete File: gone.txt\n*** End Patch")
	require.NoError(t, err)
	require.Len(t, ops, 2)
	require.Len(t, ops[0].Hunks, 2)

	_, err = Parse("*** Begin Patch\n*** Update File: a.txt\n@@\n!invalid\n*** End Patch")
	require.ErrorContains(t, err, "unexpected line")

	ops, err = Parse("*** Begin Patch\n*** Update File: a.txt\n@@\n-a\n+b\n*** End of File\n*** End Patch")
	require.NoError(t, err)
	require.True(t, ops[0].Hunks[0].EndOfFile)

	ops, err = Parse("*** Begin Patch\n*** Delete File: gone.txt\n\n*** Add File: next.txt\n+x\n*** End Patch")
	require.NoError(t, err)
	require.Len(t, ops, 2)
}

func TestLineHelpersCoverEmptyAndFinalNewline(t *testing.T) {
	assert.Empty(t, SplitLines(""))
	assert.Equal(t, "a\nb", JoinLinesPreservingFinalNewline([]string{"a", "b"}, "source"))
	assert.Equal(t, "a\nb\n", JoinLinesPreservingFinalNewline([]string{"a", "b"}, "source\n"))

	start, ok := seekLines([]string{"a"}, nil, 0, false)
	assert.True(t, ok)
	assert.Zero(t, start)
	start, ok = seekLines([]string{"a"}, nil, 0, true)
	assert.True(t, ok)
	assert.Equal(t, 1, start)
	_, ok = seekLines([]string{"a", "b"}, []string{"a"}, 1, true)
	assert.False(t, ok)
}

func TestApplyHunksExact(t *testing.T) {
	fileLines := SplitLines("line1\nline2\nline3")
	hunks := []Hunk{{Lines: []Line{
		{Kind: ' ', Text: "line1"},
		{Kind: '-', Text: "line2"},
		{Kind: '+', Text: "line-two"},
		{Kind: ' ', Text: "line3"},
	}}}
	result, err := ApplyHunks(fileLines, hunks)
	require.NoError(t, err)
	assert.Equal(t, "line1\nline-two\nline3", JoinLines(result))
}

func TestApplyHunksEndOfFile(t *testing.T) {
	fileLines := SplitLines("a\nb\nc")
	hunks := []Hunk{{EndOfFile: true, Lines: []Line{
		{Kind: ' ', Text: "c"},
		{Kind: '+', Text: "d"},
	}}}
	result, err := ApplyHunks(fileLines, hunks)
	require.NoError(t, err)
	assert.Equal(t, "a\nb\nc\nd", JoinLines(result))
}

func TestApplyHunksMultipleInOrder(t *testing.T) {
	fileLines := SplitLines("one\ntwo\nthree\nfour")
	hunks := []Hunk{
		{Lines: []Line{{Kind: '-', Text: "one"}, {Kind: '+', Text: "ONE"}}},
		{Lines: []Line{{Kind: '-', Text: "three"}, {Kind: '+', Text: "THREE"}}},
	}
	result, err := ApplyHunks(fileLines, hunks)
	require.NoError(t, err)
	assert.Equal(t, "ONE\ntwo\nTHREE\nfour", JoinLines(result))
}

func TestSeekLinesUnicodeNormalization(t *testing.T) {
	fileLines := []string{"it's “quoted” — text"}
	oldLines := []string{"it's \"quoted\" - text"}
	start, ok := seekLines(fileLines, oldLines, 0, false)
	assert.True(t, ok)
	assert.Equal(t, 0, start)
}

func TestSeekLinesWhitespaceFuzz(t *testing.T) {
	fileLines := []string{"line2   "}
	oldLines := []string{"line2"}
	start, ok := seekLines(fileLines, oldLines, 0, false)
	assert.True(t, ok)
	assert.Equal(t, 0, start)
}

func TestSeekLinesNotFound(t *testing.T) {
	_, ok := seekLines([]string{"a", "b"}, []string{"z"}, 0, false)
	assert.False(t, ok)
}

func TestApplyHunksNotFoundError(t *testing.T) {
	_, err := ApplyHunks([]string{"a", "b"}, []Hunk{{Lines: []Line{{Kind: '-', Text: "z"}}}})
	assert.Error(t, err)
}

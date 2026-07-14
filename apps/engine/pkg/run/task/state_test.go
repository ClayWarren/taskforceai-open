package task

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestParseJSONInt64Branches(t *testing.T) {
	var state State
	require.Error(t, state.UnmarshalJSON([]byte(`{`)))

	_, err := parseJSONInt64([]byte("   "))
	require.Error(t, err)
	_, err = parseJSONInt64([]byte(`"\x"`))
	require.Error(t, err)

	value, ok, err := parsePlainJSONInt64Bytes(nil)
	require.NoError(t, err)
	assert.False(t, ok)
	assert.Zero(t, value)

	value, ok, err = parsePlainJSONInt64Bytes([]byte("-9223372036854775808"))
	require.NoError(t, err)
	assert.True(t, ok)
	assert.Equal(t, int64(-9223372036854775808), value)

	value, ok, err = parsePlainJSONInt64Bytes([]byte("-42"))
	require.NoError(t, err)
	assert.True(t, ok)
	assert.Equal(t, int64(-42), value)

	_, ok, err = parsePlainJSONInt64Bytes([]byte("+"))
	require.NoError(t, err)
	assert.False(t, ok)

	assert.False(t, isPlainJSONInteger(""))
	assert.False(t, isPlainJSONInteger("+"))
	assert.False(t, isPlainJSONInteger("12a"))
	assert.True(t, isPlainJSONInteger("-42"))

	for _, raw := range []string{`""`, `"9223372036854775808"`, `"1.5"`, `"1e100"`, `"42"`, `"1e2"`} {
		_, _ = parseJSONInt64([]byte(raw))
	}
}

func TestClientMCPToolIsZero(t *testing.T) {
	assert.True(t, ClientMCPTool{}.IsZero())
	assert.True(t, ClientMCPTool{ServerName: "server"}.IsZero())
	assert.False(t, ClientMCPTool{ServerName: " server ", ToolName: " tool "}.IsZero())
}

func TestParseJSONInt64PlainIntegerBounds(t *testing.T) {
	testCases := []struct {
		name    string
		raw     string
		want    int64
		wantErr string
	}{
		{name: "max", raw: `9223372036854775807`, want: 9223372036854775807},
		{name: "min", raw: `-9223372036854775808`, want: -9223372036854775808},
		{name: "positive overflow", raw: `9223372036854775808`, wantErr: "integer out of range"},
		{name: "negative overflow", raw: `-9223372036854775809`, wantErr: "integer out of range"},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := parseJSONInt64(json.RawMessage(tc.raw))
			if tc.wantErr != "" {
				assert.EqualError(t, err, tc.wantErr)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tc.want, got)
		})
	}
}

func TestPersistedWireFieldNames(t *testing.T) {
	data, err := json.Marshal(State{Options: OrchestrateOptions{
		UserPlan:       "pro",
		ClientMCPTools: []ClientMCPTool{{ServerName: "server", ToolName: "tool"}},
	}})
	require.NoError(t, err)
	assert.Contains(t, string(data), `"options":{"UserPlan":"pro"`)
	assert.Contains(t, string(data), `"ClientMCPTools"`)
	assert.Contains(t, string(data), `"taskId"`)
}

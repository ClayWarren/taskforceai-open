package tools

import (
	"testing"
)

// FuzzDecodeCodeExecutionArgs feeds arbitrary strings through the alias
// normalization + double-unmarshal pipeline. The args string is emitted by
// the LLM, so it is untrusted: any input must produce a clean error or a
// usable struct, never a panic.
func FuzzDecodeCodeExecutionArgs(f *testing.F) {
	f.Add(`{"code":"print(1)"}`)
	f.Add(`{"input":"print(1)","code":""}`)
	f.Add(`{"python":"x","script":null,"source":42}`)
	f.Add(`{"code":{"nested":"object"}}`)
	f.Add(`null`)
	f.Add(`[]`)
	f.Fuzz(func(t *testing.T, args string) {
		input, err := decodeCodeExecutionArgs(args)
		if err != nil {
			return
		}
		_ = input.Code
	})
}

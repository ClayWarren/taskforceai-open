package prompts

import "embed"

// FS embeds the built-in prompt defaults at compile time so the engine never
// depends on discovering these files on disk at runtime.
//
//go:embed system_prompt.txt compaction.txt models orchestrator session tool
var FS embed.FS

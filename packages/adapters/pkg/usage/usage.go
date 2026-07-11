// Package usage preserves compatibility for callers while usage policy lives in
// packages/core/go/pkg/usage.
package usage

import coreusage "github.com/TaskForceAI/core/pkg/usage"

type TokenUsageRow = coreusage.TokenUsageRow
type ToolUsageMetadata = coreusage.ToolUsageMetadata
type ToolUsageRow = coreusage.ToolUsageRow
type Repository = coreusage.Repository
type UsageRepository = coreusage.UsageRepository
type TokenUsageRecord = coreusage.TokenUsageRecord
type RecordTokenUsageParams = coreusage.RecordTokenUsageParams
type TokenUsageRecorder = coreusage.TokenUsageRecorder
type ToolUsageRecord = coreusage.ToolUsageRecord
type RecordToolUsageParams = coreusage.RecordToolUsageParams
type ToolUsageRecorder = coreusage.ToolUsageRecorder

var NewTokenUsageRecorder = coreusage.NewTokenUsageRecorder
var NewToolUsageRecorder = coreusage.NewToolUsageRecorder

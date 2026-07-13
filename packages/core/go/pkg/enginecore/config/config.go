package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"reflect"
	"sync"

	"github.com/TaskForceAI/core/internal/runtimevalue"
	"github.com/TaskForceAI/core/pkg/enginecore/permission"
	"github.com/TaskForceAI/core/pkg/enginecore/util"
)

type AnyMap map[string]any

type Permission AnyMap

type Agent struct {
	Model       *string         `json:"model,omitempty"`
	Variant     *string         `json:"variant,omitempty"`
	Temperature *float64        `json:"temperature,omitempty"`
	TopP        *float64        `json:"top_p,omitempty"`
	Prompt      *string         `json:"prompt,omitempty"`
	Tools       map[string]bool `json:"tools,omitempty"`
	Permission  Permission      `json:"permission,omitempty"`
	Disable     *bool           `json:"disable,omitempty"`
	Description *string         `json:"description,omitempty"`
	Mode        *string         `json:"mode,omitempty"`
	Options     AnyMap          `json:"options,omitempty"`
	Color       *string         `json:"color,omitempty"`
	Steps       *int            `json:"steps,omitempty"`
	MaxSteps    *int            `json:"maxSteps,omitempty"`
}

func (a *Agent) UnmarshalJSON(data []byte) error {
	type Alias Agent
	var aux Alias
	if err := unmarshalConfigJSON(data, &aux); err != nil {
		return err
	}
	if err := validateConfigStruct(&aux); err != nil {
		return err
	}
	*a = Agent(aux)

	var raw map[string]any
	if err := unmarshalConfigJSON(data, &raw); err != nil {
		return err
	}
	known := map[string]struct{}{
		"model":       {},
		"variant":     {},
		"temperature": {},
		"top_p":       {},
		"prompt":      {},
		"tools":       {},
		"permission":  {},
		"disable":     {},
		"description": {},
		"mode":        {},
		"options":     {},
		"color":       {},
		"steps":       {},
		"maxSteps":    {},
	}
	options := AnyMap{}
	if a.Options != nil {
		options = mergeAnyMap(options, a.Options)
	}
	for key, val := range raw {
		if _, ok := known[key]; !ok {
			options[key] = val
		}
	}
	if len(options) > 0 {
		a.Options = options
	}
	return nil
}

type Provider struct {
	Options AnyMap `json:"options,omitempty"`
}

type Experimental struct {
	OpenTelemetry  *bool    `json:"openTelemetry,omitempty"`
	BatchTool      *bool    `json:"batch_tool,omitempty"`
	ContinueOnDeny *bool    `json:"continue_loop_on_deny,omitempty"`
	PrimaryTools   []string `json:"primary_tools,omitempty"`
}

type Compaction struct {
	Auto  *bool `json:"auto,omitempty"`
	Prune *bool `json:"prune,omitempty"`
}

type Info struct {
	Model        *string             `json:"model,omitempty"`
	SmallModel   *string             `json:"small_model,omitempty"`
	DefaultAgent *string             `json:"default_agent,omitempty"`
	Username     *string             `json:"username,omitempty"`
	Tools        map[string]bool     `json:"tools,omitempty"`
	Permission   Permission          `json:"permission,omitempty"`
	Agent        map[string]Agent    `json:"agent,omitempty"`
	Provider     map[string]Provider `json:"provider,omitempty"`
	Instructions []string            `json:"instructions,omitempty"`
	Experimental *Experimental       `json:"experimental,omitempty"`
	Compaction   *Compaction         `json:"compaction,omitempty"`
	TaskForceAI  *TaskForceAIConfig  `json:"taskforceai,omitempty"`
}

type TaskForceAIConfig struct {
	Gateway      *TaskForceAIGatewayConfig      `json:"gateway,omitempty"`
	Models       *TaskForceAIModelsConfig       `json:"models,omitempty"`
	Agent        *TaskForceAIAgentConfig        `json:"agent,omitempty"`
	Orchestrator *TaskForceAIOrchestratorConfig `json:"orchestrator,omitempty"`
	Search       *TaskForceAISearchConfig       `json:"search,omitempty"`
	WebApp       *TaskForceAIWebAppConfig       `json:"web_app,omitempty"`
	CORS         *TaskForceAICORSConfig         `json:"cors,omitempty"`
}

type TaskForceAIGatewayConfig struct {
	APIKey         *string           `json:"api_key,omitempty"`
	BaseURL        *string           `json:"base_url,omitempty"`
	Model          *string           `json:"model,omitempty"`
	DefaultHeaders map[string]string `json:"default_headers,omitempty"`
}

type TaskForceAIModelOption struct {
	ID                  string   `json:"id,omitempty"`
	Label               string   `json:"label,omitempty"`
	Description         string   `json:"description,omitempty"`
	UsageMultiple       *float64 `json:"usageMultiple,omitempty"`
	BaseURL             string   `json:"base_url,omitempty"`
	SystemPrompt        string   `json:"system_prompt,omitempty"`
	SystemPromptVersion string   `json:"system_prompt_version,omitempty"`
}

type TaskForceAIModelsConfig struct {
	Default *string                  `json:"default,omitempty"`
	Options []TaskForceAIModelOption `json:"options,omitempty"`
}

type TaskForceAIAgentConfig struct {
	MaxIterations *int     `json:"max_iterations,omitempty"`
	Temperature   *float64 `json:"temperature,omitempty"`
}

type TaskForceAIOrchestratorConfig struct {
	ParallelAgents           *int    `json:"parallel_agents,omitempty"`
	TaskTimeout              *int    `json:"task_timeout,omitempty"`
	AggregationStrategy      *string `json:"aggregation_strategy,omitempty"`
	QuestionGenerationPrompt *string `json:"question_generation_prompt,omitempty"`
	SynthesisPrompt          *string `json:"synthesis_prompt,omitempty"`
}

type TaskForceAISearchConfig struct {
	MaxResults *int                    `json:"max_results,omitempty"`
	UserAgent  *string                 `json:"user_agent,omitempty"`
	Provider   *string                 `json:"provider,omitempty"`
	Brave      *TaskForceAIBraveConfig `json:"brave,omitempty"`
}

type TaskForceAIBraveConfig struct {
	APIKey   *string `json:"api_key,omitempty"`
	Endpoint *string `json:"endpoint,omitempty"`
}

type TaskForceAIWebAppConfig struct {
	RateLimit *TaskForceAIRateLimitConfig `json:"rate_limit,omitempty"`
}

type TaskForceAIRateLimitConfig struct {
	RequestsPerMinute     *int `json:"requests_per_minute,omitempty"`
	RequestsPerHour       *int `json:"requests_per_hour,omitempty"`
	MaxConcurrentRequests *int `json:"max_concurrent_requests,omitempty"`
}

type TaskForceAICORSConfig struct {
	AllowedOrigins []string `json:"allowed_origins,omitempty"`
}

var (
	stateMu              sync.Mutex
	cached               *Info
	unmarshalConfigJSON  = json.Unmarshal
	validateConfigStruct = util.ValidateStruct
)

var ErrConfigSourceUnavailable = errors.New("config source unavailable")

type ConfigDocument struct {
	Name string
	Data []byte
}

type ConfigSnapshot struct {
	Documents         []ConfigDocument
	InlineContent     []byte
	PermissionContent string
}

type ConfigSource interface {
	Load() (ConfigSnapshot, error)
	LoadWritable() (ConfigDocument, error)
	Store(data []byte) error
}

type emptyConfigSource struct{}

var configSources = runtimevalue.New[ConfigSource](emptyConfigSource{})

func (emptyConfigSource) Load() (ConfigSnapshot, error) {
	return ConfigSnapshot{}, nil
}

func (emptyConfigSource) LoadWritable() (ConfigDocument, error) {
	return ConfigDocument{}, nil
}

func (emptyConfigSource) Store([]byte) error {
	return ErrConfigSourceUnavailable
}

func SetConfigSource(source ConfigSource) func() {
	restore := configSources.Set(source)
	Reset()

	return func() {
		restore()
		Reset()
	}
}

func currentConfigSource() ConfigSource {
	return configSources.Current()
}

func Get() (*Info, error) {
	stateMu.Lock()
	defer stateMu.Unlock()
	if cached != nil {
		return cloneInfo(cached), nil
	}
	cfg, err := load()
	if err != nil {
		return nil, err
	}
	cached = cfg
	return cloneInfo(cached), nil
}

func Update(config *Info) error {
	if config == nil {
		return errors.New("config is nil")
	}
	source := currentConfigSource()
	doc, err := source.LoadWritable()
	if err != nil {
		return err
	}
	existing, err := decodeConfigDocument(doc)
	if err != nil {
		return err
	}
	next := mergeInfo(existing, config)
	normalizeInfo(next)
	data, err := json.MarshalIndent(next, "", "  ")
	if err != nil {
		return fmt.Errorf("encode config: %w", err)
	}
	if err := source.Store(data); err != nil {
		return err
	}
	Reset()
	return nil
}

func Reset() {
	stateMu.Lock()
	defer stateMu.Unlock()
	cached = nil
}

func load() (*Info, error) {
	return loadFromSource(currentConfigSource())
}

func loadFromSource(source ConfigSource) (*Info, error) {
	if source == nil {
		source = emptyConfigSource{}
	}
	snapshot, err := source.Load()
	if err != nil {
		return nil, err
	}

	result := &Info{}
	for _, doc := range snapshot.Documents {
		info, err := decodeConfigDocument(doc)
		if err != nil {
			return nil, err
		}
		result = mergeInfo(result, info)
	}

	if len(snapshot.InlineContent) > 0 {
		info, err := decodeInfoJSON(snapshot.InlineContent)
		if err != nil {
			return nil, fmt.Errorf("decode inline config content: %w", err)
		}
		result = mergeInfo(result, info)
	}

	if snapshot.PermissionContent != "" {
		extra, err := decodePermissionEnv(snapshot.PermissionContent)
		if err != nil {
			return nil, err
		}
		result.Permission = mergePermission(result.Permission, extra)
	}

	normalizeInfo(result)
	return result, nil
}

func decodeConfigDocument(doc ConfigDocument) (*Info, error) {
	if len(doc.Data) == 0 {
		return &Info{}, nil
	}
	info, err := decodeInfoJSON(doc.Data)
	if err != nil {
		return nil, fmt.Errorf("decode config: %w", err)
	}
	return info, nil
}

func decodeInfoJSON(data []byte) (*Info, error) {
	var out Info
	if err := unmarshalConfigJSON(data, &out); err != nil {
		return nil, err
	}
	if err := validateConfigStruct(&out); err != nil {
		return nil, err
	}
	return &out, nil
}

func decodePermissionEnv(value string) (Permission, error) {
	wrapped := []byte("{\"permission\":" + value + "}")
	type permissionEnv struct {
		Permission Permission `json:"permission" validate:"required"`
	}
	var env permissionEnv
	if err := unmarshalConfigJSON(wrapped, &env); err != nil {
		return nil, fmt.Errorf("decode permission config content: %w", err)
	}
	if err := validateConfigStruct(&env); err != nil {
		return nil, fmt.Errorf("validate permission config content: %w", err)
	}
	return env.Permission, nil
}

func normalizeInfo(info *Info) {
	if info == nil {
		return
	}
	if tools := info.Tools; len(tools) > 0 {
		perms := permissionFromTools(tools)
		info.Permission = mergePermission(perms, info.Permission)
	}
	if agents := info.Agent; len(agents) > 0 {
		info.Agent = normalizeAgents(agents)
	}
}

func normalizeAgents(input map[string]Agent) map[string]Agent {
	result := map[string]Agent{}
	for name, agent := range input {
		options := AnyMap{}
		if agent.Options != nil {
			options = mergeAnyMap(options, agent.Options)
		}
		perm := permissionFromTools(agent.Tools)
		if agent.Permission != nil {
			perm = mergePermission(perm, agent.Permission)
		}
		if agent.Steps == nil && agent.MaxSteps != nil {
			steps := *agent.MaxSteps
			agent.Steps = &steps
		}
		agent.Options = options
		agent.Permission = perm
		result[name] = agent
	}
	return result
}

func permissionFromTools(tools map[string]bool) Permission {
	if len(tools) == 0 {
		return Permission{}
	}
	perms := Permission{}
	if action, ok := editAliasAction(tools); ok {
		perms["edit"] = action
	}
	for tool, enabled := range tools {
		if isEditAlias(tool) {
			continue
		}
		action := permission.PermissionDeny
		if enabled {
			action = permission.PermissionAllow
		}
		perms[tool] = string(action)
	}
	return perms
}

func editAliasAction(tools map[string]bool) (string, bool) {
	aliases := []string{"write", "edit", "multiedit"}
	found := false
	for _, alias := range aliases {
		enabled, ok := tools[alias]
		if !ok {
			continue
		}
		found = true
		if !enabled {
			return string(permission.PermissionDeny), true
		}
	}
	if !found {
		return "", false
	}
	return string(permission.PermissionAllow), true
}

func isEditAlias(tool string) bool {
	return tool == "write" || tool == "edit" || tool == "multiedit"
}

func mergeInfo(base, overlay *Info) *Info {
	if base == nil && overlay == nil {
		return &Info{}
	}
	if base == nil {
		return cloneInfo(overlay)
	}
	if overlay == nil {
		return cloneInfo(base)
	}
	out := cloneInfo(base)
	overlayPtr(&out.Model, overlay.Model)
	overlayPtr(&out.SmallModel, overlay.SmallModel)
	overlayPtr(&out.DefaultAgent, overlay.DefaultAgent)
	overlayPtr(&out.Username, overlay.Username)
	if overlay.Tools != nil {
		out.Tools = mergeMap(out.Tools, overlay.Tools)
	}
	if overlay.Permission != nil {
		out.Permission = mergePermission(out.Permission, overlay.Permission)
	}
	if overlay.Agent != nil {
		out.Agent = mergeAgentMap(out.Agent, overlay.Agent)
	}
	if overlay.Provider != nil {
		out.Provider = mergeProviderMap(out.Provider, overlay.Provider)
	}
	if overlay.Instructions != nil {
		out.Instructions = append([]string{}, overlay.Instructions...)
	}
	overlayMerge(&out.Experimental, overlay.Experimental, mergeExperimental)
	overlayMerge(&out.Compaction, overlay.Compaction, mergeCompaction)
	overlayMerge(&out.TaskForceAI, overlay.TaskForceAI, mergeTaskForceAI)
	return out
}

func cloneInfo(info *Info) *Info {
	if info == nil {
		return &Info{}
	}
	return clonePtr(info)
}

func mergeTaskForceAI(base, overlay *TaskForceAIConfig) *TaskForceAIConfig {
	if out, done := mergeCloneBase(base, overlay); done {
		return out
	}
	out := clonePtr(base)
	overlayMerge(&out.Gateway, overlay.Gateway, mergeTaskForceAIGateway)
	overlayMerge(&out.Models, overlay.Models, mergeTaskForceAIModels)
	overlayMerge(&out.Agent, overlay.Agent, mergeTaskForceAIAgent)
	overlayMerge(&out.Orchestrator, overlay.Orchestrator, mergeTaskForceAIOrchestrator)
	overlayMerge(&out.Search, overlay.Search, mergeTaskForceAISearch)
	overlayMerge(&out.WebApp, overlay.WebApp, mergeTaskForceAIWebApp)
	overlayMerge(&out.CORS, overlay.CORS, mergeTaskForceAICORS)
	return out
}

func mergeTaskForceAIGateway(base, overlay *TaskForceAIGatewayConfig) *TaskForceAIGatewayConfig {
	if out, done := mergeCloneBase(base, overlay); done {
		return out
	}
	out := cloneValue(*base)
	overlayPtr(&out.APIKey, overlay.APIKey)
	overlayPtr(&out.BaseURL, overlay.BaseURL)
	overlayPtr(&out.Model, overlay.Model)
	if overlay.DefaultHeaders != nil {
		out.DefaultHeaders = mergeMap(out.DefaultHeaders, overlay.DefaultHeaders)
	}
	return &out
}

func mergeTaskForceAIModels(base, overlay *TaskForceAIModelsConfig) *TaskForceAIModelsConfig {
	if out, done := mergeCloneBase(base, overlay); done {
		return out
	}
	out := cloneValue(*base)
	overlayPtr(&out.Default, overlay.Default)
	if overlay.Options != nil {
		out.Options = cloneValue(overlay.Options)
	}
	return &out
}

func mergeTaskForceAIAgent(base, overlay *TaskForceAIAgentConfig) *TaskForceAIAgentConfig {
	if out, done := mergeCloneBase(base, overlay); done {
		return out
	}
	out := cloneValue(*base)
	overlayPtr(&out.MaxIterations, overlay.MaxIterations)
	overlayPtr(&out.Temperature, overlay.Temperature)
	return &out
}

func mergeTaskForceAIOrchestrator(base, overlay *TaskForceAIOrchestratorConfig) *TaskForceAIOrchestratorConfig {
	if out, done := mergeCloneBase(base, overlay); done {
		return out
	}
	out := cloneValue(*base)
	overlayPtr(&out.ParallelAgents, overlay.ParallelAgents)
	overlayPtr(&out.TaskTimeout, overlay.TaskTimeout)
	overlayPtr(&out.AggregationStrategy, overlay.AggregationStrategy)
	overlayPtr(&out.QuestionGenerationPrompt, overlay.QuestionGenerationPrompt)
	overlayPtr(&out.SynthesisPrompt, overlay.SynthesisPrompt)
	return &out
}

func mergeTaskForceAISearch(base, overlay *TaskForceAISearchConfig) *TaskForceAISearchConfig {
	if out, done := mergeCloneBase(base, overlay); done {
		return out
	}
	out := cloneValue(*base)
	overlayPtr(&out.MaxResults, overlay.MaxResults)
	overlayPtr(&out.UserAgent, overlay.UserAgent)
	overlayPtr(&out.Provider, overlay.Provider)
	if overlay.Brave != nil {
		if out.Brave == nil {
			out.Brave = &TaskForceAIBraveConfig{}
		}
		overlayPtr(&out.Brave.APIKey, overlay.Brave.APIKey)
		overlayPtr(&out.Brave.Endpoint, overlay.Brave.Endpoint)
	}
	return &out
}

func mergeTaskForceAIWebApp(base, overlay *TaskForceAIWebAppConfig) *TaskForceAIWebAppConfig {
	if out, done := mergeCloneBase(base, overlay); done {
		return out
	}
	out := cloneValue(*base)
	if overlay.RateLimit != nil {
		if out.RateLimit == nil {
			out.RateLimit = &TaskForceAIRateLimitConfig{}
		}
		overlayPtr(&out.RateLimit.RequestsPerMinute, overlay.RateLimit.RequestsPerMinute)
		overlayPtr(&out.RateLimit.RequestsPerHour, overlay.RateLimit.RequestsPerHour)
		overlayPtr(&out.RateLimit.MaxConcurrentRequests, overlay.RateLimit.MaxConcurrentRequests)
	}
	return &out
}

func mergeTaskForceAICORS(base, overlay *TaskForceAICORSConfig) *TaskForceAICORSConfig {
	if out, done := mergeCloneBase(base, overlay); done {
		return out
	}
	out := cloneValue(*base)
	if overlay.AllowedOrigins != nil {
		out.AllowedOrigins = cloneValue(overlay.AllowedOrigins)
	}
	return &out
}

func mergeMap[T any](base, overlay map[string]T) map[string]T {
	if base == nil && overlay == nil {
		return nil
	}
	out := map[string]T{}
	maps.Copy(out, base)
	maps.Copy(out, overlay)
	return out
}

func mergePermission(base Permission, overlay Permission) Permission {
	return Permission(mergeAnyMap(AnyMap(base), AnyMap(overlay)))
}

func mergeAnyMap(base AnyMap, overlay AnyMap) AnyMap {
	if base == nil && overlay == nil {
		return nil
	}
	out := AnyMap{}
	for k, v := range base {
		out[k] = cloneAny(v)
	}
	for k, v := range overlay {
		if existing, ok := out[k]; ok {
			if merged, okMerge := mergeAnyValue(existing, v); okMerge {
				out[k] = merged
				continue
			}
		}
		out[k] = cloneAny(v)
	}
	return out
}

func mergeAnyValue(base any, overlay any) (any, bool) {
	bMap, bOk := asAnyMap(base)
	oMap, oOk := asAnyMap(overlay)
	if bOk && oOk {
		return mergeAnyMap(bMap, oMap), true
	}
	return nil, false
}

func asAnyMap(value any) (AnyMap, bool) {
	switch v := value.(type) {
	case AnyMap:
		return v, true
	case Permission:
		return AnyMap(v), true
	case map[string]any:
		return AnyMap(v), true
	default:
		return nil, false
	}
}

func cloneAny(value any) any {
	if value == nil {
		return nil
	}
	return cloneValue(value)
}

func mergeAgentMap(base, overlay map[string]Agent) map[string]Agent {
	if base == nil && overlay == nil {
		return nil
	}
	out := map[string]Agent{}
	for k, v := range base {
		out[k] = cloneValue(v)
	}
	for k, v := range overlay {
		if existing, ok := out[k]; ok {
			out[k] = mergeAgent(existing, v)
			continue
		}
		out[k] = cloneValue(v)
	}
	return out
}

func mergeAgent(base Agent, overlay Agent) Agent {
	out := cloneValue(base)
	overlayPtr(&out.Model, overlay.Model)
	overlayPtr(&out.Variant, overlay.Variant)
	overlayPtr(&out.Temperature, overlay.Temperature)
	overlayPtr(&out.TopP, overlay.TopP)
	overlayPtr(&out.Prompt, overlay.Prompt)
	if overlay.Tools != nil {
		out.Tools = mergeMap(out.Tools, overlay.Tools)
	}
	if overlay.Permission != nil {
		out.Permission = mergePermission(out.Permission, overlay.Permission)
	}
	overlayPtr(&out.Disable, overlay.Disable)
	overlayPtr(&out.Description, overlay.Description)
	overlayPtr(&out.Mode, overlay.Mode)
	if overlay.Options != nil {
		out.Options = mergeAnyMap(out.Options, overlay.Options)
	}
	overlayPtr(&out.Color, overlay.Color)
	overlayPtr(&out.Steps, overlay.Steps)
	overlayPtr(&out.MaxSteps, overlay.MaxSteps)
	return out
}

func mergeProviderMap(base, overlay map[string]Provider) map[string]Provider {
	if base == nil && overlay == nil {
		return nil
	}
	out := map[string]Provider{}
	for k, v := range base {
		out[k] = cloneValue(v)
	}
	for k, v := range overlay {
		if existing, ok := out[k]; ok {
			out[k] = mergeProvider(existing, v)
			continue
		}
		out[k] = cloneValue(v)
	}
	return out
}

func mergeProvider(base Provider, overlay Provider) Provider {
	out := cloneValue(base)
	if overlay.Options != nil {
		out.Options = mergeAnyMap(out.Options, overlay.Options)
	}
	return out
}

func overlayPtr[T any](dst **T, src *T) {
	if src != nil {
		*dst = clonePtr(src)
	}
}

func overlayMerge[T any](dst **T, src *T, merge func(*T, *T) *T) {
	if src != nil {
		*dst = merge(*dst, src)
	}
}

func mergeCloneBase[T any](base, overlay *T) (*T, bool) {
	switch {
	case base == nil && overlay == nil:
		return nil, true
	case base == nil:
		return clonePtr(overlay), true
	case overlay == nil:
		return clonePtr(base), true
	default:
		return nil, false
	}
}

func mergeExperimental(base, overlay *Experimental) *Experimental {
	if out, done := mergeCloneBase(base, overlay); done {
		return out
	}
	out := cloneValue(*base)
	overlayPtr(&out.OpenTelemetry, overlay.OpenTelemetry)
	overlayPtr(&out.BatchTool, overlay.BatchTool)
	overlayPtr(&out.ContinueOnDeny, overlay.ContinueOnDeny)
	if overlay.PrimaryTools != nil {
		out.PrimaryTools = cloneValue(overlay.PrimaryTools)
	}
	return &out
}

func mergeCompaction(base, overlay *Compaction) *Compaction {
	if out, done := mergeCloneBase(base, overlay); done {
		return out
	}
	out := cloneValue(*base)
	overlayPtr(&out.Auto, overlay.Auto)
	overlayPtr(&out.Prune, overlay.Prune)
	return &out
}

func clonePtr[T any](in *T) *T {
	if in == nil {
		return nil
	}
	out := cloneValue(*in)
	return &out
}

func cloneValue[T any](in T) T {
	cloned := cloneReflectValue(reflect.ValueOf(in))
	if !cloned.IsValid() {
		return in
	}
	return cloned.Interface().(T) //nolint:forcetypeassert // cloneReflectValue preserves the input value's type.
}

func cloneReflectValue(value reflect.Value) reflect.Value {
	if !value.IsValid() {
		return value
	}

	switch value.Kind() {
	case reflect.Pointer:
		if value.IsNil() {
			return reflect.Zero(value.Type())
		}
		out := reflect.New(value.Type().Elem())
		out.Elem().Set(cloneReflectValue(value.Elem()))
		return out
	case reflect.Interface:
		if value.IsNil() {
			return reflect.Zero(value.Type())
		}
		out := reflect.New(value.Type()).Elem()
		out.Set(cloneReflectValue(value.Elem()))
		return out
	case reflect.Map:
		if value.IsNil() {
			return reflect.Zero(value.Type())
		}
		out := reflect.MakeMapWithSize(value.Type(), value.Len())
		iter := value.MapRange()
		for iter.Next() {
			out.SetMapIndex(cloneReflectValue(iter.Key()), cloneReflectValue(iter.Value()))
		}
		return out
	case reflect.Slice:
		if value.IsNil() {
			return reflect.Zero(value.Type())
		}
		out := reflect.MakeSlice(value.Type(), value.Len(), value.Len())
		for i := 0; i < value.Len(); i++ {
			out.Index(i).Set(cloneReflectValue(value.Index(i)))
		}
		return out
	case reflect.Array:
		out := reflect.New(value.Type()).Elem()
		for i := 0; i < value.Len(); i++ {
			out.Index(i).Set(cloneReflectValue(value.Index(i)))
		}
		return out
	case reflect.Struct:
		out := reflect.New(value.Type()).Elem()
		for i := 0; i < value.NumField(); i++ {
			if !out.Field(i).CanSet() || !value.Field(i).CanInterface() {
				return value
			}
		}
		for i := 0; i < value.NumField(); i++ {
			out.Field(i).Set(cloneReflectValue(value.Field(i)))
		}
		return out
	default:
		return value
	}
}

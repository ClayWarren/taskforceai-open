package config

import "strings"

type GatewayConfig struct {
	APIKey         string            `json:"api_key" yaml:"api_key"`
	BaseURL        string            `json:"base_url" yaml:"base_url"`
	Model          string            `json:"model" yaml:"model"`
	DefaultHeaders map[string]string `json:"default_headers,omitempty" yaml:"default_headers,omitempty"`
}

type AgentConfig struct {
	MaxIterations   int      `json:"max_iterations" yaml:"max_iterations"`
	Temperature     *float64 `json:"temperature,omitempty" yaml:"temperature,omitempty"`
	ReasoningEffort string   `json:"reasoning_effort,omitempty" yaml:"reasoning_effort,omitempty"`
}

type OrchestratorConfig struct {
	ParallelAgents           int    `json:"parallel_agents" yaml:"parallel_agents"`
	TaskTimeout              int    `json:"task_timeout" yaml:"task_timeout"`
	AggregationStrategy      string `json:"aggregation_strategy" yaml:"aggregation_strategy"`
	QuestionGenerationPrompt string `json:"question_generation_prompt" yaml:"question_generation_prompt"`
	SynthesisPrompt          string `json:"synthesis_prompt" yaml:"synthesis_prompt"`
	EnableLocalFileTools     bool   `json:"enable_local_file_tools" yaml:"enable_local_file_tools"`
}

type SearchConfig struct {
	MaxResults int               `json:"max_results" yaml:"max_results"`
	UserAgent  string            `json:"user_agent" yaml:"user_agent"`
	Provider   string            `json:"provider" yaml:"provider"`
	Brave      BraveSearchConfig `json:"brave" yaml:"brave"`
}

type BraveSearchConfig struct {
	APIKey   string `json:"api_key" yaml:"api_key"`
	Endpoint string `json:"endpoint" yaml:"endpoint"`
}

type WebAppConfig struct {
	RateLimit RateLimitConfig `json:"rate_limit" yaml:"rate_limit"`
}

type RateLimitConfig struct {
	RequestsPerMinute     int `json:"requests_per_minute" yaml:"requests_per_minute"`
	RequestsPerHour       int `json:"requests_per_hour" yaml:"requests_per_hour"`
	MaxConcurrentRequests int `json:"max_concurrent_requests" yaml:"max_concurrent_requests"`
}

type CORSConfig struct {
	AllowedOrigins []string `json:"allowed_origins" yaml:"allowed_origins"`
}

type ModelOption struct {
	ID                  string   `json:"id" yaml:"id"`
	Label               string   `json:"label" yaml:"label"`
	Description         string   `json:"description,omitempty" yaml:"description,omitempty"`
	UsageMultiple       *float64 `json:"usageMultiple,omitempty" yaml:"usageMultiple,omitempty"`
	BaseURL             string   `json:"base_url,omitempty" yaml:"base_url,omitempty"`
	SystemPrompt        string   `json:"system_prompt,omitempty" yaml:"system_prompt,omitempty"`
	SystemPromptVersion string   `json:"system_prompt_version,omitempty" yaml:"system_prompt_version,omitempty"`
}

type ModelsConfig struct {
	Default string        `json:"default" yaml:"default"`
	Options []ModelOption `json:"options" yaml:"options"`
}

type Config struct {
	Gateway      GatewayConfig      `json:"gateway" yaml:"gateway"`
	Models       ModelsConfig       `json:"models" yaml:"models"`
	SystemPrompt string             `json:"system_prompt" yaml:"system_prompt"`
	Agent        AgentConfig        `json:"agent" yaml:"agent"`
	Orchestrator OrchestratorConfig `json:"orchestrator" yaml:"orchestrator"`
	Search       SearchConfig       `json:"search" yaml:"search"`
	WebApp       WebAppConfig       `json:"web_app" yaml:"web_app"`
	CORS         CORSConfig         `json:"cors" yaml:"cors"`
}

func (c Config) ResolveSystemPrompt(modelID string) string {
	if strings.TrimSpace(modelID) == "" {
		if strings.TrimSpace(c.Gateway.Model) != "" {
			modelID = c.Gateway.Model
		} else {
			modelID = c.Models.Default
		}
	}
	if strings.TrimSpace(modelID) != "" {
		for _, opt := range c.Models.Options {
			if opt.ID == modelID && strings.TrimSpace(opt.SystemPrompt) != "" {
				return opt.SystemPrompt
			}
		}
	}
	if strings.TrimSpace(c.SystemPrompt) != "" {
		return c.SystemPrompt
	}
	return ""
}

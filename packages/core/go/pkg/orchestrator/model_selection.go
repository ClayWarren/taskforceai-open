package orchestrator

import (
	"errors"
	"strings"

	"github.com/TaskForceAI/core/pkg/config"
)

var ErrNoModelsConfigured = errors.New("no models configured")

type ErrUnknownModel struct {
	ModelID string
}

func (e ErrUnknownModel) Error() string {
	return "unknown model requested: " + e.ModelID
}

type ModelOption struct {
	ID            string  `json:"id"`
	Label         string  `json:"label"`
	Description   string  `json:"description,omitempty"`
	Badge         string  `json:"badge"`
	UsageMultiple float64 `json:"usageMultiple,omitempty"`
}

type ResolvedModelSelection struct {
	Config          config.Config `json:"config"`
	SelectedModel   ModelOption   `json:"selectedModel"`
	Options         []ModelOption `json:"options"`
	SelectorEnabled bool          `json:"selectorEnabled"`
}

type ModelSelectionResult = ResolvedModelSelection

func computeModelLabel(id string) string {
	parts := strings.Split(modelName(id), "-")
	var b strings.Builder
	b.Grow(len(id))
	for index, part := range parts {
		if index > 0 {
			b.WriteByte(' ')
		}
		writeTitleToken(&b, part)
	}
	return b.String()
}

func computeModelBadge(id string) string {
	name := modelName(id)
	end := len(name)
	parts := 1
	for i := 0; i < len(name); i++ {
		if name[i] != '-' {
			continue
		}
		parts++
		if parts > 3 {
			end = i
			break
		}
	}

	var b strings.Builder
	b.Grow(end + len(" HEAVY"))
	for i := 0; i < end; i++ {
		c := name[i]
		if c >= 'a' && c <= 'z' {
			c -= 'a' - 'A'
		}
		b.WriteByte(c)
	}
	b.WriteString(" HEAVY")
	return b.String()
}

func modelName(id string) string {
	if idx := strings.LastIndexByte(id, '/'); idx >= 0 {
		return id[idx+1:]
	}
	return id
}

func writeTitleToken(b *strings.Builder, token string) {
	if token == "" {
		return
	}
	c := token[0]
	if c >= 'a' && c <= 'z' {
		c -= 'a' - 'A'
	}
	b.WriteByte(c)
	b.WriteString(token[1:])
}

func enrichModel(m config.ModelOption) ModelOption {
	opt := ModelOption{
		ID:          m.ID,
		Label:       m.Label,
		Description: m.Description,
	}
	if opt.Label == "" {
		opt.Label = computeModelLabel(m.ID)
	}
	opt.Badge = computeModelBadge(m.ID)
	if m.UsageMultiple != nil {
		opt.UsageMultiple = *m.UsageMultiple
	}
	return opt
}

func ResolveModelSelection(cfg config.Config, requestedModelID string) (ModelSelectionResult, error) {
	defaultModelID := strings.TrimSpace(cfg.Models.Default)
	if defaultModelID == "" {
		defaultModelID = strings.TrimSpace(cfg.Gateway.Model)
	}

	options := make([]ModelOption, len(cfg.Models.Options))
	for i, m := range cfg.Models.Options {
		options[i] = enrichModel(m)
	}

	if len(options) == 0 {
		return ModelSelectionResult{}, ErrNoModelsConfigured
	}

	if defaultModelID == "" {
		defaultModelID = options[0].ID
	}

	targetID := requestedModelID
	if targetID == "" {
		targetID = defaultModelID
	}

	var selected *ModelOption
	for i := range options {
		if options[i].ID == targetID {
			selected = &options[i]
			break
		}
	}

	if selected == nil {
		return ModelSelectionResult{}, ErrUnknownModel{ModelID: targetID}
	}

	cfg.Gateway.Model = selected.ID

	for _, opt := range cfg.Models.Options {
		if opt.ID == selected.ID && opt.SystemPrompt != "" {
			cfg.SystemPrompt = opt.SystemPrompt
			break
		}
	}

	return ModelSelectionResult{
		Config:          cfg,
		SelectedModel:   *selected,
		SelectorEnabled: true,
		Options:         options,
	}, nil
}

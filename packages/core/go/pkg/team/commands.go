package team

type ModelInfo struct {
	ProviderID string `json:"providerID"`
	ModelID    string `json:"modelID"`
}

type PermissionRule struct {
	Permission string `json:"permission"`
	Pattern    string `json:"pattern"`
	Action     string `json:"action"` // "allow" or "deny"
}

type SpawnInput struct {
	TeamName        string
	Name            string
	ParentSessionID string
	Agent           struct {
		Name   string
		Prompt string
		Skills []string
	}
	Model struct {
		ProviderID string
		ModelID    string
	}
	Prompt       string
	ClaimTask    string
	PlanApproval bool
}

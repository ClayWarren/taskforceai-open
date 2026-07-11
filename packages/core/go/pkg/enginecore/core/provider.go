package core

import "strings"

// ProviderModel mirrors the minimal fields we need for session bookkeeping.
type ProviderModel struct {
	ProviderID string
	ModelID    string
}

// ProviderResolver lets TaskforceAI plug in model resolution.
type ProviderResolver interface {
	GetModel(providerID, modelID string) (ProviderModel, error)
}

func QualifiedModelID(providerID, modelID string) string {
	if modelID == "" {
		return ""
	}
	if strings.Contains(modelID, "/") || providerID == "" {
		return modelID
	}
	return providerID + "/" + modelID
}

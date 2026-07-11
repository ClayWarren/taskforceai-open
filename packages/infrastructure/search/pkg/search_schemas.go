package pkg

type BraveResponse struct {
	Web struct {
		Results []BraveResult `json:"results"`
	} `json:"web"`
}

type BraveResult struct {
	Title       string `json:"title,omitempty"`
	URL         string `json:"url"`
	Snippet     string `json:"snippet,omitempty"`
	Description string `json:"description,omitempty"`
}

type PubChemResponse struct {
	InformationList struct {
		Information []struct {
			CID     int      `json:"CID,omitempty"`
			Synonym []string `json:"Synonym,omitempty"`
		} `json:"Information"`
	} `json:"InformationList"`
}
